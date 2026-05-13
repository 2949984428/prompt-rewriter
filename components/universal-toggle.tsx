// prompt-rewriter/components/universal-toggle.tsx
//
// 跨 lab 共享的"在每条 skill 前注入通用规则 (_universal.md)" 开关 UI。
// 状态来自 includeUniversalDefaultAtom（localStorage 持久化），format / batch 两边
// 同时显示同步。

"use client";

import { useAtom } from "jotai";
import { includeUniversalDefaultAtom } from "@/lib/atoms-shared";

interface UniversalToggleProps {
  className?: string;
}

export function UniversalToggle({ className = "" }: UniversalToggleProps) {
  const [includeUniversal, setIncludeUniversal] = useAtom(
    includeUniversalDefaultAtom
  );
  return (
    <label
      className={`flex shrink-0 cursor-pointer items-center gap-2 rounded-md border border-border-cream bg-parchment/40 px-3 py-1.5 text-[12px] transition hover:border-border-warm ${className}`}
    >
      <input
        type="checkbox"
        checked={includeUniversal}
        onChange={(e) => setIncludeUniversal(e.target.checked)}
        className="h-3.5 w-3.5 accent-terracotta"
      />
      <span className="text-near-black">
        注入通用规则 (
        <code className="font-mono text-[11px]">_universal.md</code>)
      </span>
      <span className="text-[10.5px] text-stone-gray">· 跨实验台共享</span>
    </label>
  );
}
