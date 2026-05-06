// prompt-rewriter/components/output/final-prompt-card.tsx
//
// final_prompt 和 gpt-image-2 原生请求体同构:{ prompt, size, quality, n, output_format }。
// 这个卡片只做两件事:
//   1) 把 prompt 字段当成一整段自然语言文本展示,可复制
//   2) 把其他 4 个 API 参数用 chip 展示出来
// annotated / 编辑预览切换 已经去掉 —— 推导链路由 analysis 阶段的几张卡展示。

"use client";

import { useState } from "react";
import { useAtomValue } from "jotai";
import { Copy, Check } from "lucide-react";
import { rewriteResultAtom } from "@/lib/atoms";
import { CardShell } from "./card-shell";
import { SkeletonBars, WaitingHint } from "./card-skeleton";

export function FinalPromptCard() {
  const r = useAtomValue(rewriteResultAtom);
  const [copied, setCopied] = useState(false);

  const fp = r?.final_prompt;
  const promptText = typeof fp?.prompt === "string" ? fp.prompt : "";
  const hasPrompt = promptText.length > 0;

  if (!hasPrompt) {
    return (
      <CardShell
        title="⑥ 要发给模型的完整 Prompt"
        subtitle="前 5 步结论整合为 gpt-image-2 能直接执行的 prompt 文本 + API 参数"
        index={5}
        accent="terracotta"
      >
        <WaitingHint label="AI 正在把前 5 步整合成 gpt-image-2 能吃的 prompt…" />
        <SkeletonBars rows={5} />
      </CardShell>
    );
  }

  const copy = async () => {
    await navigator.clipboard.writeText(promptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <CardShell
      title="⑥ 要发给模型的完整 Prompt"
      subtitle="前 5 步结论整合为 gpt-image-2 能直接执行的 prompt 文本 + API 参数 · 点击右上复制"
      index={5}
      accent="terracotta"
    >
      <div className="mb-4 flex items-center justify-end">
        <button
          onClick={copy}
          className={`flex h-9 items-center gap-1.5 rounded-sm px-3 text-[14px] font-medium shadow-ring transition ${
            copied
              ? "bg-coral-soft-bg text-terracotta"
              : "bg-warm-sand text-charcoal-warm hover:shadow-ring-prom"
          }`}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "已复制 ✓" : "复制 prompt"}
        </button>
      </div>

      <div className="rounded-md bg-ivory p-6 shadow-ring">
        <p className="whitespace-pre-wrap font-sans text-[16px] leading-[1.7] text-near-black">
          {promptText}
        </p>
      </div>

      <div className="mt-4 rounded-md border border-border-cream bg-parchment p-4">
        <p className="mb-2 font-mono text-[12px] text-stone-gray">
          🖼️ 调 gpt-image-2 的 API 参数 · 这 4 个值会和上面的 prompt 一起发给 /v1/images/generations
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-[13px]">
          <ParamChip label="size" value={fp?.size ?? "auto"} />
          <ParamChip label="quality" value={fp?.quality ?? "medium"} />
          <ParamChip label="n" value={String(fp?.n ?? 1)} />
          <ParamChip label="output_format" value={fp?.output_format ?? "png"} />
        </div>
      </div>
    </CardShell>
  );
}

function ParamChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-stone-gray">{label}:</span>
      <span className="rounded bg-ivory px-1.5 py-0.5 text-near-black">
        {value}
      </span>
    </span>
  );
}
