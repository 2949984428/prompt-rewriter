// prompt-rewriter/components/labs/format/format-selector.tsx
//
// 多选格式 checkbox 列表。从 formatSkillsAtom 读全部可选格式,勾选状态写到 formatSelectedIdsAtom。

"use client";

import { useAtom, useAtomValue } from "jotai";
import { Check } from "lucide-react";
import { formatSkillsAtom, formatSelectedIdsAtom } from "@/lib/atoms-format";

export function FormatSelector() {
  const skills = useAtomValue(formatSkillsAtom);
  const [selected, setSelected] = useAtom(formatSelectedIdsAtom);

  const toggle = (id: string) =>
    setSelected(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id]
    );

  if (skills.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border-warm bg-ivory p-6 text-center text-[14px] text-stone-gray">
        正在加载格式池…
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {skills.map((s) => {
        const on = selected.includes(s.id);
        return (
          <button
            key={s.id}
            onClick={() => toggle(s.id)}
            className={`flex w-full items-start gap-3 rounded-md border px-4 py-3 text-left transition ${
              on
                ? "border-terracotta bg-coral-soft-bg/40"
                : "border-border-cream bg-ivory hover:border-border-warm"
            }`}
          >
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border ${
                on
                  ? "border-terracotta bg-terracotta text-ivory"
                  : "border-stone-gray bg-transparent"
              }`}
            >
              {on && <Check size={14} strokeWidth={3} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[13px] font-medium text-near-black">
                {s.label}
              </div>
              <div className="mt-0.5 text-[12.5px] leading-[1.4] text-stone-gray">
                {s.notes}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
