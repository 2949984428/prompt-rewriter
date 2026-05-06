// prompt-rewriter/components/labs/rewrite/lab.tsx
//
// 垂类实验台主区(lab_id 仍是 "rewrite",显示名改为"垂类实验台")。
// 历史轮次侧栏已退役 —— 顶栏「🕘 全局历史」已经覆盖跨实验台的查看,
// 不再在主区占视觉重心,主区让给输入框 + 7 步产出区。

"use client";

import { InputBar } from "@/components/input-bar";
import { OutputRegion } from "@/components/output/output-region";
import { LlmModelSwitcher } from "@/components/llm-model-switcher";

export function RewriteLab() {
  return (
    <div className="min-w-0 flex-1 space-y-8">
      <header className="flex items-start justify-between gap-6">
        <div>
          <h1 className="font-serif text-[32px] font-medium leading-[1.2] text-near-black">
            垂类实验台
          </h1>
          <p className="mt-3 max-w-[640px] text-[16px] leading-[1.6] text-olive-gray">
            把粗糙的图像 query 写成专业 prompt。分类 / 补缺 / 调用 AI 训练知识 /
            命中硬约束 —— 7 步流式产出, baseline vs optimized 双图对照。
          </p>
        </div>
        <div className="shrink-0 pt-2">
          <LlmModelSwitcher />
        </div>
      </header>
      <div className="space-y-16">
        <InputBar />
        <OutputRegion />
      </div>
    </div>
  );
}
