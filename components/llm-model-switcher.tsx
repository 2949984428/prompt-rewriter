// prompt-rewriter/components/llm-model-switcher.tsx
//
// 跨 lab 共享的 LLM 模型 dropdown。挂在两个 lab 的输入区上方,
// 改这里的选择会立刻影响下次跑改写(input-bar 在 fetch body 里把 llmModelAtom 当前值传过去)。
// 没有"提交"按钮 — atom 一变即生效。

"use client";

import { useAtom, useAtomValue } from "jotai";
import { Sparkles } from "lucide-react";
import { llmModelAtom, llmModelOptionsAtom } from "@/lib/atoms";

export function LlmModelSwitcher() {
  const options = useAtomValue(llmModelOptionsAtom);
  const [model, setModel] = useAtom(llmModelAtom);

  if (options.length === 0) {
    // 没拉到列表:保持空,不显示控件,免得误导
    return null;
  }

  const current = options.find((o) => o.id === model);

  return (
    <div className="flex items-center gap-2">
      <Sparkles size={14} className="text-stone-gray" />
      <span className="font-mono text-[12px] text-stone-gray">改写模型</span>
      <select
        value={model}
        onChange={(e) => setModel(e.target.value)}
        className="rounded-sm border border-border-cream bg-ivory px-2 py-1 font-sans text-[13px] text-near-black focus:outline-none focus:border-coral"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {current?.notes && (
        <span
          title={current.notes}
          className="cursor-help font-mono text-[11px] text-stone-gray"
        >
          ⓘ
        </span>
      )}
    </div>
  );
}
