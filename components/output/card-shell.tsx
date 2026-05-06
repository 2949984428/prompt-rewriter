// prompt-rewriter/components/output/card-shell.tsx
"use client";

import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";

/**
 * 7 步工作流每一步对应一个 accent 色带,在卡片左侧 4px 彩条上呈现。
 * 颜色按语义选:起点 → 数据 → 思考 → 红线 → 增益 → 产出 → 结果。
 */
export type CardAccent =
  | "coral" // ① classify — 起点,鲜亮
  | "gold" // ② extract — 数据/标本
  | "olive" // ③ thinking — 思考,沉稳
  | "crimson" // ④ rules — 红线,警示
  | "silver" // ⑤ buffers — 可选增益
  | "terracotta" // ⑥ final_prompt — 压轴产出
  | "blue"; // ⑦ image — 最终结果

const ACCENT_BG: Record<CardAccent, string> = {
  coral: "bg-coral",
  gold: "bg-warm-gold-fg",
  olive: "bg-olive-gray",
  crimson: "bg-error-crimson",
  silver: "bg-warm-silver",
  terracotta: "bg-terracotta",
  blue: "bg-focus-blue",
};

export function CardShell({
  title,
  subtitle,
  index,
  accent,
  children,
  failed,
  showRaw,
}: {
  title: string;
  subtitle?: string;
  index: number;
  accent: CardAccent;
  children: React.ReactNode;
  failed?: boolean;
  showRaw?: () => void;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, delay: index * 0.08 }}
      className="relative overflow-hidden rounded-lg bg-ivory p-7 pl-9 shadow-ring transition-shadow hover:shadow-ring-prom"
    >
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-[4px] ${ACCENT_BG[accent]}`}
      />
      <header className="mb-5 flex items-start justify-between">
        <div>
          <h2 className="font-serif text-[25px] font-medium leading-[1.2] text-near-black">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-1 text-[14px] text-olive-gray">{subtitle}</p>
          )}
        </div>
        {failed && (
          <button
            onClick={showRaw}
            className="flex items-center gap-1 font-mono text-[13px] text-error-crimson hover:underline"
          >
            <AlertTriangle size={14} />
            输出不完整 [show raw]
          </button>
        )}
      </header>
      {children}
    </motion.section>
  );
}
