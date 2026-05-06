// prompt-rewriter/components/global-history-sheet.tsx
//
// 跨实验台的全局历史抽屉。从 historyIndexAtom 读所有 lab 的索引条目,按时间倒序展示,
// 支持按 lab 筛选(all / rewrite / format)。点条目展开看 summary / 评分,
// [跳转]按钮切到对应 lab 并把详情拉回前台(P+:暂只切 tab,详情回填留下波)。

"use client";

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Clock, ExternalLink } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  historyIndexAtom,
  globalHistoryOpenAtom,
  globalHistoryFilterAtom,
  type GlobalHistoryFilter,
} from "@/lib/atoms-history-index";
import { currentLabAtom } from "@/lib/atoms-format";

const FILTERS: { id: GlobalHistoryFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "rewrite", label: "垂类实验台" },
  { id: "format", label: "格式实验台" },
];

const LAB_LABEL: Record<string, string> = {
  rewrite: "垂类",
  format: "格式",
};

function fmtTs(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${sameDay ? "今天" : `${d.getMonth() + 1}/${d.getDate()}`} ${hh}:${mm}`;
}

export function GlobalHistorySheet() {
  const [open, setOpen] = useAtom(globalHistoryOpenAtom);
  const [filter, setFilter] = useAtom(globalHistoryFilterAtom);
  const index = useAtomValue(historyIndexAtom);
  const setLab = useSetAtom(currentLabAtom);

  const filtered = filter === "all" ? index : index.filter((x) => x.lab_id === filter);

  return (
    <Sheet open={open} onOpenChange={(v) => setOpen(v)}>
      <SheetContent
        side="right"
        className="w-[520px] border-l-border-cream bg-ivory p-0 sm:max-w-none"
      >
        <SheetHeader className="border-b border-border-cream px-6 py-4">
          <SheetTitle className="flex items-center gap-2 font-serif text-[20px] font-medium text-near-black">
            <Clock size={18} />
            全局历史
          </SheetTitle>
          <p className="text-[12.5px] leading-[1.5] text-stone-gray">
            所有实验台跑过的 query · 共 {index.length} 条 · 显示 {filtered.length}
          </p>
        </SheetHeader>

        {/* 筛选 chips */}
        <div className="flex gap-2 border-b border-border-cream px-6 py-2.5">
          {FILTERS.map((f) => {
            const active = f.id === filter;
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`rounded-full px-3 py-1 font-mono text-[12px] transition ${
                  active
                    ? "bg-terracotta text-ivory"
                    : "bg-warm-sand text-charcoal-warm hover:bg-coral-soft-bg/50"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <div className="h-[calc(100vh-188px)] overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-10 pt-12 text-center font-serif text-[15px] text-olive-gray">
              {index.length === 0
                ? "还没有跑过任何实验。先在主区跑一次。"
                : "当前筛选下无结果。"}
            </p>
          ) : (
            <ul className="space-y-2 p-4">
              {filtered.map((e) => (
                <li
                  key={e.id}
                  className="rounded-md border border-border-cream bg-parchment/50 p-3"
                >
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${
                        e.lab_id === "rewrite"
                          ? "bg-warm-sand text-charcoal-warm"
                          : "bg-coral-soft-bg text-terracotta"
                      }`}
                    >
                      {LAB_LABEL[e.lab_id] ?? e.lab_id}
                    </span>
                    <span className="font-mono text-[11px] text-stone-gray">
                      {fmtTs(e.ts)}
                    </span>
                  </div>
                  <p className="line-clamp-2 font-sans text-[13px] text-near-black">
                    {e.query || "(空 query)"}
                  </p>
                  {e.summary && (
                    <p className="mt-1 font-sans text-[12px] text-olive-gray">
                      {e.summary}
                    </p>
                  )}
                  <div className="mt-2 flex items-center justify-between">
                    <span className="font-mono text-[11px] text-stone-gray">
                      {e.pm_score_count > 0
                        ? `评分 ${e.pm_score_count} 项 · 平均 ${e.pm_score_avg?.toFixed(1) ?? "—"}`
                        : `状态 ${e.status}`}
                    </span>
                    <button
                      onClick={() => {
                        setLab(e.lab_id === "format" ? "format" : "rewrite");
                        setOpen(false);
                      }}
                      className="flex items-center gap-1 font-mono text-[11px] text-olive-gray hover:text-terracotta"
                    >
                      <ExternalLink size={11} />
                      去 {LAB_LABEL[e.lab_id] ?? e.lab_id}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
