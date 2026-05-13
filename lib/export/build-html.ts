// prompt-rewriter/lib/export/build-html.ts
//
// 把一个 BatchRunRecord 渲染成自包含的静态 HTML 字符串。
// 给两个调用方共用:
//   - 单文件 HTML 模式:resolveImageSrc 返回 base64 data URL
//   - ZIP 模式:resolveImageSrc 返回相对路径 "images/q01_<skill>_<model>.png"
//
// 布局对齐 batch lab 详情页(`components/labs/batch/grid-view.tsx`)的切 tab UX:
//   1. 顶部 header / meta(始终可见)
//   2. 完整排行榜(<details> 折叠,默认收起)
//   3. Toolbar:
//      - axis toggle:[Skill] [Model] —— 切换"列代表什么维度"
//      - chip 行:axis=skill 时显示生图模型 chip;axis=model 时显示 skill chip
//   4. 切片矩阵:预渲染 skillCount + modelCount 套表格,根据 axis + chip 选中值切 hidden
//
// 极简 inline JS(~40 行)接管所有点击切换,无外部依赖。
//
// 单维度退化:
//   - 1 model + N skill → axis 锁 skill,toolbar 整个不渲染,只 1 套表格
//   - N model + 1 skill → axis 锁 model,toolbar 整个不渲染,只 1 套表格
//   - 1 skill + 1 model → 无 toolbar,1 套表格
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
  // 可选的 id → 显示名映射,UI 里 `formatSkillsAtom` / `imageGeneratorOptionsAtom` 同款数据
  // 不传时回退到 id 本身(也能看,只是 PM 评审时不直观)
  skillLabels?: Record<string, string>;
  modelLabels?: Record<string, string>;
  // Phase 2 pipeline 测试台:test_kind="pipeline" 时列轴换成 pipeline_ids,
  // 这里传 pipeline_id → 显示名映射(不传 fallback id)
  pipelineLabels?: Record<string, string>;
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

// 每个 cell 的"列轴 id"(skill 模式取 skill_id,pipeline 模式取 pipeline_id)
function colIdOf(c: BatchCell, isPipeline: boolean): string {
  return isPipeline ? c.pipeline_id || "" : c.skill_id || "";
}

// 排行榜:按 (col, model) 组合聚合,倒序;单 model 模式回退到只按 col
function leaderboard(
  record: BatchRunRecord,
  multiModel: boolean,
  isPipeline: boolean,
) {
  const groups = new Map<
    string,
    {
      col: string;
      model: string;
      sum: number;
      count: number;
      ratedCount: number;
      total: number;
    }
  >();
  for (const c of record.cells) {
    if (c.status === "excluded") continue;
    const colId = colIdOf(c, isPipeline);
    const key = multiModel
      ? `${colId}|${c.image_model ?? ""}`
      : colId;
    const cur = groups.get(key) ?? {
      col: colId,
      model: c.image_model ?? "",
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
    groups.set(key, cur);
  }
  const rows = Array.from(groups.values()).map((v) => ({
    col: v.col,
    model: v.model,
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

// 进度统计:某个维度的某个值下,done / total 各多少
function progressCount(
  cells: BatchCell[],
  predicate: (c: BatchCell) => boolean,
): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const c of cells) {
    if (!predicate(c)) continue;
    total += 1;
    if (c.status === "done") done += 1;
  }
  return { done, total };
}

// ─────────── 主入口 ───────────
export async function buildHtml(
  record: BatchRunRecord,
  opts: BuildHtmlOptions,
): Promise<string> {
  const includeExcluded = opts.includeExcluded ?? false;
  const skillLabels = opts.skillLabels ?? {};
  const modelLabels = opts.modelLabels ?? {};
  const pipelineLabels = opts.pipelineLabels ?? {};

  // test_kind 决定列轴指什么:skill / pipeline
  const isPipeline = record.test_kind === "pipeline";
  const colKindLabel = isPipeline ? "Pipeline" : "Skill";
  const colKindLower = isPipeline ? "pipeline" : "skill";

  const labelOfSkill = (id: string) => skillLabels[id] ?? id;
  const labelOfPipeline = (id: string) => pipelineLabels[id] ?? id;
  const labelOfCol = isPipeline ? labelOfPipeline : labelOfSkill;
  const labelOfModel = (id: string) =>
    id === "" ? "默认" : modelLabels[id] ?? id;

  const visibleCells = record.cells.filter(
    (c) => includeExcluded || c.status !== "excluded",
  );

  const date = new Date(record.created_at).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
  });

  // 模型列表
  const modelList = (() => {
    if (record.image_model_ids && record.image_model_ids.length > 0) {
      return record.image_model_ids;
    }
    const set = new Set<string>();
    record.cells.forEach((c) => set.add(c.image_model ?? ""));
    const arr = Array.from(set);
    if (arr.length === 0) arr.push(record.image_model ?? "");
    return arr;
  })();
  // 列轴 ids:skill 模式 = record.skill_ids,pipeline 模式 = record.pipeline_ids
  const skillList: string[] = isPipeline
    ? record.pipeline_ids ?? []
    : record.skill_ids;
  const multiModel = modelList.length > 1;
  const multiSkill = skillList.length > 1;
  // 只有两边都多个时才显示 axis toggle + chip(单维度直接锁死)
  const showAxisToggle = multiModel && multiSkill;
  // toolbar 显示条件:任一维度 > 1 就需要选择(>1 model 切 model,>1 skill 切 skill)
  // 但当只有 1 维 > 1 时不需要 axis toggle,只有 chip
  // 实际上:1 skill + N model → 列锁定 model,无需 chip(数据已经是 N 列);** chip 只在另一维度 > 1 时显示**
  // 综合:multiSkill && multiModel → toolbar 完整;只一个 multi → 无 toolbar(列轴锁定唯一多的那个)

  // 默认 axis / tab
  const defaultAxis: "skill" | "model" = multiSkill ? "skill" : "model";
  const defaultTabModel = modelList[0] ?? "";
  const defaultTabSkill = skillList[0] ?? "";

  // (q, col, model) → cell 索引;col = skill_id 或 pipeline_id(按 test_kind)
  const cellIndex = new Map<string, BatchCell>();
  for (const c of visibleCells) {
    cellIndex.set(
      `${c.query_idx}::${colIdOf(c, isPipeline)}::${c.image_model ?? ""}`,
      c,
    );
  }

  // 预解析所有图(并发)
  const imgMap = new Map<string, string | null>();
  await Promise.all(
    visibleCells.map(async (c) => {
      const key = `${c.query_idx}::${colIdOf(c, isPipeline)}::${c.image_model ?? ""}`;
      const src = await opts.resolveImageSrc(c);
      imgMap.set(key, src);
    }),
  );

  const lb = leaderboard(record, multiModel, isPipeline);

  // 仅保留有数据的 query 索引
  const queryList: Array<{ qi: number; query: string }> = [];
  for (let qi = 0; qi < record.queries.length; qi++) {
    if (!visibleCells.some((c) => c.query_idx === qi)) continue;
    queryList.push({ qi, query: record.queries[qi] });
  }

  // 计算要预渲染哪些切片:
  //   showAxisToggle = true   → axis=skill 时切 modelCount 套,axis=model 时切 skillCount 套
  //   showAxisToggle = false  → 只 1 套(axis 已锁定唯一可选)
  type Slice = { axis: "skill" | "model"; tab: string };
  const slices: Slice[] = [];
  if (showAxisToggle) {
    for (const m of modelList) slices.push({ axis: "skill", tab: m });
    for (const s of skillList) slices.push({ axis: "model", tab: s });
  } else if (multiModel) {
    // 单 skill 多 model:列=model,无需 chip
    slices.push({ axis: "model", tab: skillList[0] });
  } else {
    // 单 model(可能多 skill 也可能单 skill):列=skill,无需 chip
    slices.push({ axis: "skill", tab: modelList[0] ?? "" });
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
    --warm-sand: #e8e6dc;
    --warm-tea-bg: #f5ecd0;
    --warm-tea-fg: #997a3a;
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
  .wrap { max-width: 1480px; margin: 0 auto; padding: 0 24px; }
  h1, h2, h3 { font-family: "Anthropic Serif", "EB Garamond", Georgia, serif; font-weight: 500; letter-spacing: -0.01em; }
  h1 { font-size: 28px; line-height: 1.2; margin: 0 0 8px; }
  h3 { font-size: 15px; line-height: 1.3; margin: 0 0 6px; font-weight: 500; }
  .sub { color: var(--olive-gray); font-size: 13.5px; margin: 0 0 24px; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px 16px; font-size: 12.5px; color: var(--stone-gray); }
  .meta b { color: var(--near-black); font-weight: 500; }

  /* 排行榜折叠 */
  .lb-wrap { margin: 20px 0 28px; }
  .lb-wrap > summary {
    cursor: pointer;
    user-select: none;
    padding: 10px 14px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 13.5px;
    color: var(--near-black);
    list-style: none;
  }
  .lb-wrap > summary::-webkit-details-marker { display: none; }
  .lb-wrap > summary::before { content: "▸ "; color: var(--stone-gray); font-family: "SF Mono", Menlo, monospace; }
  .lb-wrap[open] > summary::before { content: "▾ "; }
  .lb-wrap > summary .top {
    font-family: "SF Mono", Menlo, monospace;
    font-size: 11.5px;
    color: var(--warm-tea-fg);
    margin-left: 8px;
  }
  .lb-body { margin-top: 8px; padding: 8px 12px; background: var(--card); border: 1px solid var(--border); border-radius: 8px; }
  .lb { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .lb th, .lb td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
  .lb th { font-weight: 500; color: var(--stone-gray); font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; }
  .lb tbody tr:last-child td { border-bottom: none; }
  .lb td.rank { width: 32px; color: var(--stone-gray); font-family: "SF Mono", Menlo, monospace; }
  .lb td.skill, .lb td.model { font-family: "SF Mono", Menlo, monospace; }
  .lb td.score { font-family: "SF Mono", Menlo, monospace; font-weight: 500; }
  .lb td.score.gold { color: var(--warm-tea-fg); }

  /* Toolbar */
  .toolbar {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 14px;
    margin-bottom: 12px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 20px;
  }
  .toolbar-section { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .toolbar-label {
    font-family: "SF Mono", Menlo, monospace;
    font-size: 11px;
    color: var(--stone-gray);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    user-select: none;
  }
  .ax-toggle { display: inline-flex; padding: 2px; border: 1px solid var(--border); background: var(--bg); border-radius: 6px; }
  .ax-btn {
    appearance: none; border: 0; background: transparent;
    padding: 4px 12px; font-family: "SF Mono", Menlo, monospace; font-size: 12px;
    color: var(--olive-gray); cursor: pointer; border-radius: 4px;
  }
  .ax-btn.active { background: var(--terracotta); color: var(--card); font-weight: 500; }
  .ax-btn:not(.active):hover { background: var(--warm-sand); color: var(--near-black); }

  .chip {
    appearance: none; border: 1px solid var(--border); background: var(--bg);
    padding: 5px 12px; font-size: 12.5px; color: var(--olive-gray);
    cursor: pointer; border-radius: 999px;
    display: inline-flex; align-items: baseline; gap: 6px;
  }
  .chip:hover { background: var(--warm-sand); color: var(--near-black); }
  .chip.active { background: var(--terracotta); color: var(--card); border-color: var(--terracotta); font-weight: 500; }
  .chip .count { font-family: "SF Mono", Menlo, monospace; font-size: 10.5px; opacity: 0.7; }
  .chip.active .count { color: var(--card); opacity: 0.9; }

  /* axis toggle 控制哪一行 chip 可见(CSS attribute selector,无 JS 闪烁) */
  .report[data-axis="skill"] .chip-row[data-for="skill"] { display: none; }
  .report[data-axis="model"] .chip-row[data-for="model"] { display: none; }

  /* 矩阵表格(每套切片一份) */
  .matrix[hidden] { display: none; }
  .matrix {
    display: grid;
    gap: 0;
    overflow-x: auto;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .m-corner {
    grid-row: 1; grid-column: 1;
    background: var(--bg);
    color: var(--stone-gray);
    font-family: "SF Mono", Menlo, monospace;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 14px 16px;
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    position: sticky; left: 0; z-index: 2;
  }
  .m-col-hd {
    grid-row: 1;
    background: var(--bg);
    padding: 14px 18px;
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }
  .m-col-hd:last-child { border-right: none; }
  .m-col-hd .name {
    font-family: "Anthropic Serif", "EB Garamond", Georgia, serif;
    font-size: 16px; font-weight: 500; color: var(--near-black); line-height: 1.3;
  }
  .m-col-hd .id {
    font-family: "SF Mono", Menlo, monospace;
    font-size: 11.5px; color: var(--stone-gray); margin-top: 3px;
  }
  .m-qhd {
    grid-column: 1;
    background: var(--card);
    padding: 18px 16px;
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    position: sticky; left: 0; z-index: 1;
    display: flex; flex-direction: column; gap: 6px;
  }
  .m-qhd .qid {
    font-family: "SF Mono", Menlo, monospace;
    font-size: 11px; color: var(--stone-gray);
    text-transform: uppercase; letter-spacing: 0.06em;
  }
  .m-qhd .qtext {
    font-size: 14px; line-height: 1.5; color: var(--near-black);
    white-space: pre-wrap; word-break: break-word;
  }

  .cell {
    background: var(--card);
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    overflow: hidden;
    display: flex; flex-direction: column;
    min-width: 0;
  }
  .cell:last-child { border-right: none; }
  .cell.winner { box-shadow: inset 0 0 0 2px var(--terracotta); }
  .cell.failed { background: #fdf2ef; }
  .cell.excluded { opacity: 0.55; }
  .cell.empty {
    background: var(--bg);
    display: flex; align-items: center; justify-content: center;
    color: var(--stone-gray); font-size: 12px; min-height: 200px;
  }
  .cell-img {
    background: var(--bg); position: relative;
    aspect-ratio: 1 / 1;
    display: flex; align-items: center; justify-content: center;
  }
  .cell-img img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
  .cell-img .ph { color: var(--stone-gray); font-size: 12px; padding: 24px; text-align: center; }
  .cell-body {
    padding: 10px 12px; display: flex; flex-direction: column; gap: 4px;
    border-top: 1px solid var(--border); font-size: 12px; background: var(--card);
  }
  .scores .star { color: var(--warm-tea-fg); font-weight: 500; font-family: "SF Mono", Menlo, monospace; }
  .scores .none { color: var(--stone-gray); }
  .note { font-size: 11.5px; color: var(--olive-gray); font-style: italic; line-height: 1.4; padding-top: 4px; border-top: 1px dashed var(--border); }
  details.fp { font-size: 11.5px; color: var(--olive-gray); margin-top: 2px; }
  details.fp summary {
    cursor: pointer; user-select: none; padding: 3px 0;
    color: var(--stone-gray); font-family: "SF Mono", Menlo, monospace;
    font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em;
  }
  details.fp pre {
    margin: 4px 0 0; padding: 8px 10px; background: var(--bg); border-radius: 4px;
    font: 11.5px/1.55 "SF Mono", Menlo, monospace;
    white-space: pre-wrap; word-break: break-word;
    max-height: 300px; overflow: auto; color: var(--near-black);
  }
  .err { color: var(--error); font-size: 11px; padding: 3px 0; font-family: "SF Mono", Menlo, monospace; word-break: break-word; }
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
      <span><b>规模</b> ${record.queries.length} query × ${skillList.length} ${colKindLower}${multiModel ? ` × ${modelList.length} model` : ""} = ${record.cells.length} cell</span>
      <span><b>测试种类</b> ${colKindLabel}</span>
      <span><b>模式</b> ${esc(record.query_mode)}</span>
      <span><b>改写模型</b> ${esc(record.rewrite_llm || "(默认)")}</span>
      <span><b>状态</b> ${esc(record.status)}</span>
    </div>
    ${record.purpose ? `<p class="sub" style="margin-top: 12px;"><b>测试目的</b>:${esc(record.purpose)}</p>` : ""}
  </header>

  ${renderLeaderboardDetails(lb, multiModel, labelOfCol, labelOfModel, colKindLabel)}

  <div class="report" data-axis="${defaultAxis}" data-tab-model="${esc(defaultTabModel)}" data-tab-skill="${esc(defaultTabSkill)}">
    ${renderToolbar(
      showAxisToggle,
      defaultAxis,
      defaultTabModel,
      defaultTabSkill,
      skillList,
      modelList,
      visibleCells,
      labelOfCol,
      labelOfModel,
      colKindLabel,
      isPipeline,
    )}

    ${slices
      .map((sl) =>
        renderMatrix(
          sl,
          sl.axis === sl.axis && sl.tab === (sl.axis === "skill" ? defaultTabModel : defaultTabSkill),
          skillList,
          modelList,
          queryList,
          cellIndex,
          imgMap,
          record,
          labelOfCol,
          labelOfModel,
          colKindLower,
          isPipeline,
        ),
      )
      .join("")}
  </div>

  ${showAxisToggle ? INLINE_TOGGLE_SCRIPT : ""}

  <div class="footer">由 prompt-rewriter 批量测试台导出 · ${new Date().toLocaleDateString("zh-CN")}</div>
</div>
</body>
</html>`;
}

// ─────────── 排行榜(折叠) ───────────
function renderLeaderboardDetails(
  lb: ReturnType<typeof leaderboard>,
  multiModel: boolean,
  labelOfCol: (id: string) => string,
  labelOfModel: (id: string) => string,
  colKindLabel: string,
): string {
  const top = lb[0];
  const topText =
    top && top.avg != null
      ? ` · 当前榜首 ${esc(labelOfCol(top.col))}${multiModel ? " × " + esc(labelOfModel(top.model)) : ""} ★ ${top.avg.toFixed(2)}`
      : "";
  return `<details class="lb-wrap">
    <summary>完整排行榜${multiModel ? `(${colKindLabel.toLowerCase()} × model 组合)` : ""}<span class="top">${topText}</span></summary>
    <div class="lb-body">
      <table class="lb">
        <thead>
          <tr>
            <th class="rank">#</th>
            <th>${colKindLabel}</th>
            ${multiModel ? "<th>Model</th>" : ""}
            <th>平均分</th>
            <th>已评 / 完成 / 总数</th>
          </tr>
        </thead>
        <tbody>
          ${lb
            .map(
              (r, i) => `<tr>
              <td class="rank">${i + 1}</td>
              <td class="skill">${esc(labelOfCol(r.col))}<div style="font-size:10.5px;color:var(--stone-gray);">${esc(r.col)}</div></td>
              ${multiModel ? `<td class="model">${esc(labelOfModel(r.model))}<div style="font-size:10.5px;color:var(--stone-gray);">${esc(r.model || "")}</div></td>` : ""}
              <td class="score${i === 0 && r.avg != null ? " gold" : ""}">${r.avg != null ? r.avg.toFixed(2) : "—"}</td>
              <td>${r.rated} / ${r.done} / ${r.total}</td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  </details>`;
}

// ─────────── Toolbar(横轴 toggle + chip 行 ×2) ───────────
function renderToolbar(
  showAxisToggle: boolean,
  defaultAxis: "skill" | "model",
  defaultTabModel: string,
  defaultTabSkill: string,
  skillList: string[],
  modelList: string[],
  visibleCells: BatchCell[],
  labelOfCol: (id: string) => string,
  labelOfModel: (id: string) => string,
  colKindLabel: string,
  isPipeline: boolean,
): string {
  if (!showAxisToggle) {
    // 单维度不需要 toolbar
    return "";
  }
  const modelChips = modelList
    .map((m) => {
      const p = progressCount(
        visibleCells,
        (c) => (c.image_model ?? "") === m,
      );
      const active = m === defaultTabModel;
      return `<button class="chip${active ? " active" : ""}" data-chip="model" data-val="${esc(m)}">
        <span>${esc(labelOfModel(m))}</span>
        <span class="count">${p.done}/${p.total}</span>
      </button>`;
    })
    .join("");
  const colChips = skillList
    .map((s) => {
      const p = progressCount(
        visibleCells,
        (c) => (isPipeline ? c.pipeline_id : c.skill_id) === s,
      );
      const active = s === defaultTabSkill;
      return `<button class="chip${active ? " active" : ""}" data-chip="skill" data-val="${esc(s)}">
        <span>${esc(labelOfCol(s))}</span>
        <span class="count">${p.done}/${p.total}</span>
      </button>`;
    })
    .join("");
  return `<div class="toolbar">
    <div class="toolbar-section">
      <span class="toolbar-label">横轴</span>
      <div class="ax-toggle">
        <button class="ax-btn${defaultAxis === "skill" ? " active" : ""}" data-axis-btn="skill">${colKindLabel}</button>
        <button class="ax-btn${defaultAxis === "model" ? " active" : ""}" data-axis-btn="model">Model</button>
      </div>
    </div>
    <div class="toolbar-section chip-row" data-for="model">
      <span class="toolbar-label">生图模型</span>
      ${modelChips}
    </div>
    <div class="toolbar-section chip-row" data-for="skill">
      <span class="toolbar-label">${colKindLabel}</span>
      ${colChips}
    </div>
  </div>`;
}

// ─────────── 单切片矩阵(N query × axis_items) ───────────
function renderMatrix(
  slice: { axis: "skill" | "model"; tab: string },
  visible: boolean,
  skillList: string[],
  modelList: string[],
  queryList: Array<{ qi: number; query: string }>,
  cellIndex: Map<string, BatchCell>,
  imgMap: Map<string, string | null>,
  record: BatchRunRecord,
  labelOfCol: (id: string) => string,
  labelOfModel: (id: string) => string,
  colKindLower: string,
  // 是否 pipeline 模式 — 这里其实不用,因为 cellIndex 已经用 colIdOf 建好了 key,
  // 这里 slice.axis === "skill" 时塞的就是 pipeline_id 的列,语义一致
  _isPipeline: boolean,
): string {
  const colItems = slice.axis === "skill" ? skillList : modelList;
  const colLabelOf = slice.axis === "skill" ? labelOfCol : labelOfModel;
  const cornerText =
    slice.axis === "skill" ? `query \\ ${colKindLower}` : "query \\ model";

  const queryColW = 260;
  const colW = 340;
  const totalMinW = queryColW + colItems.length * colW;
  const gridStyle = `grid-template-columns: ${queryColW}px repeat(${colItems.length}, minmax(${colW}px, 1fr)); min-width: ${totalMinW}px;`;

  // 列头
  const header = `
    <div class="m-corner">${cornerText}</div>
    ${colItems
      .map(
        (x) => `<div class="m-col-hd">
        <div class="name">${esc(colLabelOf(x))}</div>
        <div class="id">${esc(x || "默认")}</div>
      </div>`,
      )
      .join("")}`;

  // 数据 rows
  const rows = queryList
    .map(
      (q) => `
    <div class="m-qhd">
      <div class="qid">Q${q.qi + 1}</div>
      <div class="qtext">${esc(q.query)}</div>
    </div>
    ${colItems
      .map((x) => {
        // axis=skill(列轴=skill_id 或 pipeline_id,跟着 test_kind):
        //   单元格 = (q, col=x, model=slice.tab)
        // axis=model(列轴=model):
        //   单元格 = (q, col=slice.tab, model=x)
        const col = slice.axis === "skill" ? x : slice.tab;
        const model = slice.axis === "skill" ? slice.tab : x;
        const key = `${q.qi}::${col}::${model}`;
        const cell = cellIndex.get(key);
        if (!cell) {
          return `<div class="cell empty">(未跑批)</div>`;
        }
        return renderCell(cell, record, imgMap.get(key) ?? null);
      })
      .join("")}`,
    )
    .join("");

  return `<div class="matrix" data-matrix-axis="${slice.axis}" data-matrix-tab="${esc(slice.tab)}" style="${gridStyle}"${visible ? "" : " hidden"}>${header}${rows}</div>`;
}

function renderCell(
  cell: BatchCell,
  record: BatchRunRecord,
  imgSrc: string | null,
): string {
  const cls: string[] = ["cell"];
  if (cell.status === "failed") cls.push("failed");
  if (cell.status === "excluded") cls.push("excluded");

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

  const avg = avgScore(cell);
  const scoredEntries = Object.entries(cell.scores).filter(([, v]) => v > 0);
  const scoreText =
    scoredEntries.length > 0
      ? `<span class="star">★ ${avg!.toFixed(1)}</span> · ${scoredEntries
          .map(([dim, v]) => `${esc(dimLabel(record, dim))} ${v}`)
          .join(" · ")}`
      : `<span class="none">未评分</span>`;

  const fpHtml = cell.final_prompt
    ? `<details class="fp"><summary>final_prompt · ${esc(cell.final_prompt.size ?? "auto")} · ${esc(cell.final_prompt.quality ?? "auto")}</summary><pre>${esc(cell.final_prompt.prompt)}</pre></details>`
    : "";

  const errHtml = cell.error ? `<div class="err">${esc(cell.error)}</div>` : "";

  const noteHtml = cell.note ? `<div class="note">${esc(cell.note)}</div>` : "";

  return `<div class="${cls.join(" ")}">
    <div class="cell-img">${imgHtml}</div>
    <div class="cell-body">
      <div class="scores">${scoreText}</div>
      ${noteHtml}
      ${fpHtml}
      ${errHtml}
    </div>
  </div>`;
}

// ─────────── inline JS:点击切换 ───────────
// 极简:vanilla,无依赖,直接读写 dataset + hidden attribute。
// 加新维度时只需要扩 toolbar / matrix 的 data-* 即可,这段不用动。
const INLINE_TOGGLE_SCRIPT = `<script>
(function() {
  var report = document.querySelector('.report');
  if (!report) return;

  function updateMatrices() {
    var axis = report.dataset.axis;
    var tab = axis === 'skill' ? report.dataset.tabModel : report.dataset.tabSkill;
    var matrices = report.querySelectorAll('.matrix');
    for (var i = 0; i < matrices.length; i++) {
      var m = matrices[i];
      var show = m.dataset.matrixAxis === axis && m.dataset.matrixTab === tab;
      if (show) m.removeAttribute('hidden'); else m.setAttribute('hidden', '');
    }
  }
  function syncActive() {
    var axis = report.dataset.axis;
    // axis 按钮
    report.querySelectorAll('[data-axis-btn]').forEach(function(b) {
      b.classList.toggle('active', b.dataset.axisBtn === axis);
    });
    // chip(model + skill 都同步,虽然只显示其中一行)
    report.querySelectorAll('[data-chip]').forEach(function(c) {
      var key = c.dataset.chip;
      var cur = key === 'model' ? report.dataset.tabModel : report.dataset.tabSkill;
      c.classList.toggle('active', c.dataset.val === cur);
    });
  }

  report.addEventListener('click', function(e) {
    var t = e.target.closest('[data-axis-btn], [data-chip]');
    if (!t) return;
    if (t.dataset.axisBtn) {
      report.dataset.axis = t.dataset.axisBtn;
    } else if (t.dataset.chip) {
      if (t.dataset.chip === 'model') report.dataset.tabModel = t.dataset.val;
      else report.dataset.tabSkill = t.dataset.val;
    }
    updateMatrices();
    syncActive();
  });
})();
</script>`;
