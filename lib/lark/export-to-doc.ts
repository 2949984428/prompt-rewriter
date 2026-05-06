// prompt-rewriter/lib/lark/export-to-doc.ts
//
// 把一个 BatchRunRecord 推进飞书云文档:
//   1. docs +create 拿 doc_id(初始内容 = 标题 + 元数据 + 排行榜)
//   2. 按 (query, skill) 顺序循环:append markdown + media-insert 图
//
// 串行执行(每次 spawn 一个 lark-cli 进程,~500ms,64 cell ≈ 100s)。
// 调用方负责给前端进度反馈(目前是同步等待)。
//
// 失败处理:
//   - create 失败:抛错,前端显示错误
//   - 单 cell append/insert 失败:不抛,记到 failures[],继续走完
//   - 最后返回 image_failed 计数,前端 UI 提示"X 张图未上传成功"

import path from "path";
import { runLarkCliJson, runLarkCli, LarkCliError } from "./cli";
import { resolveLocalImage } from "@/lib/export/image-loader";
import type { BatchRunRecord, BatchCell } from "@/lib/schema";

export type ExportToLarkResult = {
  doc_id: string;
  doc_url: string;
  cells_processed: number;
  cells_total: number;
  image_uploaded: number;
  image_failed: number;
  failures: { query_idx: number; skill_id: string; reason: string }[];
};

export type ExportToLarkOptions = {
  includeExcluded?: boolean;
  // 可选:把文档创建在某个 folder / wiki node 下
  folderToken?: string;
};

function dimLabel(record: BatchRunRecord, dimId: string): string {
  return record.scoring_dimensions.find((d) => d.id === dimId)?.label ?? dimId;
}
function avgScore(cell: BatchCell): number | null {
  const vs = Object.values(cell.scores).filter((v) => v > 0);
  if (vs.length === 0) return null;
  return vs.reduce((a, b) => a + b, 0) / vs.length;
}

// 排行榜 markdown 行
function leaderboardLines(record: BatchRunRecord, includeExcluded: boolean): string {
  type Row = { skill: string; sum: number; rated: number; total: number };
  const map = new Map<string, Row>();
  for (const c of record.cells) {
    if (!includeExcluded && c.status === "excluded") continue;
    const r = map.get(c.skill_id) ?? {
      skill: c.skill_id,
      sum: 0,
      rated: 0,
      total: 0,
    };
    r.total++;
    const a = avgScore(c);
    if (a != null) {
      r.sum += a;
      r.rated++;
    }
    map.set(c.skill_id, r);
  }
  const rows = Array.from(map.values()).map((r) => ({
    skill: r.skill,
    avg: r.rated > 0 ? r.sum / r.rated : null,
    rated: r.rated,
    total: r.total,
  }));
  rows.sort((a, b) => {
    if (a.avg == null && b.avg == null) return 0;
    if (a.avg == null) return 1;
    if (b.avg == null) return -1;
    return b.avg - a.avg;
  });
  const lines = rows.map(
    (r, i) =>
      `${i + 1}. \`${r.skill}\` — 平均 ${r.avg != null ? r.avg.toFixed(2) : "—"} (${r.rated}/${r.total} 已评)`
  );
  return lines.join("\n");
}

// 创建文档时的初始 markdown(标题 + 元信息 + 排行榜)
function buildInitialMarkdown(
  record: BatchRunRecord,
  includeExcluded: boolean
): string {
  const date = new Date(record.created_at).toLocaleString("zh-CN");
  const lb = leaderboardLines(record, includeExcluded);
  const purpose = record.purpose
    ? `\n\n**测试目的**\n> ${record.purpose.replace(/\n/g, "\n> ")}`
    : "";
  return `# ${record.name || "(未命名跑批)"}

由 prompt-rewriter 批量测试台导出 · ${date}

**规模**:${record.queries.length} query × ${record.skill_ids.length} skill = ${record.cells.length} cell
**改写模型**:\`${record.rewrite_llm || "(默认)"}\`
**模式**:${record.query_mode}${purpose}

## 排行榜

${lb}

---
`;
}

// 单 cell 的 markdown 块(不含图,图随后用 media-insert 追加)
function cellMarkdown(record: BatchRunRecord, cell: BatchCell): string {
  const avg = avgScore(cell);
  const scoredEntries = Object.entries(cell.scores).filter(([, v]) => v > 0);
  const scoreStr =
    scoredEntries.length > 0
      ? `★ ${avg!.toFixed(1)} · ${scoredEntries
          .map(([dim, v]) => `${dimLabel(record, dim)} ${v}`)
          .join(" / ")}`
      : "未评分";
  const noteLine = cell.note ? `\n> 备注:${cell.note.replace(/\n/g, " ")}` : "";
  const errLine = cell.error ? `\n> ⚠ 错误:${cell.error.replace(/\n/g, " ").slice(0, 200)}` : "";

  const fpBlock = cell.final_prompt
    ? `\n\n**final_prompt** (\`${cell.final_prompt.size ?? "auto"} · ${cell.final_prompt.quality ?? "auto"}\`):\n\n\`\`\`\n${cell.final_prompt.prompt}\n\`\`\``
    : "";

  return `### \`${cell.skill_id}\` — ${scoreStr}${noteLine}${errLine}${fpBlock}\n`;
}

export async function exportBatchToLark(
  record: BatchRunRecord,
  opts: ExportToLarkOptions = {}
): Promise<ExportToLarkResult> {
  const includeExcluded = opts.includeExcluded ?? false;
  const visibleCells = record.cells.filter(
    (c) => includeExcluded || c.status !== "excluded"
  );

  // 1. 创建文档
  const initMd = buildInitialMarkdown(record, includeExcluded);
  const createArgs = ["docs", "+create", "--title", record.name || "批量测试报告", "--markdown", initMd];
  if (opts.folderToken) {
    createArgs.push("--folder-token", opts.folderToken);
  }
  // lark-cli 统一返回 { ok, identity, data: {...}, _notice } —— 真实字段在 data 下,
  // 之前直接当顶层取拿到 undefined,后续所有 --doc 都炸了
  const created = await runLarkCliJson<{
    ok?: boolean;
    data?: { doc_id?: string; doc_url?: string };
  }>(createArgs, { timeoutMs: 30_000 });

  const docId = created.data?.doc_id;
  const docUrl = created.data?.doc_url;
  if (!docId || !docUrl) {
    throw new LarkCliError(
      "api_error",
      `lark-cli +create 没返回 doc_id/doc_url(收到 ${JSON.stringify(created).slice(0, 200)})`
    );
  }
  const result: ExportToLarkResult = {
    doc_id: docId,
    doc_url: docUrl,
    cells_processed: 0,
    cells_total: visibleCells.length,
    image_uploaded: 0,
    image_failed: 0,
    failures: [],
  };

  // 2. 按 query 分块。每个 query:
  //    a. 1 次 append 把"标题 + 引用 query 原文 + 该 query 全部 cell 的文字"全塞进去
  //    b. 该 query 的图 4 路并发 media-insert
  //    顺序保证:不同 query 之间严格串行;同 query 内的图相对 caption 顺序略乱。
  //
  //    跟原来"每 cell 一次 append + 一次 insert"相比,文字调用从 64 → 8、
  //    图调用从串行 → 并发 4,实测 ~5x 加速。
  for (let qi = 0; qi < record.queries.length; qi++) {
    const cellsOfQ = visibleCells
      .filter((c) => c.query_idx === qi)
      .sort(
        (a, b) =>
          record.skill_ids.indexOf(a.skill_id) -
          record.skill_ids.indexOf(b.skill_id)
      );
    if (cellsOfQ.length === 0) continue;

    // a. 该 query 的整段文字一次写入
    const queryHeader = `\n## Q${qi + 1}\n\n> ${record.queries[qi].replace(/\n/g, "\n> ")}\n\n`;
    const cellTexts = cellsOfQ.map((c) => cellMarkdown(record, c)).join("\n");
    const mergedMd = queryHeader + cellTexts;
    try {
      await runLarkCli(
        [
          "docs",
          "+update",
          "--doc",
          docId,
          "--mode",
          "append",
          "--markdown",
          mergedMd,
        ],
        { timeoutMs: 30_000 } // 合并后 md 体量大,timeout 拉到 30s
      );
    } catch (e) {
      // 整段文字失败:本 query 全部 cell 都标失败原因(便于 dialog 展示),
      // 但图照样 try(图独立传不受 doc 文字状态影响)
      const reason = `append md 失败:${e instanceof LarkCliError ? e.message : String(e)}`;
      for (const c of cellsOfQ) {
        result.failures.push({
          query_idx: c.query_idx,
          skill_id: c.skill_id,
          reason,
        });
      }
    }

    // b. 该 query 的图并发上传(并发 4)
    const cellsWithImg = cellsOfQ
      .map((cell) => ({
        cell,
        hit: resolveLocalImage(cell.image_urls?.[0]),
      }))
      .filter((x): x is { cell: BatchCell; hit: NonNullable<typeof x.hit> } =>
        x.hit !== null
      );

    await parallelLimit(cellsWithImg, 4, async ({ cell, hit }) => {
      const imgDir = path.dirname(hit.absPath);
      const imgName = path.basename(hit.absPath);
      try {
        await runLarkCli(
          [
            "docs",
            "+media-insert",
            "--doc",
            docId,
            "--file",
            `./${imgName}`,
            "--align",
            "center",
            "--caption",
            `Q${cell.query_idx + 1} · ${cell.skill_id}`,
          ],
          { timeoutMs: 60_000, cwd: imgDir }
        );
        result.image_uploaded++;
      } catch (e) {
        result.image_failed++;
        result.failures.push({
          query_idx: cell.query_idx,
          skill_id: cell.skill_id,
          reason: `图上传失败:${e instanceof LarkCliError ? e.message : String(e)}`,
        });
      }
    });

    result.cells_processed += cellsOfQ.length;
  }

  return result;
}

// 简单 promise pool。items 顺序保留(就算并发,worker 按 cursor 顺序拉),
// 但完成顺序不保证 —— fn 自己内部要处理"我跑完了" 的状态,不依赖外面的 i 顺序。
// fn 失败由调用方在 try/catch 里累计,这里不 reject 整组(避免一个失败拖死所有).
async function parallelLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}
