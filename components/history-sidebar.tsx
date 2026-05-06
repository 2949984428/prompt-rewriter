// prompt-rewriter/components/history-sidebar.tsx
//
// 垂类实验台左侧的历史侧栏(已被 RewriteLab 移除引用,本文件保留以备复用)。
// 新历史架构下读 historyIndex(filter lab_id="rewrite"),
// 点条目 → fetch /api/history-runs/<id> 拉详情 → 填回 query / rewriteResult / currentDetail。
// detail 不再驻内存(全量),只有"当前那条"在 currentRewriteDetailAtom 里。

"use client";

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Trash2, Clock } from "lucide-react";
import {
  queryAtom,
  rewriteResultAtom,
  currentHistoryIdAtom,
  currentRewriteDetailAtom,
} from "@/lib/atoms";
import {
  historyIndexAtom,
  historyIndexLoadedAtom,
} from "@/lib/atoms-history-index";
import type { CurrentRewriteDetail } from "@/lib/atoms";

function fmt(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const ms = now.getTime() - d.getTime();
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");

  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  if (sameDay) return `今天 ${hh}:${mm}`;
  const days = Math.floor(ms / 86400000);
  if (days === 1) return `昨天 ${hh}:${mm}`;
  if (days < 7) return `${days} 天前`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function HistorySidebar() {
  const [index, setIndex] = useAtom(historyIndexAtom);
  const loaded = useAtomValue(historyIndexLoadedAtom);
  const setQuery = useSetAtom(queryAtom);
  const setResult = useSetAtom(rewriteResultAtom);
  const [currentId, setCurrentId] = useAtom(currentHistoryIdAtom);
  const setDetail = useSetAtom(currentRewriteDetailAtom);

  // 只显示 rewrite lab 的条目
  const items = index.filter((x) => x.lab_id === "rewrite");

  // 点击载回:fetch 详情 → 填 query / result / detail / currentId
  const loadEntry = async (id: string) => {
    try {
      const r = await fetch(`/api/history-runs/${encodeURIComponent(id)}`);
      if (!r.ok) {
        console.warn(`[history-sidebar] load detail failed: ${r.status}`);
        return;
      }
      const detail = (await r.json()) as CurrentRewriteDetail;
      setQuery(typeof detail.query === "string" ? detail.query : "");
      setResult(detail.result as never);
      setDetail(detail);
      setCurrentId(id);
    } catch (e) {
      console.warn("[history-sidebar] load detail error:", e);
    }
  };

  // 删除:DELETE /api/history-runs/<id> + 前端 optimistic 移除一条
  const removeEntry = async (id: string) => {
    setIndex(index.filter((x) => x.id !== id));
    if (id === currentId) setCurrentId(null);
    void fetch(`/api/history-runs/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch((e) => console.warn("[history-sidebar] DELETE failed:", e));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border-cream px-4 py-3">
        <Clock size={14} className="text-olive-gray" />
        <span className="font-serif text-[15px] font-medium text-near-black">
          历史轮次
        </span>
        {items.length > 0 && (
          <span className="ml-auto font-mono text-[11px] text-stone-gray">
            {items.length}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!loaded ? (
          <p className="px-2 py-8 text-center font-mono text-[11.5px] text-stone-gray">
            正在加载…
          </p>
        ) : items.length === 0 ? (
          <p className="px-2 py-8 text-center text-[13px] leading-[1.7] text-olive-gray">
            还没有跑过任何 query。
            <br />
            在右边贴一句试试。
          </p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((h) => {
              const active = h.id === currentId;
              return (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => {
                      void loadEntry(h.id);
                    }}
                    className={`group relative w-full rounded-md border px-3 py-2.5 text-left transition ${
                      active
                        ? "border-terracotta bg-coral-soft-bg"
                        : "border-border-cream bg-ivory hover:border-warm-silver hover:bg-warm-tea-deeper"
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-stone-gray">
                        {fmt(h.ts)}
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          void removeEntry(h.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            void removeEntry(h.id);
                          }
                        }}
                        aria-label="删除这条历史"
                        className="cursor-pointer rounded-sm p-0.5 text-stone-gray opacity-0 transition hover:text-error-crimson group-hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-terracotta"
                      >
                        <Trash2 size={12} />
                      </span>
                    </div>
                    <p className="line-clamp-2 text-[13px] leading-[1.45] text-near-black">
                      {h.query}
                    </p>
                    {h.summary && (
                      <p className="mt-1 line-clamp-1 text-[11.5px] text-olive-gray">
                        {h.summary}
                      </p>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
