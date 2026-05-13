// prompt-rewriter/components/labs/pipeline/info-icon.tsx
//
// Pipeline 页面通用的「问号」icon · 悬停展示注释。
// 用 base-ui Tooltip,Portal 渲染所以不会被 Sheet / overflow 截断。
// 调用方要在某个父级包一层 <TooltipProvider delay={150}>。

"use client";

import { HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function InfoIcon({
  hint,
  side = "top",
}: {
  hint: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="inline-flex h-4 w-4 cursor-help items-center justify-center text-stone-gray transition hover:text-near-black"
            aria-label="说明"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <HelpCircle size={13} strokeWidth={1.75} />
          </span>
        }
      />
      <TooltipContent
        side={side}
        className="max-w-sm whitespace-normal leading-relaxed"
      >
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}
