// prompt-rewriter/components/output/buffers-card.tsx
"use client";

import { useAtomValue } from "jotai";
import { rewriteResultAtom } from "@/lib/atoms";
import { CardShell } from "./card-shell";
import { SkeletonBars, WaitingHint } from "./card-skeleton";

export function BuffersCard() {
  const r = useAtomValue(rewriteResultAtom);
  const buffers = r?.buffers ?? [];
  const stepDone = !!r?.final_prompt;

  if (buffers.length === 0 && !stepDone) {
    return (
      <CardShell
        title="⑤ 补齐审美与细节"
        subtitle="只对粗略 query 生效:AI 提名候选润色短语,决定哪些真正上场"
        index={4} accent="silver"
      >
        <WaitingHint label="AI 正在判断是否需要补润色短语…" />
        <SkeletonBars rows={3} />
      </CardShell>
    );
  }

  if (buffers.length === 0 && stepDone) {
    return (
      <CardShell
        title="⑤ 补齐审美与细节"
        subtitle="只对粗略 query 生效:AI 提名候选润色短语,决定哪些真正上场"
        index={4} accent="silver"
      >
        <p className="py-2 text-[13px] italic text-stone-gray">
          query 已经足够具体,AI 按扩写纪律不再额外加润色 —— 避免过度美化带偏原意。
        </p>
      </CardShell>
    );
  }

  return (
    <CardShell
      title="⑤ 补齐审美与细节"
      subtitle="只对粗略 query 生效:AI 提名候选润色短语,决定哪些真正上场"
      index={4} accent="silver"
    >
      <div className="space-y-3">
        {buffers.map((b, i) => (
          <div key={i} className="rounded-md border border-border-cream p-4">
            <div className="flex items-baseline gap-2">
              <span className={b.picked ? "text-coral" : "text-stone-gray"}>
                {b.picked ? "✅" : "❌"}
              </span>
              <span
                className={`font-sans text-[16px] font-medium ${
                  b.picked ? "text-near-black" : "text-stone-gray"
                }`}
              >
                {b.label}
              </span>
            </div>
            <p className="ml-6 mt-1 text-[14px] text-olive-gray">
              {b.picked ? "为什么上场:" : "为什么不用:"}{b.reason}
            </p>
            {b.picked && (b.phrases ?? []).length > 0 && (
              <div className="ml-6 mt-2 flex flex-wrap gap-2">
                {(b.phrases ?? []).map((p, j) => (
                  <span
                    key={j}
                    className="rounded-full bg-coral-soft-bg px-2.5 py-1 font-mono text-[13px] text-terracotta"
                  >
                    {p}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </CardShell>
  );
}
