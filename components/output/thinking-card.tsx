// prompt-rewriter/components/output/thinking-card.tsx
"use client";

import { useAtomValue } from "jotai";
import { rewriteResultAtom } from "@/lib/atoms";
import { CardShell } from "./card-shell";
import { SkeletonBars, WaitingHint } from "./card-skeleton";
import { MdPreview } from "@/components/drawer/md-preview";

export function ThinkingCard() {
  const r = useAtomValue(rewriteResultAtom);
  const thoughts = r?.domain_thinking ?? [];
  const stepDone = !!r?.applied_hard_rules || !!r?.buffers || !!r?.final_prompt;

  if (thoughts.length === 0 && !stepDone) {
    return (
      <CardShell
        title="③ 调用专业领域的思考"
        subtitle="AI 扮演垂直领域专家,识别隐含要求、行业惯例与常见失败模式"
        index={2} accent="olive"
      >
        <WaitingHint label="AI 正在调用该领域的专业思考…" />
        <SkeletonBars rows={5} />
      </CardShell>
    );
  }

  if (thoughts.length === 0 && stepDone) {
    return (
      <CardShell
        title="③ 调用专业领域的思考"
        subtitle="AI 扮演垂直领域专家,识别隐含要求、行业惯例与常见失败模式"
        index={2} accent="olive"
      >
        <p className="py-2 text-[13px] italic text-stone-gray">
          AI 判断这条 query 场景过于简单,无需调用专业思考。
        </p>
      </CardShell>
    );
  }

  return (
    <CardShell
      title="③ 调用专业领域的思考"
      subtitle="AI 扮演垂直领域专家,识别隐含要求、行业惯例与常见失败模式"
      index={2} accent="olive"
    >
      <div className="space-y-4">
        {thoughts.map((t, i) => (
          <div
            key={i}
            className="rounded-md border border-border-warm bg-ivory p-5"
          >
            <div className="mb-3 font-mono text-[13px] text-olive-gray">
              💡 触发点:{t.trigger}
            </div>
            <MdPreview
              source={t.thought}
              className="prose-thought font-serif text-[15px] leading-[1.65] text-near-black [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5 [&_strong]:text-terracotta [&_strong]:font-semibold"
            />
            {(t.produces_phrases ?? []).length > 0 && (
              <>
                <p className="mb-2 mt-4 font-mono text-[12px] text-stone-gray">
                  ↳ 由此产出、将写进最终 prompt 的短语:
                </p>
                <div className="flex flex-wrap gap-2">
                  {(t.produces_phrases ?? []).map((p, j) => (
                    <span
                      key={j}
                      className="rounded-full bg-coral-soft-bg px-2.5 py-1 font-mono text-[13px] text-terracotta"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </CardShell>
  );
}
