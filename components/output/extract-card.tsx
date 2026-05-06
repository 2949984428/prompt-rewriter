// prompt-rewriter/components/output/extract-card.tsx
"use client";

import { useAtomValue } from "jotai";
import { rewriteResultAtom } from "@/lib/atoms";
import { CardShell } from "./card-shell";
import { SkeletonBars, WaitingHint } from "./card-skeleton";

const CHIP: Record<string, { bg: string; fg: string; label: string }> = {
  user_query: { bg: "bg-warm-sand", fg: "text-charcoal-warm", label: "原文给的" },
  gap: { bg: "bg-warm-gold-bg", fg: "text-warm-gold-fg", label: "缺口·需追问" },
  ai_inferred: { bg: "bg-warm-tea-bg", fg: "text-olive-gray", label: "AI 推断" },
};

export function ExtractCard() {
  const r = useAtomValue(rewriteResultAtom);
  const items = r?.extract ?? [];
  // 流式按 schema 字段顺序填参:只要下游任一字段出现,extract 就一定已走完。
  // 此时 items 为 0 表示 LLM 实际给了空数组(或 from enum 值全部非法被过滤),
  // 应显示"无条目",而不是卡在等待骨架。
  const stepDone =
    !!r?.domain_thinking ||
    !!r?.applied_hard_rules ||
    !!r?.buffers ||
    !!r?.final_prompt;

  if (items.length === 0 && !stepDone) {
    return (
      <CardShell title="② 拆出用户要的关键字段" subtitle="哪些是原文给的、哪些由 AI 推断、哪些是缺口需要追问" index={1} accent="gold">
        <WaitingHint label="AI 正在把 query 拆成结构化字段…" />
        <SkeletonBars rows={4} />
      </CardShell>
    );
  }

  if (items.length === 0 && stepDone) {
    return (
      <CardShell title="② 拆出用户要的关键字段" subtitle="哪些是原文给的、哪些由 AI 推断、哪些是缺口需要追问" index={1} accent="gold">
        <p className="py-2 text-[13px] italic text-stone-gray">
          AI 判断这条 query 已经足够具体,无需再拆字段补齐。
        </p>
      </CardShell>
    );
  }

  return (
    <CardShell title="② 拆出用户要的关键字段" subtitle="哪些是原文给的、哪些由 AI 推断、哪些是缺口需要追问" index={1} accent="gold">
      <table className="w-full border-collapse">
        <tbody>
          {items.map((it, i) => {
            const c = CHIP[it.from] ?? CHIP.ai_inferred;
            return (
              <tr
                key={i}
                className={`border-t border-border-cream ${
                  it.from === "gap" ? "hover:ring-1 hover:ring-coral" : ""
                }`}
              >
                <td className="py-3 pr-4 font-mono text-[14px] text-stone-gray">
                  {it.field}
                </td>
                <td className="py-3 pr-4 font-sans text-[16px] text-near-black">
                  {it.value}
                </td>
                <td className="py-3 text-right">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-[12px] font-medium tracking-[0.12px] ${c.bg} ${c.fg}`}
                    title={it.reason || undefined}
                  >
                    {c.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </CardShell>
  );
}
