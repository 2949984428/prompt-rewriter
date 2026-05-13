// prompt-rewriter/components/top-nav.tsx
"use client";

import { Settings, Clock } from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import { drawerOpenAtom, drawerTabAtom } from "@/lib/atoms";
import {
  currentLabAtom,
  formatDrawerOpenAtom,
  formatDrawerTabAtom,
} from "@/lib/atoms-format";
import { globalHistoryOpenAtom } from "@/lib/atoms-history-index";
import {
  pipelineDrawerOpenAtom,
  pipelineDrawerMainTabAtom,
} from "@/lib/atoms-pipeline";

export function TopNav() {
  const lab = useAtomValue(currentLabAtom);
  const setRewriteOpen = useSetAtom(drawerOpenAtom);
  const setRewriteTab = useSetAtom(drawerTabAtom);
  const setFormatOpen = useSetAtom(formatDrawerOpenAtom);
  const setFormatTab = useSetAtom(formatDrawerTabAtom);
  const setPipelineOpen = useSetAtom(pipelineDrawerOpenAtom);
  const setPipelineMainTab = useSetAtom(pipelineDrawerMainTabAtom);
  const setGlobalHistoryOpen = useSetAtom(globalHistoryOpenAtom);

  // 设置按钮 lab-aware:
  // - rewrite lab → rewrite drawer (4 tab:总说明书/目标模型画像/硬约束铁律/垂类小抄)
  // - format / batch lab → format drawer (3 tab:skill 编辑/历史/累积报告) — 这两 lab 共用 skill 池
  // - pipeline lab → pipeline drawer (4 tab:SP1 意图分类/SP2 改写/垂类标准/平台调性)
  const openSettings = () => {
    if (lab === "format" || lab === "batch") {
      setFormatTab("skill");
      setFormatOpen(true);
    } else if (lab === "pipeline") {
      setPipelineMainTab("sp1");
      setPipelineOpen(true);
    } else {
      setRewriteTab("skill");
      setRewriteOpen(true);
    }
  };

  return (
    <nav className="fixed inset-x-0 top-0 z-20 border-b border-border-cream bg-parchment">
      {/* 真·顶部固定栏:全宽贴 viewport 顶,z-20 压过左侧 sidebar(z-10),
         logo 贴左(对齐下方 fixed sidebar 内容左缘),设置按钮贴右。 */}
      <div className="flex h-16 items-center justify-between pl-7 pr-5">
        <div className="flex items-center gap-2">
          {/* Coral 小方块当 favicon-like brand mark,加平台辨识度 */}
          <span
            aria-hidden
            className="inline-block h-5 w-5 rounded-sm bg-terracotta"
          />
          <span className="font-serif text-[26px] font-medium leading-none tracking-tight text-near-black">
            Prompt Rewriter
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* 全局历史入口:跨实验台的索引视图,可按 lab 筛选 */}
          <NavBtn
            icon={<Clock size={16} />}
            label="全局历史"
            onClick={() => setGlobalHistoryOpen(true)}
          />
          <NavBtn icon={<Settings size={16} />} label="设置" onClick={openSettings} />
        </div>
      </div>
    </nav>
  );
}

function NavBtn({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex h-9 items-center gap-1.5 rounded-sm bg-warm-sand pl-2 pr-3 text-[14px] font-medium text-charcoal-warm shadow-ring transition hover:shadow-ring-prom"
    >
      {icon}
      {label}
    </button>
  );
}
