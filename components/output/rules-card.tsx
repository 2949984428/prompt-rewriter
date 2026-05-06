// prompt-rewriter/components/output/rules-card.tsx
"use client";

import { useAtomValue } from "jotai";
import { rewriteResultAtom } from "@/lib/atoms";
import { CardShell } from "./card-shell";
import { SkeletonBars, WaitingHint } from "./card-skeleton";

export function RulesCard() {
  const r = useAtomValue(rewriteResultAtom);
  const rules = r?.applied_hard_rules ?? [];
  const stepDone = !!r?.buffers || !!r?.final_prompt;

  if (rules.length === 0 && !stepDone) {
    return (
      <CardShell
        title="④ 检查硬约束是否命中"
        subtitle="逐条扫运营配置的铁律,命中的必须原样注入最终 prompt"
        index={3} accent="crimson"
      >
        <WaitingHint label="AI 正在逐条对照你配置的硬约束…" />
        <SkeletonBars rows={3} />
      </CardShell>
    );
  }

  if (rules.length === 0 && stepDone) {
    return (
      <CardShell
        title="④ 检查硬约束是否命中"
        subtitle="逐条扫运营配置的铁律,命中的必须原样注入最终 prompt"
        index={3} accent="crimson"
      >
        <p className="py-2 text-[13px] italic text-stone-gray">
          你当前没有启用任何硬约束,或全部规则本轮未命中 —— 没有铁律要写进 prompt。
        </p>
      </CardShell>
    );
  }

  return (
    <CardShell
      title="④ 检查硬约束是否命中"
      subtitle="逐条扫运营配置的铁律,命中的必须原样注入最终 prompt"
      index={3} accent="crimson"
    >
      <div className="space-y-3">
        {rules.map((rule, i) => (
          <div
            key={i}
            className={`rounded-md border border-border-cream p-4 ${
              rule.hit ? "bg-ivory" : "bg-ivory opacity-60"
            }`}
          >
            <div className="flex items-baseline gap-2">
              <span>{rule.hit ? "✅" : "⚪"}</span>
              <span
                className={`font-mono text-[14px] ${
                  rule.hit ? "font-medium text-near-black" : "text-stone-gray"
                }`}
              >
                {rule.rule_id}
              </span>
            </div>
            {rule.hit ? (
              <dl className="mt-2 grid grid-cols-[90px_1fr] gap-y-1.5 text-[14px]">
                <dt className="font-mono text-[12px] text-stone-gray">为何命中:</dt>
                <dd className="text-olive-gray">{rule.triggered_by}</dd>
                <dt className="font-mono text-[12px] text-stone-gray">要写什么:</dt>
                <dd>
                  <code className="rounded bg-border-cream px-1.5 py-0.5 font-mono text-[13px] text-near-black">
                    {rule.injection}
                  </code>
                </dd>
                <dt className="font-mono text-[12px] text-stone-gray">写在哪里:</dt>
                <dd className="text-olive-gray">{rule.injection_location}</dd>
              </dl>
            ) : (
              <p className="mt-1 text-[13px] text-stone-gray">
                没命中的原因:{rule.skipped_because}
              </p>
            )}
          </div>
        ))}
      </div>
    </CardShell>
  );
}
