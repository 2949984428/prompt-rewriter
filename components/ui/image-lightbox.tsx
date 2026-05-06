// prompt-rewriter/components/ui/image-lightbox.tsx
//
// 通用图片 lightbox(全屏大图预览),受控组件。
// 用途:产物图卡片点击后弹出大图,而不是直接跳转新标签。
//
// 交互:
//   - src 非空 → 全屏遮罩 + 居中等比缩放大图
//   - ESC / 点击遮罩 / 点击右上 ✕ → onClose
//   - 右下"在新标签页打开 ↗"次级动作:保留"想看原文件"的能力,
//     但不再是默认行为(默认是查看,不是离开)
//
// 不做:多张轮播 / 缩放 / 拖拽。stone-cold 简单 modal,够用就好。

"use client";

import { useEffect, useState } from "react";
import { X, ExternalLink, ImageDown, Check, AlertTriangle } from "lucide-react";
import { copyImageToClipboard } from "@/lib/copy-image";

export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string | null;
  alt?: string;
  onClose: () => void;
}) {
  const [copyState, setCopyState] = useState<
    "idle" | "copying" | "copied" | "error"
  >("idle");
  const [copyErr, setCopyErr] = useState<string | null>(null);

  // 切到新图时重置复制状态
  useEffect(() => {
    setCopyState("idle");
    setCopyErr(null);
  }, [src]);

  const onCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!src || copyState === "copying") return;
    setCopyState("copying");
    setCopyErr(null);
    try {
      await copyImageToClipboard(src);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1600);
    } catch (err) {
      setCopyState("error");
      setCopyErr(err instanceof Error ? err.message : String(err));
      setTimeout(() => setCopyState("idle"), 2400);
    }
  };

  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // 锁滚动:lightbox 打开期间禁止背景滚
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [src, onClose]);

  if (!src) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-near-black/85 p-6 backdrop-blur-sm"
    >
      {/* 关闭按钮 */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        title="关闭(ESC)"
        className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-ivory/90 text-near-black shadow-ring-prom transition hover:bg-ivory"
      >
        <X size={18} />
      </button>

      {/* 操作条:复制图(主) + 在新标签页打开(次级)。stopPropagation 防止触发遮罩关闭 */}
      <div className="absolute bottom-5 right-5 flex items-center gap-2">
        <button
          type="button"
          onClick={onCopy}
          disabled={copyState === "copying"}
          title={copyErr ?? "把图片像素复制到剪贴板,可粘贴到 Finder / 微信 / Slack"}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-mono text-[12px] shadow-ring-prom transition disabled:cursor-wait ${
            copyState === "copied"
              ? "bg-warm-gold-fg text-ivory"
              : copyState === "error"
                ? "bg-error-crimson text-ivory"
                : "bg-ivory/90 text-charcoal-warm hover:bg-ivory"
          }`}
        >
          {copyState === "copied" ? (
            <>
              <Check size={12} /> 已复制
            </>
          ) : copyState === "error" ? (
            <>
              <AlertTriangle size={12} /> 失败
            </>
          ) : copyState === "copying" ? (
            <>
              <ImageDown size={12} /> 复制中…
            </>
          ) : (
            <>
              <ImageDown size={12} /> 复制图
            </>
          )}
        </button>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1.5 rounded-md bg-ivory/90 px-3 py-1.5 font-mono text-[12px] text-charcoal-warm shadow-ring-prom transition hover:bg-ivory"
        >
          <ExternalLink size={12} />
          在新标签页打开
        </a>
      </div>

      {/* 大图本身。stopPropagation 防止点图自己也关掉 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt ?? ""}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] max-w-[92vw] rounded-md object-contain shadow-2xl"
      />
    </div>
  );
}
