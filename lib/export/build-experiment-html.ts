// prompt-rewriter/lib/export/build-experiment-html.ts
//
// Pipeline 实验台单次 ExperimentRecord 的 HTML 导出。
// 服务 source.kind === "pipeline_lab" 的 record(其它 kind 走各自原 lab 的 export endpoint)。
//
// 布局对齐 Experiments 详情页的 ReplayCards:
//   1. header:id / ts / pipeline_id / strategy_versions chips / models chips / tags / note
//   2. query 完整文本
//   3. 4 卡顺序展示(Step1 SearchIntent / StrategyPack / CreationPlanner / Step2 改写 / Step3 出图 grid)
//   4. trace 表格(详细各 step 耗时)
//
// 共享 build-html.ts 的 :root token + 暖色 CSS 系统,视觉一致。

import type { ExperimentRecord } from "@/lib/schema";

export type BuildExperimentHtmlOptions = {
  // 给 image url 返回最终 src(data URL inline 或 zip 相对路径)。
  // null → 显示占位。
  resolveImageSrc: (url: string) => Promise<string | null>;
};

// ─────────── HTML 转义 ───────────
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

function formatTs(ts: number): string {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return String(ts);
  }
}

function chipRow(map: Record<string, string>, filterEmpty = false): string {
  const entries = Object.entries(map).filter(([, v]) =>
    filterEmpty ? Boolean(v) : true,
  );
  if (entries.length === 0)
    return `<span class="empty">—</span>`;
  return entries
    .map(
      ([k, v]) =>
        `<span class="chip" title="${esc(k)}=${esc(v)}">${esc(k)}: ${esc(v || "—")}</span>`,
    )
    .join(" ");
}

// ─────────── 主入口 ───────────
export async function buildExperimentHtml(
  record: ExperimentRecord,
  opts: BuildExperimentHtmlOptions,
): Promise<string> {
  const out = (record.output ?? {}) as {
    query?: string;
    step1?: {
      search_intent?: {
        has_search_intent?: string;
        search_type?: string;
        intent_confidence?: string;
        vertical?: string;
        platform?: string;
      } | null;
      raw?: string;
      error?: string;
      elapsed_ms?: number;
      llm_model?: string;
    };
    creation_planner?: {
      function_calls?: Array<{ id: string; prompt: string }>;
      elapsed_ms?: number;
    };
    strategy_pack?: {
      vertical_standard?: {
        vertical?: string;
        label?: string;
        standards?: string[];
      };
      platform_tone?: { platform?: string; label?: string; tone?: string[] };
      elapsed_ms?: number;
    };
    step2?: {
      review_result?: {
        reviewed?: Array<{ id: string; prompt: string }>;
      } | null;
      raw?: string;
      composed_system?: string;
      error?: string;
      elapsed_ms?: number;
      llm_model?: string;
    };
    step3?: {
      generations?: Array<{
        id: string;
        prompt?: string;
        image_urls?: string[];
        error?: string | null;
        elapsed_ms?: number;
      }>;
      elapsed_ms?: number;
      image_model?: string;
    };
  };

  // 收集所有图 url 并发解析(local → base64 或相对路径)
  const generations = out.step3?.generations ?? [];
  const imgSrcMap = new Map<string, string | null>();
  await Promise.all(
    generations.flatMap((g) =>
      (g.image_urls ?? []).map(async (u) => {
        const src = await opts.resolveImageSrc(u);
        imgSrcMap.set(u, src);
      }),
    ),
  );

  const date = formatTs(record.ts);
  const query = record.inputs?.query ?? out.query ?? "";

  const trace = (record.trace ?? []) as Array<{
    step?: string;
    ms?: number;
    status?: string;
    attempts?: number;
    error?: string;
  }>;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Experiment ${esc(record.id)} · ${esc(date)}</title>
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
  .wrap { max-width: 1280px; margin: 0 auto; padding: 0 24px; }
  h1, h2, h3 { font-family: "Anthropic Serif", "EB Garamond", Georgia, serif; font-weight: 500; letter-spacing: -0.01em; }
  h1 { font-size: 28px; line-height: 1.2; margin: 0 0 8px; }
  h2 { font-size: 20px; line-height: 1.3; margin: 36px 0 14px; padding-top: 16px; border-top: 1px solid var(--border-strong); }
  h3 { font-size: 15px; line-height: 1.3; margin: 0 0 6px; font-weight: 500; }
  .sub { color: var(--olive-gray); font-size: 13.5px; margin: 0 0 16px; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px 16px; font-size: 12.5px; color: var(--stone-gray); }
  .meta b { color: var(--near-black); font-weight: 500; }
  .meta code { font-family: "SF Mono", Menlo, monospace; }

  .chip { display: inline-block; background: var(--card); border: 1px solid var(--border); padding: 2px 8px; border-radius: 999px; font-family: "SF Mono", Menlo, monospace; font-size: 11.5px; color: var(--near-black); margin-right: 4px; box-shadow: 0 0 0 1px var(--border); }
  .empty { color: var(--stone-gray); font-style: italic; font-size: 12px; }

  .top-card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 18px 20px; margin: 16px 0 24px; }
  .top-card section { margin-bottom: 10px; }
  .top-card section:last-child { margin-bottom: 0; }
  .top-card .label { font-family: "SF Mono", Menlo, monospace; font-size: 11px; color: var(--stone-gray); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }

  .query-box { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; font-size: 13.5px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }

  .step-card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 18px 20px; margin-bottom: 18px; }
  .step-card .step-hd { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .step-card .step-num { background: var(--warm-sand); color: var(--near-black); font-family: "SF Mono", Menlo, monospace; font-size: 12px; padding: 2px 8px; border-radius: 4px; font-weight: 500; }
  .step-card .step-title { font-family: "Anthropic Serif", "EB Garamond", Georgia, serif; font-size: 18px; }
  .step-card .step-meta { margin-left: auto; font-family: "SF Mono", Menlo, monospace; font-size: 11px; color: var(--stone-gray); }

  pre.json { margin: 0; padding: 10px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; font: 12px/1.55 "SF Mono", Menlo, monospace; white-space: pre-wrap; word-break: break-word; max-height: 360px; overflow: auto; color: var(--near-black); }

  .reviewed-list { display: flex; flex-direction: column; gap: 10px; }
  .reviewed-item { border: 1px solid var(--border); border-radius: 6px; background: var(--bg); padding: 10px 12px; }
  .reviewed-item .rid { font-family: "SF Mono", Menlo, monospace; font-size: 10.5px; color: var(--stone-gray); margin-bottom: 6px; }
  .reviewed-item pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: 12px/1.55 "SF Mono", Menlo, monospace; color: var(--near-black); }

  .gen-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
  .gen-cell { background: var(--card); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; display: flex; flex-direction: column; }
  .gen-cell.failed { border-color: rgba(179, 47, 47, 0.4); background: #fdf2ef; }
  .gen-img { background: var(--bg); aspect-ratio: 1 / 1; display: flex; align-items: center; justify-content: center; }
  .gen-img img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
  .gen-img .ph { color: var(--stone-gray); font-size: 12px; padding: 24px; text-align: center; }
  .gen-body { padding: 10px 12px; border-top: 1px solid var(--border); font-size: 11.5px; color: var(--olive-gray); display: flex; flex-direction: column; gap: 4px; }
  .gen-body details summary { cursor: pointer; user-select: none; color: var(--stone-gray); font-family: "SF Mono", Menlo, monospace; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; }
  .gen-body details pre { margin: 4px 0 0; padding: 6px 8px; background: var(--bg); border-radius: 4px; font: 11px/1.55 "SF Mono", Menlo, monospace; white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow: auto; color: var(--near-black); }
  .err { color: var(--error); font-size: 11px; padding: 3px 0; font-family: "SF Mono", Menlo, monospace; word-break: break-word; }

  table.trace-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  table.trace-table th, table.trace-table td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--border); }
  table.trace-table th { font-weight: 500; color: var(--stone-gray); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  table.trace-table td.step { font-family: "SF Mono", Menlo, monospace; color: var(--near-black); }
  table.trace-table td.num { font-family: "SF Mono", Menlo, monospace; color: var(--stone-gray); }
  table.trace-table td.status-ok { color: var(--near-black); }
  table.trace-table td.status-failed { color: var(--error); }
  table.trace-table td.status-skipped { color: var(--stone-gray); }

  .footer { margin-top: 48px; text-align: center; color: var(--stone-gray); font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Experiment ${esc(record.id)}</h1>
    <p class="sub">Pipeline 实验台 · 单 query 端到端报告</p>
    <div class="meta">
      <span><b>时间</b> ${esc(date)}</span>
      <span><b>来源</b> ${esc(record.source?.kind ?? "pipeline_lab")}</span>
      <span><b>pipeline_id</b> <code>${esc(record.pipeline_id)}</code></span>
      ${record.metadata?.replay_of ? `<span><b>复跑自</b> <code>${esc(record.metadata.replay_of)}</code></span>` : ""}
    </div>
  </header>

  <div class="top-card">
    <section>
      <div class="label">Query</div>
      <div class="query-box">${esc(query) || `<span class="empty">(空)</span>`}</div>
    </section>
    <section>
      <div class="label">策略版本</div>
      <div>${chipRow(record.config_snapshot?.strategy_versions ?? {})}</div>
    </section>
    <section>
      <div class="label">模型</div>
      <div>${chipRow(
        {
          search: record.config_snapshot?.models?.search ?? "",
          review: record.config_snapshot?.models?.review ?? "",
          image: record.config_snapshot?.models?.image ?? "",
        },
        true,
      )}</div>
    </section>
    ${
      record.tags && record.tags.length > 0
        ? `<section>
            <div class="label">Tags</div>
            <div>${record.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join(" ")}</div>
          </section>`
        : ""
    }
    ${
      record.metadata?.note
        ? `<section>
            <div class="label">Note</div>
            <div class="query-box" style="font-size:12.5px;">${esc(record.metadata.note)}</div>
          </section>`
        : ""
    }
  </div>

  ${renderStep1(out.step1)}
  ${renderStrategyPack(out.strategy_pack)}
  ${renderCreationPlanner(out.creation_planner)}
  ${renderStep2(out.step2)}
  ${renderStep3(out.step3, imgSrcMap)}
  ${renderTrace(trace)}

  <div class="footer">由 prompt-rewriter Experiments 导出 · ${new Date().toLocaleDateString("zh-CN")}</div>
</div>
</body>
</html>`;
}

// ─────────── 各 step 渲染 ───────────

function renderStep1(s1: ExperimentRecord["output"]["step1"] | undefined): string {
  if (!s1) return "";
  const intent = s1.search_intent;
  const intentText = intent
    ? JSON.stringify(intent, null, 2)
    : (s1.error ?? "(无 / 失败)");
  return `<div class="step-card">
    <div class="step-hd">
      <span class="step-num">Step 1</span>
      <span class="step-title">search_intent_classification</span>
      <span class="step-meta">${s1.elapsed_ms ?? 0} ms${s1.llm_model ? ` · ${esc(s1.llm_model)}` : ""}</span>
    </div>
    <pre class="json">${esc(intentText)}</pre>
    ${s1.error ? `<div class="err">⚠ ${esc(s1.error)}</div>` : ""}
  </div>`;
}

function renderStrategyPack(
  sp: ExperimentRecord["output"]["strategy_pack"] | undefined,
): string {
  if (!sp) return "";
  const v = sp.vertical_standard;
  const p = sp.platform_tone;
  const vBullets = (v?.standards ?? []).filter((x: string) => x.trim());
  const pBullets = (p?.tone ?? []).filter((x: string) => x.trim());
  return `<div class="step-card">
    <div class="step-hd">
      <span class="step-num">+</span>
      <span class="step-title">Strategy Pack(注入到 SP2)</span>
      <span class="step-meta">${sp.elapsed_ms ?? 0} ms</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div>
        <h3>Vertical Standard · ${esc(v?.label ?? v?.vertical ?? "—")}</h3>
        ${vBullets.length > 0 ? `<ul style="margin:0;padding-left:18px;font-size:12.5px;line-height:1.6;color:var(--near-black);">${vBullets.map((b: string) => `<li>${esc(b)}</li>`).join("")}</ul>` : `<p class="empty">(无)</p>`}
      </div>
      <div>
        <h3>Platform Tone · ${esc(p?.label ?? p?.platform ?? "—")}</h3>
        ${pBullets.length > 0 ? `<ul style="margin:0;padding-left:18px;font-size:12.5px;line-height:1.6;color:var(--near-black);">${pBullets.map((b: string) => `<li>${esc(b)}</li>`).join("")}</ul>` : `<p class="empty">(无)</p>`}
      </div>
    </div>
  </div>`;
}

function renderCreationPlanner(
  cp: ExperimentRecord["output"]["creation_planner"] | undefined,
): string {
  if (!cp) return "";
  const fcs = cp.function_calls ?? [];
  return `<div class="step-card">
    <div class="step-hd">
      <span class="step-num">+</span>
      <span class="step-title">Creation Planner · ${fcs.length} function call</span>
      <span class="step-meta">${cp.elapsed_ms ?? 0} ms</span>
    </div>
    ${
      fcs.length > 0
        ? `<div class="reviewed-list">${fcs.map((fc: { id: string; prompt: string }) =>
                `<div class="reviewed-item">
              <div class="rid">${esc(fc.id)}</div>
              <pre>${esc(fc.prompt)}</pre>
            </div>`,
            )
            .join("")}</div>`
        : `<p class="empty">(无 function call)</p>`
    }
  </div>`;
}

function renderStep2(s2: ExperimentRecord["output"]["step2"] | undefined): string {
  if (!s2) return "";
  const reviewed = s2.review_result?.reviewed ?? [];
  return `<div class="step-card">
    <div class="step-hd">
      <span class="step-num">Step 2</span>
      <span class="step-title">media_prompt_review · ${reviewed.length} reviewed</span>
      <span class="step-meta">${s2.elapsed_ms ?? 0} ms${s2.llm_model ? ` · ${esc(s2.llm_model)}` : ""}</span>
    </div>
    ${
      reviewed.length > 0
        ? `<div class="reviewed-list">${reviewed.map((r: { id: string; prompt: string }) =>
                `<div class="reviewed-item">
              <div class="rid">${esc(r.id)}</div>
              <pre>${esc(r.prompt)}</pre>
            </div>`,
            )
            .join("")}</div>`
        : `<p class="empty">${s2.error ? `⚠ ${esc(s2.error)}` : "(无 / 失败)"}</p>`
    }
    ${s2.composed_system ? `<details style="margin-top:10px;"><summary style="cursor:pointer;font-family:'SF Mono',Menlo,monospace;font-size:10.5px;color:var(--stone-gray);text-transform:uppercase;letter-spacing:0.04em;">composed_system(SP2 + 策略注入后)</summary><pre class="json" style="margin-top:6px;">${esc(s2.composed_system)}</pre></details>` : ""}
  </div>`;
}

function renderStep3(
  s3: ExperimentRecord["output"]["step3"] | undefined,
  imgSrcMap: Map<string, string | null>,
): string {
  if (!s3) return "";
  const gens = s3.generations ?? [];
  return `<div class="step-card">
    <div class="step-hd">
      <span class="step-num">Step 3</span>
      <span class="step-title">generate_media · ${gens.length} 张</span>
      <span class="step-meta">${s3.elapsed_ms ?? 0} ms${s3.image_model ? ` · ${esc(s3.image_model)}` : ""}</span>
    </div>
    ${
      gens.length > 0
        ? `<div class="gen-grid">${gens.map((g: { id: string; prompt?: string; image_urls?: string[]; error?: string | null; elapsed_ms?: number }) => {
              const url = g.image_urls?.[0];
              const src = url ? imgSrcMap.get(url) : null;
              const imgHtml = src
                ? `<img src="${esc(src)}" alt="${esc(g.id)}" loading="lazy">`
                : g.error
                  ? `<div class="ph">⚠ 失败</div>`
                  : `<div class="ph">无图</div>`;
              const cls = g.error ? "gen-cell failed" : "gen-cell";
              return `<div class="${cls}">
                <div class="gen-img">${imgHtml}</div>
                <div class="gen-body">
                  <div style="font-family:'SF Mono',Menlo,monospace;font-size:10.5px;color:var(--stone-gray);">${esc(g.id)}${g.elapsed_ms ? ` · ${g.elapsed_ms} ms` : ""}</div>
                  ${g.prompt ? `<details><summary>prompt</summary><pre>${esc(g.prompt)}</pre></details>` : ""}
                  ${g.error ? `<div class="err">⚠ ${esc(g.error)}</div>` : ""}
                </div>
              </div>`;
            })
            .join("")}</div>`
        : `<p class="empty">(无生图)</p>`
    }
  </div>`;
}

function renderTrace(
  trace: Array<{ step?: string; ms?: number; status?: string; attempts?: number; error?: string }>,
): string {
  if (!trace || trace.length === 0) return "";
  return `<div class="step-card">
    <div class="step-hd">
      <span class="step-title" style="font-size:16px;">Trace · ${trace.length} step</span>
    </div>
    <table class="trace-table">
      <thead>
        <tr><th>step</th><th>ms</th><th>attempts</th><th>status</th><th>error</th></tr>
      </thead>
      <tbody>
        ${trace
          .map(
            (t) => `<tr>
            <td class="step">${esc(String(t.step ?? ""))}</td>
            <td class="num">${Number(t.ms ?? 0)}</td>
            <td class="num">${Number(t.attempts ?? 1)}</td>
            <td class="status-${esc(String(t.status ?? "ok"))}">${esc(String(t.status ?? ""))}</td>
            <td class="num">${t.error ? esc(String(t.error).slice(0, 100)) : "—"}</td>
          </tr>`,
          )
          .join("")}
      </tbody>
    </table>
  </div>`;
}
