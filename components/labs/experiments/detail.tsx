// prompt-rewriter/components/labs/experiments/detail.tsx
//
// Experiment 详情视图 · Phase 3a 完整实现。
// 数据走 GET /api/experiments/<id> → ExperimentRecord(完整含 output / trace)。
// 4 卡渲染**直接复用 Pipeline lab 的 export**,把 record.output 当成已经跑完的 result 喂进去
// (卡片本来就接 Partial<PipelineResponse>,天然兼容)。
//
// 顶栏:id / ts / pipeline_id / strategy_versions chips / models chips / tags / note。
// PATCH 入口:tags(逗号分隔)+ note 文本框,blur 时 PATCH。

"use client";

import { useSetAtom } from "jotai";
import { useCallback, useEffect, useState } from "react";
import {
  experimentListCacheAtom,
  selectedExperimentIdAtom,
} from "@/lib/atoms-experiments";
import type { ExperimentRecord } from "@/lib/schema";
import {
  Step1Card,
  CreationPlannerCard,
  Step2Card,
  Step3Card,
  DirectCompareCard,
} from "@/components/labs/pipeline/lab";
import type { PipelineResponse } from "@/components/labs/pipeline/types";

export function ExperimentDetail({ id }: { id: string }) {
  const setSelected = useSetAtom(selectedExperimentIdAtom);
  const setListCache = useSetAtom(experimentListCacheAtom);
  const [record, setRecord] = useState<ExperimentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // PATCH-able 字段(本地 buffer,blur 时提交)
  const [tagsInput, setTagsInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">(
    "saved",
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const r = await fetch(`/api/experiments/${encodeURIComponent(id)}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as ExperimentRecord;
        if (!cancelled) {
          setRecord(json);
          setTagsInput((json.tags ?? []).join(", "));
          setNoteInput(json.metadata?.note ?? "");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // 2026-05-13:running 状态短轮询 —— 让 Experiments detail 跟 Pipeline lab 同源,
  // 实时看到 step1 / planner / step2 / step3 各阶段产物。每 2s 重 fetch 直到 status
  // 变 finished / failed,然后停止轮询(避免长期空转)。
  // Pipeline POST 端已经做增量落盘 (debounce 200ms),所以每次 fetch 都能看到最新进度
  useEffect(() => {
    if (!record || record.status !== "running") return;
    const interval = setInterval(async () => {
      try {
        const r = await fetch(`/api/experiments/${encodeURIComponent(id)}`);
        if (!r.ok) return;
        const fresh = (await r.json()) as ExperimentRecord;
        setRecord(fresh);
      } catch {
        /* 网络错忽略,下个 tick 再试 */
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [id, record?.status]);

  const patchRecord = useCallback(
    async (body: {
      tags?: string[];
      metadata?: { note?: string; author?: string; replay_of?: string };
    }) => {
      setSaveStatus("saving");
      try {
        const r = await fetch(`/api/experiments/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const updated = (await r.json()) as ExperimentRecord;
        setRecord(updated);
        // 同步本地列表 cache,避免返回列表时显示旧 tags/note
        setListCache((prev) =>
          prev
            ? prev.map((h) =>
                h.id === id
                  ? { ...h, tags: updated.tags, metadata: updated.metadata }
                  : h,
              )
            : prev,
        );
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    },
    [id, setListCache],
  );

  function commitTags() {
    if (!record) return;
    const next = tagsInput
      .split(/[,，;；\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (
      next.length === record.tags.length &&
      next.every((v, i) => v === record.tags[i])
    ) {
      return; // no-op
    }
    patchRecord({ tags: next });
  }

  function commitNote() {
    if (!record) return;
    const next = noteInput.trim();
    if (next === (record.metadata?.note ?? "").trim()) return;
    patchRecord({
      metadata: {
        note: next,
        author: record.metadata?.author,
        replay_of: record.metadata?.replay_of,
      },
    });
  }

  // 按 source.kind 路由导出 endpoint:
  //   pipeline_lab    → /api/experiments/<id>/export(单 record 4 卡报告)
  //   batch_skill     → /api/labs/batch/runs/<source.run_id>/export(批量 N×M 矩阵)
  //   batch_pipeline  → 同上(用 batch lab 的导出,test_kind=pipeline 自动切列头)
  //   format          → /api/labs/format/runs/<source.run_id>/export(1 query × N skill)
  function exportUrlOf(rec: ExperimentRecord): string | null {
    const kind = rec.source?.kind ?? "pipeline_lab";
    const runId = rec.source?.run_id;
    if (kind === "pipeline_lab") {
      return `/api/experiments/${encodeURIComponent(rec.id)}/export`;
    }
    if ((kind === "batch_skill" || kind === "batch_pipeline") && runId) {
      return `/api/labs/batch/runs/${encodeURIComponent(runId)}/export`;
    }
    if (kind === "format" && runId) {
      return `/api/labs/format/runs/${encodeURIComponent(runId)}/export`;
    }
    return null;
  }
  const exportUrl = record ? exportUrlOf(record) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={() => setSelected(null)}
          className="text-[13px] text-terracotta hover:underline"
        >
          ← 返回列表
        </button>
        <div className="flex items-center gap-3">
          {exportUrl && (
            <a
              href={exportUrl}
              title={
                record?.source?.kind === "pipeline_lab"
                  ? "导出当前 Experiment 为单 record HTML 报告"
                  : `导出原 ${record?.source?.kind} 跑批的完整 HTML / ZIP`
              }
              className="rounded-md border border-border-cream bg-ivory px-3 py-1 text-[12px] text-near-black transition hover:bg-warm-sand/40"
            >
              ↓ 导出
            </a>
          )}
          <span className="text-[11px]">
            {saveStatus === "saving" && (
              <span className="text-stone-gray">保存中…</span>
            )}
            {saveStatus === "saved" && (
              <span className="text-stone-gray">tags / note 已保存 ✓</span>
            )}
            {saveStatus === "error" && (
              <span className="text-error-crimson">保存失败</span>
            )}
          </span>
        </div>
      </div>

      {loading && (
        <div className="rounded-md border border-border-cream bg-parchment/30 px-6 py-12 text-center text-[13px] text-stone-gray">
          载入中…
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          ⚠ 加载失败:{error}
        </div>
      )}

      {record && (
        <>
          {/* 实时同步条:status=running 时显示,告诉用户页面在轮询 */}
          {record.status === "running" && (
            <div className="flex items-center gap-3 rounded-md border border-terracotta/40 bg-warm-sand/30 px-4 py-2.5 text-[13px] text-terracotta">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-terracotta" />
              <span className="font-medium">跑批进行中 · 每 2s 自动同步</span>
              <span className="ml-auto font-mono text-[11px] text-stone-gray">
                跑批已用时 {Math.round((Date.now() - record.ts) / 1000)}s
              </span>
            </div>
          )}
          {record.status === "failed" && record.error && (
            <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-[13px] text-red-700">
              <div className="mb-1 font-medium">⚠ 跑批失败</div>
              <div className="whitespace-pre-wrap break-words font-mono text-[12px]">
                {record.error}
              </div>
            </div>
          )}
          {/* 顶栏:标识 + chip 行 + tags / note 编辑 */}
          <section className="space-y-4 rounded-lg border border-border-cream bg-ivory px-6 py-5">
            <header className="flex items-start justify-between gap-4">
              <div>
                <h1 className="font-serif text-[24px] font-medium leading-[1.2] text-near-black">
                  Experiment {record.id}
                </h1>
                <p className="mt-1 font-mono text-[11.5px] text-stone-gray">
                  {formatTs(record.ts)} · pipeline ={" "}
                  <span className="text-near-black">{record.pipeline_id}</span>
                  {record.metadata?.replay_of && (
                    <>
                      {" · 复跑自 "}
                      <button
                        onClick={() => setSelected(record.metadata.replay_of!)}
                        className="text-terracotta hover:underline"
                      >
                        {record.metadata.replay_of}
                      </button>
                    </>
                  )}
                </p>
              </div>
            </header>

            {/* Query */}
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wider text-stone-gray">
                Query
              </div>
              <div className="rounded-md border border-border-cream bg-parchment/40 px-3 py-2 font-mono text-[13px] leading-[1.6] text-near-black">
                {record.inputs?.query || (
                  <span className="italic text-stone-gray">(空)</span>
                )}
              </div>
            </div>

            {/* 策略版本 + 模型 chips */}
            <div className="grid gap-3 md:grid-cols-2">
              <ChipBlock
                label="策略版本"
                map={record.config_snapshot?.strategy_versions ?? {}}
              />
              <ChipBlock
                label="模型"
                map={{
                  search: record.config_snapshot?.models?.search ?? "",
                  review: record.config_snapshot?.models?.review ?? "",
                  image: record.config_snapshot?.models?.image ?? "",
                }}
                filterEmpty
              />
            </div>

            {/* Tags + Note 可编辑 */}
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <div className="mb-1 text-[11px] uppercase tracking-wider text-stone-gray">
                  Tags(逗号分隔)
                </div>
                <input
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  onBlur={commitTags}
                  placeholder="case:T1, iteration:2026-05-12"
                  className="w-full rounded-md border border-border-cream bg-parchment/40 px-3 py-2 text-[13px] focus:border-terracotta focus:outline-none"
                />
              </label>
              <label className="block">
                <div className="mb-1 text-[11px] uppercase tracking-wider text-stone-gray">
                  备注 / Note
                </div>
                <input
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  onBlur={commitNote}
                  placeholder="(可选,给后来人看)"
                  className="w-full rounded-md border border-border-cream bg-parchment/40 px-3 py-2 text-[13px] focus:border-terracotta focus:outline-none"
                />
              </label>
            </div>

            {/* trace 概览(Phase 1 加的字段,Phase 3a 可读) */}
            {Array.isArray(record.trace) && record.trace.length > 0 && (
              <details className="text-[12px]">
                <summary className="cursor-pointer text-terracotta">
                  trace · 各 step 耗时与状态({record.trace.length} 条)
                </summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left text-[11.5px]">
                    <thead className="text-[10.5px] uppercase tracking-wider text-stone-gray">
                      <tr>
                        <th className="py-1 pr-3 font-medium">step</th>
                        <th className="py-1 pr-3 font-medium">ms</th>
                        <th className="py-1 pr-3 font-medium">attempts</th>
                        <th className="py-1 pr-3 font-medium">status</th>
                        <th className="py-1 pr-3 font-medium">error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(record.trace as TraceEntryLike[]).map((t, i) => (
                        <tr
                          key={i}
                          className="border-t border-border-cream/60 font-mono"
                        >
                          <td className="py-1 pr-3 text-near-black">
                            {String(t.step)}
                          </td>
                          <td className="py-1 pr-3 text-stone-gray">
                            {Number(t.ms ?? 0)}
                          </td>
                          <td className="py-1 pr-3 text-stone-gray">
                            {Number(t.attempts ?? 1)}
                          </td>
                          <td className="py-1 pr-3">
                            <span
                              className={
                                t.status === "ok"
                                  ? "text-near-black"
                                  : t.status === "failed"
                                    ? "text-error-crimson"
                                    : "text-stone-gray"
                              }
                            >
                              {String(t.status ?? "")}
                            </span>
                          </td>
                          <td className="py-1 pr-3 text-stone-gray">
                            {t.error
                              ? String(t.error).slice(0, 80)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </section>

          {/* 按 source.kind 分流渲染 · 复用 readOnly 模式 */}
          <SourceRouter record={record} />
        </>
      )}
    </div>
  );
}

function SourceRouter({ record }: { record: ExperimentRecord }) {
  const kind = record.source?.kind ?? "pipeline_lab";
  if (kind === "pipeline_lab") return <ReplayCards record={record} />;
  if (kind === "batch_pipeline") return <BatchPipelineCells record={record} />;
  if (kind === "batch_skill") return <BatchSkillCells record={record} />;
  if (kind === "format") return <FormatRuns record={record} />;
  return <ReplayCards record={record} />;
}

// ─── batch_pipeline:N cells × 1+ pipelines,每 cell 含完整 pipeline_outputs(step1/step2/strategy/planner/generations/trace) ───
function BatchPipelineCells({ record }: { record: ExperimentRecord }) {
  const out = record.output as {
    queries?: string[];
    cells?: Array<{
      query_idx: number;
      pipeline_id?: string;
      image_model?: string;
      status: string;
      image_urls?: string[] | null;
      pipeline_outputs?: unknown;
      error?: string | null;
    }>;
  };
  const queries = out.queries ?? [];
  const cells = out.cells ?? [];
  return (
    <section className="space-y-4">
      <h2 className="font-serif text-[16px] font-medium text-near-black">
        Pipeline 跑批 · {cells.length} cells
      </h2>
      <ul className="space-y-3">
        {cells.map((c, i) => {
          const po = c.pipeline_outputs as
            | {
                step1?: { search_intent?: { vertical?: string; platform?: string } | null };
                step2?: { review_result?: { reviewed?: Array<{ id: string; prompt: string }> } | null };
                generations?: Array<{ image_urls?: string[]; prompt?: string }>;
                trace?: Array<{ step: string; ms: number; status: string }>;
                strategy_versions?: Record<string, string>;
              }
            | null
            | undefined;
          return (
            <li
              key={i}
              className="rounded-lg border border-border-cream bg-ivory px-4 py-3"
            >
              <div className="mb-2 flex flex-wrap items-baseline gap-2 text-[12px]">
                <span className="font-mono text-[11px] text-stone-gray">
                  Q{c.query_idx + 1}
                </span>
                <span className="rounded bg-terracotta/15 px-1.5 py-0 font-mono text-[10px] text-terracotta">
                  {c.pipeline_id ?? "?"}
                </span>
                <span
                  className={`font-mono text-[10.5px] ${
                    c.status === "done"
                      ? "text-near-black"
                      : c.status === "failed"
                        ? "text-error-crimson"
                        : "text-stone-gray"
                  }`}
                >
                  {c.status}
                </span>
                {po?.strategy_versions && (
                  <span className="ml-auto font-mono text-[10px] text-stone-gray">
                    {Object.entries(po.strategy_versions)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(" · ")}
                  </span>
                )}
              </div>
              <p className="mb-2 line-clamp-2 text-[13px] text-near-black">
                {queries[c.query_idx] ?? "(no query)"}
              </p>
              {po && (
                <>
                  {/* 阶段产物展示:SP1 / SP2 / 生图 */}
                  <div className="grid gap-2 md:grid-cols-3">
                    <PipelineStageBox
                      title="SP1 意图"
                      content={
                        po.step1?.search_intent
                          ? `vertical=${po.step1.search_intent.vertical} · platform=${po.step1.search_intent.platform}`
                          : "(无 / 失败)"
                      }
                    />
                    <PipelineStageBox
                      title="SP2 改写"
                      content={
                        po.step2?.review_result?.reviewed?.[0]?.prompt?.slice(0, 200) ??
                        "(无 / 失败)"
                      }
                    />
                    <PipelineStageBox
                      title={`生图(${po.generations?.length ?? 0} 张)`}
                      content=""
                      images={po.generations?.flatMap((g) => g.image_urls ?? []) ?? []}
                    />
                  </div>
                  {/* trace 表 */}
                  {Array.isArray(po.trace) && po.trace.length > 0 && (
                    <details className="mt-2 text-[11.5px]">
                      <summary className="cursor-pointer font-mono text-stone-gray">
                        trace ({po.trace.length} steps)
                      </summary>
                      <table className="mt-1 w-full font-mono text-[10.5px]">
                        <tbody>
                          {po.trace.map((t, j) => (
                            <tr key={j}>
                              <td className="pr-3 text-near-black">{t.step}</td>
                              <td className="pr-3 text-stone-gray">{t.ms} ms</td>
                              <td className="pr-3 text-stone-gray">{t.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  )}
                </>
              )}
              {c.error && (
                <p className="mt-2 text-[11px] text-error-crimson">{c.error}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PipelineStageBox({
  title,
  content,
  images,
}: {
  title: string;
  content: string;
  images?: string[];
}) {
  return (
    <div className="rounded border border-border-cream bg-parchment/40 px-2.5 py-2">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-stone-gray">
        {title}
      </div>
      {images && images.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {images.slice(0, 4).map((u, i) => (
            <a key={i} href={u} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={u}
                alt=""
                className="h-16 w-16 rounded border border-border-cream object-cover"
              />
            </a>
          ))}
        </div>
      ) : (
        <p className="line-clamp-3 text-[11.5px] leading-[1.45] text-near-black">
          {content || <span className="italic text-stone-gray">(空)</span>}
        </p>
      )}
    </div>
  );
}

// ─── batch_skill:N×M cells,每 cell = (query × skill × model),含 final_prompt + image_urls ───
function BatchSkillCells({ record }: { record: ExperimentRecord }) {
  const out = record.output as {
    queries?: string[];
    cells?: Array<{
      query_idx: number;
      skill_id: string;
      image_model: string;
      status: string;
      final_prompt?: { prompt: string; size?: string } | null;
      image_urls?: string[] | null;
      error?: string | null;
    }>;
  };
  const queries = out.queries ?? [];
  const cells = out.cells ?? [];
  return (
    <section className="space-y-4">
      <h2 className="font-serif text-[16px] font-medium text-near-black">
        Skill 跑批 · {cells.length} cells
      </h2>
      <ul className="space-y-2">
        {cells.map((c, i) => (
          <li
            key={i}
            className="rounded-lg border border-border-cream bg-ivory px-4 py-3"
          >
            <div className="mb-1.5 flex flex-wrap items-baseline gap-2 text-[12px]">
              <span className="font-mono text-[11px] text-stone-gray">
                Q{c.query_idx + 1}
              </span>
              <span className="rounded bg-warm-sand/60 px-1.5 py-0 font-mono text-[10px] text-near-black">
                {c.skill_id}
              </span>
              {c.image_model && (
                <span className="font-mono text-[10px] text-stone-gray">
                  / {c.image_model}
                </span>
              )}
              <span
                className={`font-mono text-[10.5px] ${
                  c.status === "done"
                    ? "text-near-black"
                    : c.status === "failed"
                      ? "text-error-crimson"
                      : "text-stone-gray"
                }`}
              >
                {c.status}
              </span>
            </div>
            <p className="mb-2 line-clamp-1 text-[12.5px] text-near-black">
              <span className="font-mono text-[10.5px] text-stone-gray">query: </span>
              {queries[c.query_idx] ?? "(no query)"}
            </p>
            <div className="grid gap-2 md:grid-cols-[1fr_auto]">
              <div className="rounded border border-border-cream bg-parchment/40 px-2.5 py-2">
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-stone-gray">
                  final_prompt
                </div>
                <p className="line-clamp-3 text-[11.5px] leading-[1.45] text-near-black">
                  {c.final_prompt?.prompt ?? (
                    <span className="italic text-stone-gray">(空 / 失败)</span>
                  )}
                </p>
              </div>
              {c.image_urls && c.image_urls.length > 0 && (
                <a href={c.image_urls[0]} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={c.image_urls[0]}
                    alt=""
                    className="h-20 w-20 rounded border border-border-cream object-cover"
                  />
                </a>
              )}
            </div>
            {c.error && (
              <p className="mt-2 text-[11px] text-error-crimson">{c.error}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── format:1 query × M skill,每 skill 1 个 final_prompt(无生图) ───
function FormatRuns({ record }: { record: ExperimentRecord }) {
  const out = record.output as {
    runs?: Array<{
      format_id: string;
      format_label: string;
      final_prompt?: { prompt: string; size?: string } | null;
      error: string | null;
      raw?: string;
    }>;
  };
  const runs = out.runs ?? [];
  return (
    <section className="space-y-3">
      <h2 className="font-serif text-[16px] font-medium text-near-black">
        API 测试台 · {runs.length} skills
      </h2>
      <ul className="space-y-2">
        {runs.map((r, i) => (
          <li
            key={i}
            className="rounded-lg border border-border-cream bg-ivory px-4 py-3"
          >
            <div className="mb-1.5 flex items-baseline gap-2 text-[12px]">
              <span className="rounded bg-warm-sand/60 px-1.5 py-0 font-mono text-[10px] text-near-black">
                {r.format_id}
              </span>
              <span className="text-[12px] text-near-black">{r.format_label}</span>
              {r.error && (
                <span className="ml-auto text-[11px] text-error-crimson">{r.error}</span>
              )}
            </div>
            <pre className="whitespace-pre-wrap break-words text-[12px] leading-[1.55] text-near-black">
              {r.final_prompt?.prompt ?? (
                <span className="italic text-stone-gray">(空 / 失败)</span>
              )}
            </pre>
          </li>
        ))}
      </ul>
    </section>
  );
}

type TraceEntryLike = {
  step?: string;
  ms?: number;
  attempts?: number;
  status?: string;
  error?: string;
};

function ReplayCards({ record }: { record: ExperimentRecord }) {
  // record.output 的 step1 / step2 / step3 来自 NDJSON 各 phase data,字段集跟 PipelineResponse 完全一致
  const out = record.output as Partial<PipelineResponse>;
  // running 状态下,缺失 step 不是"老 record 没存",而是"还没跑到"。占位 / 提示文案要区分
  const isRunning = record.status === "running";
  // 老 record(2026-05-13 之前)且非 running:缺 creation_planner = 真的没存,显示 legacy 占位
  const isLegacyNoPlanner = !isRunning && !out.creation_planner;
  return (
    <section className="space-y-6">
      <Step1Card running={isRunning} step1={out.step1} />
      {out.creation_planner ? (
        <CreationPlannerCard
          running={isRunning}
          planner={out.creation_planner}
        />
      ) : isLegacyNoPlanner ? (
        <LegacyMissingStepPlaceholder
          stepNum={2}
          title="creation_planner"
          reason="2026-05-13 之前的 record 落盘时未存此阶段。重跑一次即可看到。"
        />
      ) : null /* running 中,空着等下一次轮询 Step1Card 之后这里会自动出 */}
      <Step2Card
        running={isRunning}
        step2={out.step2}
        strategyPack={out.strategy_pack}
      />
      <Step3Card
        running={isRunning}
        step3={out.step3}
        expectedCount={out.step2?.review_result?.reviewed.length}
        readOnly
      />
      {out.step3_direct && (
        <DirectCompareCard
          running={isRunning}
          step3={out.step3}
          step3Direct={out.step3_direct}
          planner={out.creation_planner}
          reviewed={out.step2?.review_result?.reviewed}
          // query 从 record.inputs.query 取(POST route 落盘时只存到 inputs,output 里没有这字段)
          query={
            typeof record.inputs?.query === "string"
              ? record.inputs.query
              : out.query
          }
        />
      )}
      {isLegacyNoPlanner && (
        <div className="rounded-md border border-dashed border-border-warm bg-parchment/30 px-4 py-3 text-[12px] text-stone-gray">
          ⓘ 这条 record 早于 2026-05-13 改造,只能展示 Step 1 / Step 3 / Step 4
          的内容。要看完整 5 卡(含 Step 2 CreationPlanner + 策略包 chip)请重跑 Pipeline。
        </div>
      )}
    </section>
  );
}

// 老 record 缺失某 step 时的占位卡,沿用 StepShell 视觉但内容是说明文字
function LegacyMissingStepPlaceholder({
  stepNum,
  title,
  reason,
}: {
  stepNum: number;
  title: string;
  reason: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border-warm bg-parchment/30 p-6">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-md bg-warm-sand/60 px-2 py-0.5 text-[14px] font-semibold text-near-black/70">
          Step {stepNum}
        </span>
        <h3 className="font-serif text-[20px] font-medium text-stone-gray">
          {title}
        </h3>
        <span className="ml-auto rounded-full bg-warm-sand/40 px-3 py-1 text-[11px] font-medium text-stone-gray">
          未存
        </span>
      </div>
      <p className="text-[12.5px] text-stone-gray">{reason}</p>
    </div>
  );
}

function ChipBlock({
  label,
  map,
  filterEmpty = false,
}: {
  label: string;
  map: Record<string, string>;
  filterEmpty?: boolean;
}) {
  const entries = Object.entries(map).filter(([, v]) =>
    filterEmpty ? Boolean(v) : true,
  );
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-wider text-stone-gray">
        {label}
      </div>
      {entries.length === 0 ? (
        <div className="text-[12px] italic text-stone-gray">(空)</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {entries.map(([k, v]) => (
            <span
              key={k}
              className="rounded-sm bg-parchment px-2 py-0.5 font-mono text-[11px] text-near-black shadow-ring"
              title={`${k} = ${v}`}
            >
              {k}: {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function formatTs(ts: number): string {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
      d.getDate(),
    )} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return String(ts);
  }
}
