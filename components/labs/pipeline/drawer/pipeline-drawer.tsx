// prompt-rewriter/components/labs/pipeline/drawer/pipeline-drawer.tsx
//
// Phase 2 后的 Pipeline lab 设置抽屉:两级 tab(跟旧 UI 同款交互)。
//
//   一级 tab:SP1 · 意图分类 / SP2 · 改写
//   SP2 下的二级 tab:改写 SP / 策略库
//
// SP1 / SP2 改写 SP 用 VersionedEditor(版本管理 UI 在顶部 header)。
// 策略库走老的 vertical 驱动 master/detail 组件 PipelineStrategyVerticalEditor:
//   - 顶部 vertical chip(电商/品牌/社媒/其他),驱动下方 standards + 该 vertical 下的 platforms
//   - 两个 section 折叠 + 按行编辑 textarea + MdViewSwitcher 预览即注入 markdown
//   - **每个 section 展开区顶部各带一行版本切换条**(VersionToolbar),分别管 vertical-standard / platform-tone 两个 namespace
//   - 数据源走 Registry CRUD(useVersionedNamespace hook),写盘到当前 viewingId
//
// 三个编辑器组件都自包含 bootstrap,drawer 不需要顶层 prefetch。

"use client";

import { useAtom } from "jotai";
import {
  pipelineDrawerOpenAtom,
  pipelineDrawerMainTabAtom,
  pipelineSp2SubTabAtom,
  type PipelineDrawerMainTab,
  type PipelineSp2SubTab,
} from "@/lib/atoms-pipeline";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Sp1Editor } from "./sp1-editor";
import { Sp2Editor } from "./sp2-editor";
import { PipelineStrategyVerticalEditor } from "./pipeline-strategy-vertical-editor";
import { CreationPlannerEditor } from "./creation-planner-editor";
import { InfoIcon } from "@/components/labs/pipeline/info-icon";
import { TooltipProvider } from "@/components/ui/tooltip";

const MAIN_TABS: { id: PipelineDrawerMainTab; label: string }[] = [
  { id: "sp1", label: "SP1 · 意图分类" },
  { id: "sp2", label: "SP2 · 改写" },
];

const SP2_SUB_TABS: {
  id: PipelineSp2SubTab;
  label: string;
  sublabel: string;
}[] = [
  { id: "rewrite", label: "改写 SP", sublabel: "media_prompt_review" },
  {
    id: "strategy",
    label: "策略库",
    sublabel: "vertical 驱动 · 垂类标准 + 平台调性",
  },
  {
    id: "planner",
    label: "Creation Planner",
    sublabel: "Gemini 3 拆 function_call + size 启发式",
  },
];

export function PipelineDrawer() {
  const [open, setOpen] = useAtom(pipelineDrawerOpenAtom);
  const [mainTab, setMainTab] = useAtom(pipelineDrawerMainTabAtom);
  const [sp2Sub, setSp2Sub] = useAtom(pipelineSp2SubTabAtom);

  return (
    <Sheet open={open} onOpenChange={(v) => setOpen(v)}>
      <SheetContent
        side="right"
        className="flex flex-col border-l-border-cream bg-ivory p-0 data-[side=right]:w-[min(820px,96vw)] data-[side=right]:sm:max-w-none"
      >
        <TooltipProvider delay={150}>
          <SheetHeader className="shrink-0 border-b border-border-cream px-8 py-5">
            <div className="flex items-center gap-1.5">
              <SheetTitle className="font-serif text-[22px] font-medium text-near-black">
                Pipeline 配置
              </SheetTitle>
              <InfoIcon hint="改这里的 SP / 策略库会立刻对下一轮 pipeline 跑批生效,无需重启。三个 tab 各自带版本管理:SP1 / SP2 改写 SP 在顶部 header 里切版本,策略库在折叠展开区顶部切版本(vertical-standard / platform-tone 各一组)。" />
            </div>
          </SheetHeader>

          {/* 一级 tab:SP1 / SP2 —— 下划线风,跟旧 UI 同款 */}
          <div className="flex shrink-0 items-center gap-6 border-b border-border-cream px-8">
            {MAIN_TABS.map((t) => {
              const active = t.id === mainTab;
              return (
                <button
                  key={t.id}
                  onClick={() => setMainTab(t.id)}
                  className={`-mb-px whitespace-nowrap border-b-2 py-4 text-[14px] font-medium transition ${
                    active
                      ? "border-terracotta text-near-black"
                      : "border-transparent text-olive-gray hover:text-near-black"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* 二级 tab(只在 SP2 下展示):改写 SP / 策略库 */}
          {mainTab === "sp2" && (
            <div className="flex shrink-0 items-center gap-2 border-b border-border-cream bg-parchment/40 px-8 py-2.5">
              {SP2_SUB_TABS.map((t) => {
                const active = t.id === sp2Sub;
                return (
                  <button
                    key={t.id}
                    onClick={() => setSp2Sub(t.id)}
                    className={`flex flex-col items-start rounded-md px-3 py-1.5 text-left transition ${
                      active
                        ? "bg-warm-sand text-near-black shadow-ring"
                        : "text-olive-gray hover:bg-warm-sand/40 hover:text-near-black"
                    }`}
                  >
                    <span className="text-[13px] font-medium leading-tight">
                      {t.label}
                    </span>
                    <span className="font-mono text-[10.5px] leading-tight text-stone-gray">
                      {t.sublabel}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {mainTab === "sp1" ? (
              <Sp1Editor />
            ) : sp2Sub === "rewrite" ? (
              <Sp2Editor />
            ) : sp2Sub === "planner" ? (
              <CreationPlannerEditor />
            ) : (
              <PipelineStrategyVerticalEditor />
            )}
          </div>
        </TooltipProvider>
      </SheetContent>
    </Sheet>
  );
}
