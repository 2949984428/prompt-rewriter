// prompt-rewriter/components/labs/fusion/list-view.tsx
//
// 融合台列表页:扫所有 run summaries 列出来。
// 顶部"+ 新建融合"按钮 → 切到 create view。
// 点列表项 → 切到 detail view。

"use client";

import { useEffect } from "react";
import { useAtom } from "jotai";
import { Plus, RefreshCw } from "lucide-react";
import {
  fusionViewAtom,
  fusionSummariesAtom,
  fusionSummariesLoadedAtom,
} from "@/lib/atoms-fusion";
import type { FusionRunSummary } from "@/lib/schema";

const STATUS_LABEL: Record<FusionRunSummary["status"], string> = {
  draft: "未完成",
  merging: "融合中",
  ready: "已就绪",
  discarded: "已丢弃",
};

const STATUS_BADGE: Record<FusionRunSummary["status"], string> = {
  draft: "border-stone-gray text-stone-gray",
  merging: "border-warm-gold-fg bg-warm-gold-bg text-warm-gold-fg",
  ready: "border-terracotta bg-coral-soft-bg/40 text-terracotta",
  discarded: "border-stone-gray bg-warm-sand/40 text-stone-gray",
};

export function FusionListView() {
  const [, setView] = useAtom(fusionViewAtom);
  const [summaries, setSummaries] = useAtom(fusionSummariesAtom);
  const [loaded, setLoaded] = useAtom(fusionSummariesLoadedAtom);

  const refresh = async () => {
    try {
      const r = await fetch("/api/labs/fusion/runs", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { runs?: FusionRunSummary[] };
      if (Array.isArray(j.runs)) setSummaries(j.runs);
      setLoaded(true);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!loaded) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <header className="flex items-center justify-between">
        <h2 className="font-serif text-[20px] text-near-black">历次融合</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            className="flex h-8 items-center gap-1.5 rounded-md border border-border-cream bg-ivory px-3 text-[13px] text-olive-gray transition hover:bg-warm-sand/40"
            title="刷新列表"
          >
            <RefreshCw size={13} />
            刷新
          </button>
          <button
            onClick={() => setView({ kind: "create" })}
            className="flex h-8 items-center gap-1.5 rounded-md bg-terracotta px-3 text-[13px] font-medium text-white transition hover:bg-terracotta/90"
          >
            <Plus size={14} />
            新建融合
          </button>
        </div>
      </header>

      {summaries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-cream bg-ivory/60 p-12 text-center text-[14px] text-stone-gray">
          {loaded
            ? "还没有任何融合记录,点右上「新建融合」开始"
            : "加载中…"}
        </div>
      ) : (
        <ul className="space-y-2">
          {summaries.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => setView({ kind: "detail", id: s.id })}
                className="block w-full rounded-md border border-border-cream bg-ivory px-4 py-3 text-left transition hover:bg-warm-sand/30"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[14px] font-medium text-near-black">
                        {s.name || `融合 ${s.id.slice(0, 8)}`}
                      </span>
                      <span
                        className={`shrink-0 rounded border px-1.5 py-px text-[10px] uppercase ${STATUS_BADGE[s.status]}`}
                      >
                        {STATUS_LABEL[s.status]}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-olive-gray">
                      规则: {s.rule_label} · attempts: {s.attempt_count}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-stone-gray">
                      原 prompt: {s.source_prompt_preview}…
                    </div>
                  </div>
                  <div className="shrink-0 text-[11px] text-stone-gray">
                    {new Date(s.created_at).toLocaleString("zh-CN")}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
