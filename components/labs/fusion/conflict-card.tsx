// prompt-rewriter/components/labs/fusion/conflict-card.tsx
//
// 冲突展开 panel。点击红色 conflict marker 后弹出。
// 内容:原文 / 新规则 / LLM 解释 / 单按钮"回退该处保留原文"。
// 回退实现:把"回退该处"这件事作为 hint 传给 /merge 重试,LLM 重新生成。

"use client";

import { Undo2 } from "lucide-react";
import type { FusionConflict } from "@/lib/schema";

export function ConflictCard({
  conflict,
  onRollback,
}: {
  conflict: FusionConflict;
  onRollback: () => void;
}) {
  return (
    <div className="mt-1 rounded-md border-2 border-error-crimson/60 bg-coral-soft-bg/30 p-3 font-sans text-[12.5px] text-near-black shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-error-crimson">
          ⚠ 冲突 #{conflict.id}
        </span>
        <span className="text-[11px] text-stone-gray">
          默认:新规则赢
        </span>
      </div>

      <div className="mb-2 space-y-2">
        <div>
          <div className="text-[11px] text-olive-gray">原 prompt 段:</div>
          <pre className="mt-0.5 whitespace-pre-wrap rounded bg-white/60 p-2 font-mono text-[11.5px] text-stone-gray">
            {conflict.original_text}
          </pre>
        </div>
        <div>
          <div className="text-[11px] text-olive-gray">新规则要求:</div>
          <pre className="mt-0.5 whitespace-pre-wrap rounded bg-white/60 p-2 font-mono text-[11.5px] text-near-black">
            {conflict.new_rule_text}
          </pre>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onRollback}
          className="flex h-7 items-center gap-1.5 rounded-md border border-error-crimson/40 bg-white/80 px-2.5 text-[11.5px] font-medium text-error-crimson transition hover:bg-coral-soft-bg/60"
          title="把这处冲突按原文保留(走 hint 重试,LLM 重新生成整个融合)"
        >
          <Undo2 size={11} />
          回退该处保留原文
        </button>
      </div>
    </div>
  );
}
