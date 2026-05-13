// prompt-rewriter/components/labs/experiments/list.tsx
//
// Experiments 列表视图。
// 数据走 GET /api/experiments?limit=50&offset=0,后端实际从 history-index.json 读瘦索引(ms 级)。
// 行点击 / 「查看详情」 → setSelectedExperimentId(id) 切详情视图(SPA 内部)。

"use client";

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useState } from "react";
import {
  experimentListCacheAtom,
  experimentListPipelineIdAtom,
  experimentListQueryAtom,
  experimentListTagAtom,
  selectedExperimentIdAtom,
} from "@/lib/atoms-experiments";
import type { ExperimentRecordHead } from "@/lib/schema";

export function ExperimentsList() {
  const [q, setQ] = useAtom(experimentListQueryAtom);
  const [tag, setTag] = useAtom(experimentListTagAtom);
  const [pipelineId, setPipelineId] = useAtom(experimentListPipelineIdAtom);
  const [cache, setCache] = useAtom(experimentListCacheAtom);
  const setSelected = useSetAtom(selectedExperimentIdAtom);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (tag.trim()) params.set("tag", tag.trim());
      if (pipelineId.trim()) params.set("pipeline_id", pipelineId.trim());
      params.set("limit", "50");
      params.set("offset", "0");
      const r = await fetch(`/api/experiments?${params.toString()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = (await r.json()) as {
        items: ExperimentRecordHead[];
        total: number;
      };
      setCache(json.items);
      setTotal(json.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [q, tag, pipelineId, setCache]);

  // 进入页面 / 筛选变化都重拉(debounce 300ms 避免输入抖动)
  useEffect(() => {
    const t = setTimeout(refresh, 300);
    return () => clearTimeout(t);
  }, [refresh]);

  const items = cache ?? [];

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-6">
        <div>
          <h1 className="font-serif text-[32px] font-medium leading-[1.2] text-near-black">
            Experiments
          </h1>
          <p className="mt-2 text-[14px] text-stone-gray">
            Pipeline lab 每次跑批落盘的实验记录 · 含 inputs / config_snapshot / output / trace,
            可对照 / 回放。
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="rounded-md border border-border-warm bg-parchment px-4 py-2 text-[13px] text-charcoal-warm transition hover:bg-warm-tea-deeper disabled:opacity-40"
        >
          {loading ? "刷新中…" : "↻ 刷新"}
        </button>
      </header>

      {/* 筛选条 */}
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border-cream bg-parchment/40 px-4 py-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜 query…"
          className="w-[280px] rounded-md border border-border-cream bg-ivory px-3 py-1.5 text-[13px] focus:border-terracotta focus:outline-none"
        />
        <input
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          placeholder="tag(精确匹配)"
          className="w-[160px] rounded-md border border-border-cream bg-ivory px-3 py-1.5 text-[13px] focus:border-terracotta focus:outline-none"
        />
        <input
          value={pipelineId}
          onChange={(e) => setPipelineId(e.target.value)}
          placeholder="pipeline_id"
          className="w-[220px] rounded-md border border-border-cream bg-ivory px-3 py-1.5 font-mono text-[12px] focus:border-terracotta focus:outline-none"
        />
        <span className="text-[12px] text-stone-gray">
          {total === null
            ? loading
              ? "载入中…"
              : ""
            : `共 ${total} 条${
                items.length < total ? `(显示前 ${items.length})` : ""
              }`}
        </span>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          ⚠ {error}
        </div>
      )}

      {/* 列表表格 */}
      {items.length === 0 && !loading && !error ? (
        <div className="rounded-md border border-dashed border-border-cream bg-parchment/30 px-6 py-12 text-center text-[13px] text-stone-gray">
          {(q || tag || pipelineId)
            ? "当前筛选条件下没有记录"
            : "还没有 experiment 记录 — 去 Pipeline 跑一次"}
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border-cream bg-ivory">
          <table className="w-full table-auto text-left text-[13px]">
            <thead className="border-b border-border-cream bg-parchment/40 text-[11.5px] uppercase tracking-wider text-stone-gray">
              <tr>
                <th className="px-4 py-2.5 font-medium">时间</th>
                <th className="px-4 py-2.5 font-medium">Query</th>
                <th className="px-4 py-2.5 font-medium">策略版本</th>
                <th className="px-4 py-2.5 font-medium">模型</th>
                <th className="px-4 py-2.5 font-medium">Tags</th>
                <th className="px-4 py-2.5 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr
                  key={it.id}
                  onClick={() => setSelected(it.id)}
                  className="cursor-pointer border-b border-border-cream/60 transition last:border-b-0 hover:bg-warm-sand/30"
                >
                  <td className="px-4 py-3 font-mono text-[11.5px] text-olive-gray">
                    {formatTs(it.ts)}
                    {it.metadata.replay_of && (
                      <div className="text-[10.5px] text-terracotta">
                        复跑自 {it.metadata.replay_of.slice(0, 14)}…
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-near-black">
                    <div className="mb-1 flex items-center gap-1.5">
                      <SourceKindBadge kind={it.source_kind} />
                    </div>
                    <div
                      className="line-clamp-2 max-w-[360px] leading-tight"
                      title={it.query}
                    >
                      {it.query || (
                        <span className="italic text-stone-gray">(空 query)</span>
                      )}
                    </div>
                    {it.metadata.note && (
                      <div className="mt-1 line-clamp-1 max-w-[360px] text-[11px] text-stone-gray">
                        📝 {it.metadata.note}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <ChipGroup map={it.strategy_versions} />
                  </td>
                  <td className="px-4 py-3">
                    <ChipGroup
                      map={{
                        search: it.models.search,
                        review: it.models.review,
                        image: it.models.image,
                      }}
                      filterEmpty
                    />
                  </td>
                  <td className="px-4 py-3">
                    {it.tags.length === 0 ? (
                      <span className="text-[11.5px] text-stone-gray">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {it.tags.map((t) => (
                          <span
                            key={t}
                            className="rounded-sm bg-warm-sand/60 px-1.5 py-0.5 text-[11px] text-near-black"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(it.id);
                      }}
                      className="rounded-sm border border-border-warm bg-parchment px-2.5 py-1 text-[11.5px] text-charcoal-warm transition hover:bg-warm-tea-deeper"
                    >
                      查看详情 →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ChipGroup({
  map,
  filterEmpty = false,
}: {
  map: Record<string, string>;
  filterEmpty?: boolean;
}) {
  const entries = Object.entries(map).filter(([, v]) =>
    filterEmpty ? Boolean(v) : true,
  );
  if (entries.length === 0)
    return <span className="text-[11.5px] text-stone-gray">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([k, v]) => (
        <span
          key={k}
          className="rounded-sm bg-parchment px-1.5 py-0.5 font-mono text-[10.5px] text-near-black shadow-ring"
          title={`${k} = ${v}`}
        >
          {k}: {short(v)}
        </span>
      ))}
    </div>
  );
}

function SourceKindBadge({ kind }: { kind: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pipeline_lab: { label: "PipelineLab", cls: "bg-terracotta/15 text-terracotta" },
    batch_pipeline: { label: "Pipeline 测试台", cls: "bg-terracotta/15 text-terracotta" },
    batch_skill: { label: "Skill 测试台", cls: "bg-warm-sand/70 text-near-black" },
    format: { label: "API 测试台", cls: "bg-warm-gold-bg text-warm-gold-fg" },
  };
  const m = map[kind] ?? { label: kind, cls: "bg-stone-200 text-stone-700" };
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${m.cls}`}
    >
      {m.label}
    </span>
  );
}

function short(v: string): string {
  if (v.length <= 26) return v;
  return v.slice(0, 12) + "…" + v.slice(-10);
}

function formatTs(ts: number): string {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
      d.getDate(),
    )} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return String(ts);
  }
}
