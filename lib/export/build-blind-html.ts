// prompt-rewriter/lib/export/build-blind-html.ts
//
// 盲评模式 HTML:接收方看不到任何策略信号,只看图 + 原始 query,
// 给每 query 选一张"最好的"。本地 localStorage 暂存,完成后导出 .json 反给作者。
//
// 关键防泄漏措施(任何 review 模式新加内容都要遵循):
//   - 不渲染 skill_id / final_prompt / 任何模型 / 任何策略名
//   - 不渲染 record.purpose(可能含"测 F4 vs F1" 之类暴露)
//   - 图片文件名匿名:images/q01_p1.png(不是 q01_F4-block.png)
//   - HTML 源码里也不出现 skill_id —— 只有 anon_id
//   - data-* attribute 同样不能藏 skill_id 信息
//
// 接收方完成后导出的 .json 结构:
//   {
//     run_id, exported_at, reviewer,
//     picks: { "0": "q1-p3", "1": "q2-p1", ... }    // queryIdx 字符串 → anon_id
//   }
// 作者侧反向导入时,用 buildAnonMapping 重新算同一映射,把 anon_id 翻回 skill_id。

import type { BatchRunRecord, BatchCell } from "@/lib/schema";
import type { AnonMapping } from "./anon-mapping";

export type BuildBlindHtmlOptions = {
  // 给定 cell 返回该 cell 第一张图的 src(相对路径或 base64 data URL)
  resolveImageSrc: (cell: BatchCell) => Promise<string | null>;
};

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

export async function buildBlindHtml(
  record: BatchRunRecord,
  mapping: AnonMapping,
  opts: BuildBlindHtmlOptions
): Promise<string> {
  // 预先拉所有图 src,模板里同步插入
  const srcMap = new Map<string, string | null>();
  await Promise.all(
    mapping.byQuery.flat().map(async (a) => {
      const cell = record.cells.find(
        (c) => c.query_idx === a.query_idx && c.skill_id === a.skill_id
      );
      if (!cell) return;
      const src = await opts.resolveImageSrc(cell);
      srcMap.set(a.anon_id, src);
    })
  );

  const totalQueries = record.queries.length;
  // 嵌入页面的"meta data"—— 只放 anon_id 列表 + run_id。**严禁**含 skill_id
  const safeMeta = {
    run_id: record.id,
    name: record.name,
    total_queries: totalQueries,
    anon_ids_per_query: mapping.byQuery.map((q) => q.map((c) => c.anon_id)),
  };
  // B3 fix:把 safeMeta JSON 嵌入 <script> 时,把 </script 字面量打散,
  // 防 record.name 含 `</script>` 关闭脚本块(理论 XSS,内部工具风险低但顺手补)
  const safeMetaJson = JSON.stringify(safeMeta).replace(/<\/script/gi, "<\\/script");

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>盲评 · ${esc(record.name || "未命名跑批")}</title>
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
    --terracotta-light: rgba(201, 100, 66, 0.08);
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
    padding-bottom: 64px;
  }
  h1, h2 { font-family: "Anthropic Serif", "EB Garamond", Georgia, serif; font-weight: 500; letter-spacing: -0.01em; }
  .toolbar {
    position: sticky; top: 0; z-index: 10;
    background: rgba(245, 244, 237, 0.92);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--border-strong);
    padding: 12px 24px;
  }
  .toolbar-inner { max-width: 1180px; margin: 0 auto; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  .toolbar h1 { margin: 0; font-size: 18px; line-height: 1.2; }
  .toolbar .progress-text { font-family: "SF Mono", Menlo, monospace; font-size: 12px; color: var(--olive-gray); }
  .toolbar .progress-bar { flex: 1; min-width: 120px; max-width: 280px; height: 6px; background: var(--border-strong); border-radius: 3px; overflow: hidden; }
  .toolbar .progress-bar > div { height: 100%; background: var(--terracotta); transition: width 0.2s; width: 0%; }
  .toolbar input[type="text"] { height: 32px; padding: 0 10px; border: 1px solid var(--border-strong); border-radius: 6px; background: var(--card); font: inherit; font-size: 13px; min-width: 140px; }
  .toolbar input[type="text"]:focus { outline: none; border-color: var(--terracotta); }
  .toolbar button { height: 32px; padding: 0 14px; border: 1px solid var(--border-strong); border-radius: 6px; background: var(--card); font: inherit; font-size: 13px; cursor: pointer; transition: background 0.15s; }
  .toolbar button.primary { background: var(--terracotta); color: var(--card); border-color: var(--terracotta); }
  .toolbar button.primary:hover { background: #b85638; border-color: #b85638; }
  .toolbar button:hover { background: var(--border-strong); }
  .toolbar button:disabled { opacity: 0.5; cursor: not-allowed; }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 24px; }
  .intro { background: var(--warm-gold-bg); border-left: 3px solid var(--warm-gold-fg); padding: 12px 16px; border-radius: 6px; margin-bottom: 24px; font-size: 13.5px; line-height: 1.6; color: var(--olive-gray); }
  .intro strong { color: var(--near-black); }
  .query { margin-top: 32px; }
  .query-hd { display: flex; gap: 12px; margin-bottom: 14px; }
  .query-hd .qid { font-family: "SF Mono", Menlo, monospace; color: var(--stone-gray); font-size: 12px; flex-shrink: 0; padding-top: 1px; }
  .query-hd .qtext { flex: 1; font-size: 15px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
  .pick {
    background: var(--card); border: 2px solid var(--border); border-radius: 8px; overflow: hidden;
    cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s, transform 0.05s;
    display: flex; flex-direction: column;
  }
  .pick:hover { border-color: var(--stone-gray); }
  .pick.selected { border-color: var(--terracotta); box-shadow: 0 0 0 1px var(--terracotta); background: var(--terracotta-light); }
  .pick.selected .pick-label { background: var(--terracotta); color: var(--card); }
  .pick-img { background: var(--bg); aspect-ratio: 1 / 1; display: flex; align-items: center; justify-content: center; }
  .pick-img img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; pointer-events: none; user-select: none; }
  .pick-img .ph { color: var(--stone-gray); font-size: 12px; padding: 24px; text-align: center; }
  .pick-label { padding: 8px 12px; border-top: 1px solid var(--border); font-family: "SF Mono", Menlo, monospace; font-size: 12px; display: flex; justify-content: space-between; align-items: center; transition: background 0.15s, color 0.15s; }
  .pick-label .check { display: none; font-weight: 600; }
  .pick.selected .check { display: inline; }
  .footer { margin-top: 48px; text-align: center; color: var(--stone-gray); font-size: 12px; }
</style>
</head>
<body>
<header class="toolbar">
  <div class="toolbar-inner">
    <h1>盲评</h1>
    <input id="reviewer" type="text" placeholder="评审人姓名(可空)" maxlength="32" />
    <div class="progress-bar"><div id="progress-fill"></div></div>
    <span class="progress-text" id="progress-text">0 / ${totalQueries}</span>
    <button id="export-btn" class="primary">导出选择 .json</button>
    <button id="clear-btn">清空</button>
  </div>
</header>

<div class="wrap">
  <div class="intro">
    每个 <strong>Q</strong> 下面有几张候选图。<strong>请为每个 Q 选你认为最好的那张</strong>(点击图卡即可,再点切换)。
    全部完成后点右上"<strong>导出选择 .json</strong>",把生成的文件发回给作者。
    <br>
    <em>评审过程会自动暂存到本地浏览器,关掉浏览器再开仍能继续。</em>
  </div>

  ${record.queries
    .map((q, qi) => {
      const list = mapping.byQuery[qi] ?? [];
      return `
    <section class="query" data-q="${qi}">
      <h2>Q${qi + 1}</h2>
      <div class="query-hd">
        <span class="qid">query</span>
        <div class="qtext">${esc(q)}</div>
      </div>
      <div class="grid">
        ${list
          .map((a) => {
            const src = srcMap.get(a.anon_id) ?? null;
            const imgHtml = src
              ? `<img src="${esc(src)}" alt="" loading="lazy">`
              : `<div class="ph">无图</div>`;
            return `
          <div class="pick" data-anon="${esc(a.anon_id)}" data-q="${qi}">
            <div class="pick-img">${imgHtml}</div>
            <div class="pick-label">
              <span>位置 #${a.position}</span>
              <span class="check">★ 已选</span>
            </div>
          </div>`;
          })
          .join("")}
      </div>
    </section>`;
    })
    .join("")}

  <div class="footer">由 prompt-rewriter 批量测试台生成 · 盲评模式</div>
</div>

<script>
(function() {
  // 关键:整个数据结构里没有 skill_id / final_prompt / 任何策略信号。
  // 仅 run_id / 名称 / 题目数 / 每 query 的 anon_id 列表。
  const META = ${safeMetaJson};
  const STORAGE_KEY = "lovart-batch-blind-" + META.run_id;

  // selections: { queryIdx(string): anonId(string) }
  let state = { reviewer: "", picks: {} };

  // ─── 持久化 ───
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          state.reviewer = typeof parsed.reviewer === "string" ? parsed.reviewer : "";
          state.picks = (parsed.picks && typeof parsed.picks === "object") ? parsed.picks : {};
        }
      }
    } catch (e) {
      console.warn("[blind] localStorage 读失败", e);
    }
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("[blind] localStorage 写失败", e);
    }
  }

  // ─── 渲染选中态 ───
  function renderSelections() {
    document.querySelectorAll(".pick").forEach((el) => {
      const q = el.getAttribute("data-q");
      const anon = el.getAttribute("data-anon");
      if (state.picks[q] === anon) {
        el.classList.add("selected");
      } else {
        el.classList.remove("selected");
      }
    });
    const done = Object.keys(state.picks).length;
    const total = META.total_queries;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    document.getElementById("progress-fill").style.width = pct + "%";
    document.getElementById("progress-text").textContent = done + " / " + total;
  }

  // ─── 点击卡片切换选中 ───
  function onPickClick(ev) {
    const card = ev.target.closest(".pick");
    if (!card) return;
    const q = card.getAttribute("data-q");
    const anon = card.getAttribute("data-anon");
    if (state.picks[q] === anon) {
      // 再点已选 = 取消
      delete state.picks[q];
    } else {
      state.picks[q] = anon;
    }
    save();
    renderSelections();
  }

  // ─── reviewer 输入同步 ───
  function bindReviewer() {
    const input = document.getElementById("reviewer");
    input.value = state.reviewer || "";
    input.addEventListener("input", function() {
      state.reviewer = input.value.trim();
      save();
    });
  }

  // ─── 导出 .json ───
  function exportJson() {
    const done = Object.keys(state.picks).length;
    const total = META.total_queries;
    if (done < total) {
      const ok = confirm("还有 " + (total - done) + " 题未选,确认导出?");
      if (!ok) return;
    }
    const out = {
      run_id: META.run_id,
      name: META.name,
      reviewer: state.reviewer || "",
      exported_at: new Date().toISOString(),
      picks: state.picks,
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = (META.name || "batch").replace(/[\\/:*?"<>|]/g, "_");
    const safeReviewer = (state.reviewer || "anonymous").replace(/[\\/:*?"<>|]/g, "_");
    a.href = url;
    a.download = safeName + "_picks_" + safeReviewer + "_" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  }

  // ─── 清空 ───
  function clearAll() {
    if (!confirm("确认清空所有选择?(本地草稿和评审人姓名都会清掉)")) return;
    state = { reviewer: "", picks: {} };
    localStorage.removeItem(STORAGE_KEY);
    document.getElementById("reviewer").value = "";
    renderSelections();
  }

  // ─── 启动 ───
  load();
  bindReviewer();
  renderSelections();
  document.querySelectorAll(".pick").forEach(function(el) {
    el.addEventListener("click", onPickClick);
  });
  document.getElementById("export-btn").addEventListener("click", exportJson);
  document.getElementById("clear-btn").addEventListener("click", clearAll);
})();
</script>
</body>
</html>`;
}
