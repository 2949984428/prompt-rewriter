// prompt-rewriter/components/labs/format/drawer/format-history-list.tsx
//
// 格式实验台抽屉里的"跑批历史" tab。新历史架构下:
//   - 列表读 historyIndex (filter lab_id="format")
//   - 点 [载回] 时 fetch /api/history-runs/<id> 拉详情 → 填回 currentFormatRunAtom
//   - 删除走 DELETE /api/history-runs/<id>

"use client";

import { useAtom, useSetAtom } from "jotai";
import { Trash2, RotateCcw } from "lucide-react";
import {
  currentFormatRunAtom,
  formatDrawerOpenAtom,
} from "@/lib/atoms-format";
import { historyIndexAtom } from "@/lib/atoms-history-index";
import type { FormatRunRecord } from "@/lib/schema-format";

function fmtTs(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm} ${sameDay ? "今天" : `${d.getMonth() + 1}/${d.getDate()}`}`;
}

export function FormatHistoryList() {
  const [index, setIndex] = useAtom(historyIndexAtom);
  const setCurrentRun = useSetAtom(currentFormatRunAtom);
  const setOpen = useSetAtom(formatDrawerOpenAtom);

  const items = index.filter((x) => x.lab_id === "format");

  const loadEntry = async (id: string) => {
    try {
      const r = await fetch(`/api/history-runs/${encodeURIComponent(id)}`);
      if (!r.ok) {
        console.warn(`[format-history-list] load detail failed: ${r.status}`);
        return;
      }
      const detail = (await r.json()) as FormatRunRecord;
      setCurrentRun(detail);
      setOpen(false);
    } catch (e) {
      console.warn("[format-history-list] load error:", e);
    }
  };

  const removeEntry = (id: string) => {
    setIndex(index.filter((x) => x.id !== id));
    void fetch(`/api/history-runs/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch((e) => console.warn("[format-history-list] DELETE failed:", e));
  };

  if (items.length === 0) {
    return (
      <p className="px-10 pt-12 text-center font-serif text-[15px] text-olive-gray">
        还没跑过格式对照。先回主区跑一次。
      </p>
    );
  }

  return (
    <div className="space-y-3 p-6">
      {items.map((h) => (
        <div
          key={h.id}
          className="rounded-md border border-border-cream bg-ivory p-3"
        >
          <div className="mb-1 flex items-baseline justify-between">
            <span className="font-mono text-[11px] text-stone-gray">
              {fmtTs(h.ts)}
            </span>
            <span className="font-mono text-[11px] text-olive-gray">
              {h.pm_score_count > 0
                ? `平均 ${h.pm_score_avg?.toFixed(1) ?? "—"} (${h.pm_score_count})`
                : `${h.summary || "—"}`}
            </span>
          </div>
          <p className="line-clamp-2 font-sans text-[13px] text-near-black">
            {h.query}
          </p>
          {h.summary && h.pm_score_count > 0 && (
            <p className="mt-1 font-sans text-[12px] text-terracotta">
              {h.summary}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => void loadEntry(h.id)}
              className="flex items-center gap-1 rounded-sm bg-warm-sand px-2 py-1 font-mono text-[11px] text-charcoal-warm shadow-ring hover:shadow-ring-prom"
            >
              <RotateCcw size={11} /> 载回
            </button>
            <button
              onClick={() => removeEntry(h.id)}
              className="text-stone-gray hover:text-error-crimson"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
