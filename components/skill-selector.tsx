// prompt-rewriter/components/skill-selector.tsx
//
// 通用 skill 多选组件。format / batch 两个 lab 共用。
// - 不依赖具体 atom，全部从 props 进出（caller 决定状态来源：atom / local state）
// - 两种布局：single（单列，format 用）/ grid（双列，batch 用）
// - 视觉风格统一：terracotta 选中色 + Check icon

"use client";

import { Check } from "lucide-react";

export type SkillSelectorItem = {
  id: string;
  label: string;
  notes?: string;
};

interface SkillSelectorProps {
  skills: SkillSelectorItem[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  layout?: "single" | "grid";
  emptyText?: string;
}

export function SkillSelector({
  skills,
  selectedIds,
  onToggle,
  layout = "single",
  emptyText = "正在加载 skill…",
}: SkillSelectorProps) {
  if (skills.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border-warm bg-ivory p-6 text-center text-[14px] text-stone-gray">
        {emptyText}
      </p>
    );
  }

  const containerCls =
    layout === "grid" ? "grid grid-cols-2 gap-1.5" : "space-y-1.5";

  return (
    <div className={containerCls}>
      {skills.map((s) => {
        const on = selectedIds.includes(s.id);
        return (
          <button
            key={s.id}
            onClick={() => onToggle(s.id)}
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
              {s.notes && (
                <div className="mt-0.5 text-[12.5px] leading-[1.4] text-stone-gray">
                  {s.notes}
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
