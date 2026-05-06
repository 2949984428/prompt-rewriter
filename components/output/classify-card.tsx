// prompt-rewriter/components/output/classify-card.tsx
"use client";

import { useAtomValue } from "jotai";
import { Info } from "lucide-react";
import { rewriteResultAtom } from "@/lib/atoms";
import { CardShell } from "./card-shell";
import { SkeletonBars, WaitingHint } from "./card-skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export function ClassifyCard() {
  const r = useAtomValue(rewriteResultAtom);
  const path = r?.classify?.vertical_path ?? [];

  if (path.length === 0) {
    return (
      <CardShell title="① 这是什么类型的需求" subtitle="AI 从大类一路下钻到具体场景,决定后面用哪套行业经验" index={0} accent="coral">
        <WaitingHint label="AI 正在识别这是哪个行业 / 场景…" />
        <SkeletonBars rows={3} />
      </CardShell>
    );
  }

  return (
    <CardShell title="① 这是什么类型的需求" subtitle="AI 从大类一路下钻到具体场景,决定后面用哪套行业经验" index={0} accent="coral">
      <ul className="space-y-2">
        {path.map((lv) => (
          <li key={lv.level} className="flex items-center gap-4 py-1">
            <span className="w-10 font-mono text-[12px] text-stone-gray">
              Lv{lv.level}
            </span>
            <span className="flex-1 font-sans text-[16px] font-medium text-near-black">
              {lv.label}
            </span>
            <div className="h-1.5 w-[120px] overflow-hidden rounded-full bg-border-cream">
              <div
                className="h-full bg-coral"
                style={{ width: `${Math.round(lv.confidence * 100)}%` }}
              />
            </div>
            <span className="w-12 text-right font-mono text-[13px] text-olive-gray">
              {lv.confidence.toFixed(2)}
            </span>
            <Popover>
              <PopoverTrigger className="text-stone-gray hover:text-olive-gray">
                <Info size={14} />
              </PopoverTrigger>
              <PopoverContent
                side="left"
                className="w-80 rounded-md border-border-cream bg-ivory p-4 shadow-ring"
              >
                <p className="mb-2 font-sans text-[13px] font-medium text-near-black">
                  为什么这层是「{lv.label}」？
                </p>
                <ul className="mb-3 space-y-1 text-[13px] text-olive-gray">
                  {(lv.evidence ?? []).map((e, i) => (
                    <li key={i}>✓ {e}</li>
                  ))}
                </ul>
                {(lv.alternatives_considered ?? []).length > 0 && (
                  <>
                    <p className="mb-1 font-sans text-[13px] font-medium text-near-black">
                      还考虑过：
                    </p>
                    <ul className="space-y-1 text-[13px] text-stone-gray">
                      {(lv.alternatives_considered ?? []).map((a, i) => (
                        <li key={i}>
                          ✗ {a.label} — {a.rejected_because}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </PopoverContent>
            </Popover>
          </li>
        ))}
      </ul>
      {r?.classify?.stop_reason && (
        <p className="mt-4 text-[14px] text-stone-gray">
          停止下钻原因：{r.classify.stop_reason}
        </p>
      )}
    </CardShell>
  );
}
