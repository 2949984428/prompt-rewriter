// prompt-rewriter/components/labs/format/result-grid.tsx
//
// 横向 N 列结果网格。每列一个 FormatCell。
// 响应式:1 列(<sm) / 2 列(sm-lg) / 3 列(lg+)。

"use client";

import { useAtomValue } from "jotai";
import { currentFormatRunAtom } from "@/lib/atoms-format";
import { FormatCell } from "./format-cell";

export function FormatResultGrid() {
  const run = useAtomValue(currentFormatRunAtom);
  if (!run) {
    return (
      <section className="rounded-lg border border-dashed border-border-warm bg-ivory p-12 text-center">
        <p className="font-serif text-[16px] text-stone-gray">
          选好格式 → 输入 query → 点跑 → 这里展示横向对比
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between">
        <p className="font-sans text-[14px] text-olive-gray">
          query: <span className="text-near-black">{run.query}</span>
        </p>
        {run.winner_format_id && (
          <p className="font-mono text-[12px] text-terracotta">
            🏆 {run.format_runs.find((r) => r.format_id === run.winner_format_id)?.format_label}
          </p>
        )}
      </header>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {run.format_runs.map((r) => (
          <FormatCell
            key={r.format_id}
            formatId={r.format_id}
            isWinner={r.format_id === run.winner_format_id}
          />
        ))}
      </div>
    </section>
  );
}
