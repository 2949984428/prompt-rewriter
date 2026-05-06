// prompt-rewriter/lib/export/build-html.ts
//
// 把一个 BatchRunRecord 渲染成自包含的静态 HTML 字符串。
// 给两个调用方共用:
//   - 单文件 HTML 模式:resolveImageSrc 返回 base64 data URL
//   - ZIP 模式:resolveImageSrc 返回相对路径 "images/q01_F4-..."
//
// 视觉走 Anthropic 暖色 + 衬线规范(see DESIGN-claude.md)。
// 全部 CSS inline,接收方双击 .html 直接看,不依赖任何外部资源。

import type { BatchRunRecord, BatchCell } from "@/lib/schema";

export type BuildHtmlOptions = {
  // 给定 cell,返回该 cell 第一张图的 src(data URL 或相对路径)。
  // 没图 / 失败时返回 null,模板会显示占位
  resolveImageSrc: (cell: BatchCell) => Promise<string | null>;
  // 是否包含 status === "excluded" 的 cell(默认 false)
  includeExcluded?: boolean;
};

// ─────────── HTML 转义工具 ───────────
const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
function esc(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

// 维度 id → label 映射(读 record.scoring_dimensions)
function dimLabel(record: BatchRunRecord, dimId: string): string {
  const d = record.scoring_dimensions.find((x) => x.id === dimId);
  return d?.label ?? dimId;
}

// 单 cell 平均分(只算非 0 分)
function avgScore(cell: BatchCell): number | null {
  const vals = Object.values(cell.scores).filter((v) => v > 0);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// 排行榜:按 skill 聚合所有 cell 的平均分,倒序
function leaderboard(record: BatchRunRecord) {
  const bySkill = new Map<
    string,
    { sum: number; count: number; ratedCount: number; total: number }
  >();
  for (const c of record.cells) {
    if (c.status === "excluded") continue;
    const cur = bySkill.get(c.skill_id) ?? {
      sum: 0,
      count: 0,
      ratedCount: 0,
      total: 0,
    };
    cur.total += 1;
    if (c.status === "done") cur.count += 1;
    const a = avgScore(c);
    if (a != null) {
      cur.sum += a;
      cur.ratedCount += 1;
    }
    bySkill.set(c.skill_id, cur);
  }
  const rows = Array.from(bySkill.entries()).map(([skill, v]) => ({
    skill,
    avg: v.ratedCount > 0 ? v.sum / v.ratedCount : null,
    rated: v.ratedCount,
    done: v.count,
    total: v.total,
  }));
  rows.sort((a, b) => {
    if (a.avg == null && b.avg == null) return 0;
    if (a.avg == null) return 1;
    if (b.avg == null) return -1;
    return b.avg - a.avg;
  });
  return rows;
}

// ─────────── 主入口 ───────────
export async function buildHtml(
  record: BatchRunRecord,
  opts: BuildHtmlOptions
): Promise<string> {
  const includeExcluded = opts.includeExcluded ?? false;
  const visibleCells = record.cells.filter(
    (c) => includeExcluded || c.status !== "excluded"
  );

  const date = new Date(record.created_at).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
  });

  // 预先解析所有图(并发),HTML 字符串拼接才能用同步形式
  const imgMap = new Map<string, string | null>();
  await Promise.all(
    visibleCells.map(async (c) => {
      const key = `${c.query_idx}::${c.skill_id}`;
      const src = await opts.resolveImageSrc(c);
      imgMap.set(key, src);
    })
  );

  const lb = leaderboard(record);

  // 按 query 分组(保持原 query 顺序)
  const byQuery: { qi: number; query: string; cells: BatchCell[] }[] = [];
  for (let qi = 0; qi < record.queries.length; qi++) {
    const cells = visibleCells
      .filter((c) => c.query_idx === qi)
      .sort(
        (a, b) =>
          record.skill_ids.indexOf(a.skill_id) -
          record.skill_ids.indexOf(b.skill_id)
      );
    if (cells.length === 0) continue;
    byQuery.push({ qi, query: record.queries[qi], cells });
  }

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(record.name || "批量测试报告")} · ${esc(date)}</title>
<style>
  :root {
    --bg: #f5f4ed;
    --card: #faf9f5;
    --border: #f0eee6;
    --border-strong: #e8e6dc;
    --near-black: #141413;
    --olive-gray: #5e5d59;
    --stone-gray: #87867f;
    --terracotta: #c96442;
    --warm-gold-bg: #f5ecd0;
    --warm-gold-fg: #997a3a;
    --error: #b32f2f;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--near-black);
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    padding: 32px 0 64px;
  }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 0 24px; }
  h1, h2, h3 { font-family: "Anthropic Serif", "EB Garamond", Georgia, serif; font-weight: 500; letter-spacing: -0.01em; }
  h1 { font-size: 28px; line-height: 1.2; margin: 0 0 8px; }
  h2 { font-size: 20px; line-height: 1.3; margin: 36px 0 12px; padding-top: 16px; border-top: 1px solid var(--border-strong); }
  h3 { font-size: 15px; line-height: 1.3; margin: 0 0 6px; font-weight: 500; }
  .sub { color: var(--olive-gray); font-size: 13.5px; margin: 0 0 24px; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px 16px; font-size: 12.5px; color: var(--stone-gray); }
  .meta b { color: var(--near-black); font-weight: 500; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px 18px; }
  .lb { width: 100%; border-collapse: collapse; font-size: 13.5px; margin-top: 8px; }
  .lb th, .lb td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
  .lb th { font-weight: 500; color: var(--stone-gray); font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; }
  .lb tbody tr:last-child td { border-bottom: none; }
  .lb td.rank { width: 32px; color: var(--stone-gray); font-family: "SF Mono", Menlo, monospace; }
  .lb td.skill { font-family: "SF Mono", Menlo, monospace; }
  .lb td.score { font-family: "SF Mono", Menlo, monospace; font-weight: 500; }
  .lb td.score.gold { color: var(--warm-gold-fg); }
  .query { margin-top: 24px; }
  .query-hd { display: flex; gap: 12px; margin-bottom: 12px; }
  .query-hd .qid { font-family: "SF Mono", Menlo, monospace; color: var(--stone-gray); font-size: 12px; flex-shrink: 0; padding-top: 1px; }
  .query-hd .qtext { flex: 1; font-size: 15px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
  .cell { background: var(--card); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; }
  .cell.winner { border-color: var(--terracotta); box-shadow: 0 0 0 1px var(--terracotta); }
  .cell.failed { border-color: rgba(179, 47, 47, 0.4); background: #fdf2ef; }
  .cell.excluded { opacity: 0.55; }
  .cell-img { background: var(--bg); position: relative; aspect-ratio: 1 / 1; display: flex; align-items: center; justify-content: center; }
  .cell-img img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
  .cell-img .ph { color: var(--stone-gray); font-size: 12px; padding: 24px; text-align: center; }
  .cell-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--border); }
  .cell-hd { display: flex; align-items: baseline; gap: 8px; }
  .cell-hd .label { font-family: "SF Mono", Menlo, monospace; font-size: 12.5px; font-weight: 500; }
  .cell-hd .badge { font-size: 10px; padding: 1px 6px; border-radius: 999px; background: var(--terracotta); color: #faf9f5; font-family: "SF Mono", Menlo, monospace; letter-spacing: 0.04em; }
  .scores { font-size: 11.5px; color: var(--olive-gray); }
  .scores .star { color: var(--warm-gold-fg); font-weight: 500; font-family: "SF Mono", Menlo, monospace; }
  .note { font-size: 12.5px; color: var(--olive-gray); font-style: italic; line-height: 1.4; padding-top: 4px; border-top: 1px dashed var(--border); }
  details { font-size: 12.5px; color: var(--olive-gray); margin-top: 2px; }
  details summary { cursor: pointer; user-select: none; padding: 4px 0; color: var(--stone-gray); font-family: "SF Mono", Menlo, monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  details pre { margin: 4px 0 0; padding: 8px 10px; background: var(--bg); border-radius: 4px; font: 12px/1.55 "SF Mono", Menlo, monospace; white-space: pre-wrap; word-break: break-word; max-height: 360px; overflow: auto; color: var(--near-black); }
  .err { color: var(--error); font-size: 11.5px; padding: 4px 0; font-family: "SF Mono", Menlo, monospace; word-break: break-word; }
  .footer { margin-top: 48px; text-align: center; color: var(--stone-gray); font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${esc(record.name || "(未命名跑批)")}</h1>
    <p class="sub">批量测试报告</p>
    <div class="meta">
      <span><b>跑批时间</b> ${esc(date)}</span>
      <span><b>规模</b> ${record.queries.length} query × ${record.skill_ids.length} skill = ${record.cells.length} cell</span>
      <span><b>模式</b> ${esc(record.query_mode)}</span>
      <span><b>改写模型</b> ${esc(record.rewrite_llm || "(默认)")}</span>
      <span><b>状态</b> ${esc(record.status)}</span>
    </div>
    ${record.purpose ? `<p class="sub" style="margin-top: 12px;"><b>测试目的</b>:${esc(record.purpose)}</p>` : ""}
  </header>

  <h2>排行榜</h2>
  <div class="card" style="padding: 8px 12px;">
    <table class="lb">
      <thead>
        <tr><th class="rank">#</th><th>Skill</th><th>平均分</th><th>已评 / 完成 / 总数</th></tr>
      </thead>
      <tbody>
        ${lb
          .map(
            (r, i) => `
          <tr>
            <td class="rank">${i + 1}</td>
            <td class="skill">${esc(r.skill)}</td>
            <td class="score${i === 0 && r.avg != null ? " gold" : ""}">${r.avg != null ? r.avg.toFixed(2) : "—"}</td>
            <td>${r.rated} / ${r.done} / ${r.total}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
  </div>

  ${byQuery
    .map(
      (q) => `
    <section class="query">
      <h2>Q${q.qi + 1}</h2>
      <div class="query-hd">
        <span class="qid">query</span>
        <div class="qtext">${esc(q.query)}</div>
      </div>
      <div class="grid">
        ${q.cells.map((c) => renderCell(c, record, imgMap.get(`${c.query_idx}::${c.skill_id}`) ?? null)).join("")}
      </div>
    </section>`
    )
    .join("")}

  <div class="footer">由 prompt-rewriter 批量测试台导出 · ${new Date().toLocaleDateString("zh-CN")}</div>
</div>
</body>
</html>`;
}

function renderCell(
  cell: BatchCell,
  record: BatchRunRecord,
  imgSrc: string | null
): string {
  const cls: string[] = ["cell"];
  if (cell.status === "failed") cls.push("failed");
  if (cell.status === "excluded") cls.push("excluded");

  // 顶部 image
  let imgHtml: string;
  if (imgSrc) {
    imgHtml = `<img src="${esc(imgSrc)}" alt="${esc(cell.skill_id)}" loading="lazy">`;
  } else if (cell.status === "failed") {
    imgHtml = `<div class="ph">⚠ 失败</div>`;
  } else if (cell.status === "excluded") {
    imgHtml = `<div class="ph">已排除</div>`;
  } else {
    imgHtml = `<div class="ph">无图</div>`;
  }

  // 评分
  const avg = avgScore(cell);
  const scoredEntries = Object.entries(cell.scores).filter(([, v]) => v > 0);
  const scoreText =
    scoredEntries.length > 0
      ? `<span class="star">★ ${avg!.toFixed(1)}</span> · ${scoredEntries
          .map(([dim, v]) => `${esc(dimLabel(record, dim))} ${v}`)
          .join(" · ")}`
      : `<span style="color: var(--stone-gray);">未评分</span>`;

  // final_prompt 折叠
  const fpHtml = cell.final_prompt
    ? `<details><summary>final_prompt · ${esc(cell.final_prompt.size ?? "auto")} · ${esc(cell.final_prompt.quality ?? "auto")}</summary><pre>${esc(cell.final_prompt.prompt)}</pre></details>`
    : "";

  const errHtml = cell.error
    ? `<div class="err">${esc(cell.error)}</div>`
    : "";

  const noteHtml = cell.note
    ? `<div class="note">${esc(cell.note)}</div>`
    : "";

  return `<div class="${cls.join(" ")}">
    <div class="cell-img">${imgHtml}</div>
    <div class="cell-body">
      <div class="cell-hd">
        <span class="label">${esc(cell.skill_id)}</span>
      </div>
      <div class="scores">${scoreText}</div>
      ${noteHtml}
      ${fpHtml}
      ${errHtml}
    </div>
  </div>`;
}
