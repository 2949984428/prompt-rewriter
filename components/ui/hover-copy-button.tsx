// prompt-rewriter/components/ui/hover-copy-button.tsx
//
// 图片容器右上角的悬浮"复制图"按钮:hover 父容器时浮现,点击复制图片像素到剪贴板。
//
// 用法:
//   <div className="group relative">
//     <img src={url} ... />
//     <HoverCopyButton src={url} />
//   </div>
//
// 父容器需要 `group relative`(让 group-hover 选择器 + absolute 定位生效)。

"use client";

import { useState } from "react";
import { ImageDown, Check, AlertTriangle } from "lucide-react";
import { copyImageToClipboard } from "@/lib/copy-image";

export function HoverCopyButton({
  src,
  className = "",
}: {
  src: string;
  /** 额外类名(比如调整定位:默认 right-2 top-2) */
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copying" | "copied" | "error">(
    "idle",
  );
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (state === "copying") return;
    setState("copying");
    setErrMsg(null);
    try {
      await copyImageToClipboard(src);
      setState("copied");
      setTimeout(() => setState("idle"), 1600);
    } catch (err) {
      setState("error");
      setErrMsg(err instanceof Error ? err.message : String(err));
      setTimeout(() => setState("idle"), 2400);
    }
  };

  const Icon =
    state === "copied" ? Check : state === "error" ? AlertTriangle : ImageDown;
  const tone =
    state === "copied"
      ? "bg-warm-gold-fg text-ivory"
      : state === "error"
        ? "bg-error-crimson text-ivory"
        : "bg-ivory/95 text-charcoal-warm hover:bg-ivory";
  const title =
    state === "copied"
      ? "已复制"
      : state === "error"
        ? `失败:${errMsg ?? "未知错误"}`
        : "复制图片到剪贴板";

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-md opacity-0 shadow-ring-prom transition group-hover:opacity-100 disabled:cursor-wait ${tone} ${className}`}
      disabled={state === "copying"}
    >
      <Icon size={13} />
    </button>
  );
}
