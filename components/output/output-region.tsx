// prompt-rewriter/components/output/output-region.tsx
"use client";

import { useAtomValue } from "jotai";
import { rewriteResultAtom, isRunningAtom, runErrorAtom } from "@/lib/atoms";
import { ClassifyCard } from "./classify-card";
import { ExtractCard } from "./extract-card";
import { ThinkingCard } from "./thinking-card";
import { RulesCard } from "./rules-card";
import { BuffersCard } from "./buffers-card";
import { FinalPromptCard } from "./final-prompt-card";
import { ImageCard } from "./image-card";

export function OutputRegion() {
  const r = useAtomValue(rewriteResultAtom);
  const running = useAtomValue(isRunningAtom);
  const error = useAtomValue(runErrorAtom);

  if (!r && !running && !error) {
    return (
      <section className="py-16 text-center">
        <p className="font-serif text-[17px] leading-[1.6] text-stone-gray">
          在上方粘 query 试试。每一步判断都会出现在这里。
        </p>
      </section>
    );
  }

  // 只要在跑 or 已经有任何 partial/结果,就渲染全部 6 张卡,
  // 每张卡自己决定显示 skeleton 还是真实内容。
  return (
    <div className="space-y-5">
      <ClassifyCard />
      <ExtractCard />
      <ThinkingCard />
      <RulesCard />
      <BuffersCard />
      <FinalPromptCard />
      <ImageCard />
    </div>
  );
}
