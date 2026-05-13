// prompt-rewriter/components/labs/pipeline-mgmt/lab.tsx
//
// Pipeline 管理 — 列出平台上所有 pipeline,点击卡片进入对应 pipeline 实验台。
// 当前(Phase 1)只有 1 个 pipeline:"垂类差异化实验"(原 Pipeline 三步)。
// 未来加新 pipeline 时,这里加 PIPELINES 数组一项 + 配置 lab id 即可。
//
// 点击卡片 → setCurrentLab("pipeline") 切到现 PipelineLab。
// Sidebar 的 isTabActive 有特殊 mapping:currentLab="pipeline" 时 "Pipeline 管理" 保持 active。

"use client";

import { useSetAtom } from "jotai";
import { currentLabAtom, type LabId } from "@/lib/atoms-format";

type PipelineMeta = {
  id: string;                       // pipeline 业务 id(写到 ExperimentRecord)
  name: string;                     // 显示名
  description: string;
  /** 点击卡片切到哪个 lab id(短期都是现有 PipelineLab) */
  target_lab: LabId;
  steps: string[];                  // 步骤列表(给卡片展示用)
  status: "live" | "experimental" | "deprecated";
};

const PIPELINES: PipelineMeta[] = [
  {
    id: "vertical_prompt_rewrite_v1",
    name: "垂类差异化实验",
    description:
      "线上 Lovart Creative Production Agent 的 prompt-rewrite 链路:意图分类 → 策略包注入 → CreationPlanner → SP2 改写 → 生图。是当前所有 prompt 改写策略的母版。",
    target_lab: "pipeline",
    steps: [
      "SP1 · 意图分类(L1/L2)",
      "策略包加载(vertical_standard + platform_tone)",
      "CreationPlanner(Gemini 3 推 N 个 function_call + size)",
      "SP2 · prompt 改写",
      "生图(per-cell size,minimax / openai 等)",
    ],
    status: "live",
  },
  // 未来:加新 pipeline 在这里追加。每个 pipeline 一个 lab,target_lab 指向对应 lab id。
];

export function PipelineMgmtLab() {
  const setCurrentLab = useSetAtom(currentLabAtom);

  return (
    <main className="min-h-[calc(100vh-64px)] bg-parchment px-8 py-10">
      <div className="mx-auto max-w-[1280px]">
        <header className="mb-6 border-b border-border-cream pb-5">
          <h1 className="font-serif text-[28px] font-medium leading-[1.2] text-near-black">
            Pipeline 管理
          </h1>
          <p className="mt-1 text-[13px] text-olive-gray">
            管理平台上所有 pipeline 实验链路。每个 pipeline 是一条对齐线上 agent 链路的端到端测试台,
            可在 Pipeline 测试台批量跑批,跑批记录落到 Experiments。
          </p>
        </header>

        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {PIPELINES.map((p) => (
            <li
              key={p.id}
              className="group cursor-pointer rounded-lg border border-border-cream bg-ivory p-5 transition hover:border-warm-sand-dark hover:shadow-ring"
              onClick={() => setCurrentLab(p.target_lab)}
            >
              <div className="mb-2 flex items-center gap-2">
                <h2 className="font-serif text-[18px] font-medium leading-tight text-near-black group-hover:text-terracotta">
                  {p.name}
                </h2>
                {p.status === "live" && (
                  <span className="rounded-md bg-emerald-100/60 px-2 py-0.5 font-mono text-[10.5px] text-emerald-700">
                    LIVE
                  </span>
                )}
                {p.status === "experimental" && (
                  <span className="rounded-md bg-warm-gold-bg px-2 py-0.5 font-mono text-[10.5px] text-warm-gold-fg">
                    EXPERIMENTAL
                  </span>
                )}
                {p.status === "deprecated" && (
                  <span className="rounded-md bg-stone-200 px-2 py-0.5 font-mono text-[10.5px] text-stone-600">
                    DEPRECATED
                  </span>
                )}
              </div>
              <p className="mb-3 text-[13px] leading-[1.5] text-olive-gray">
                {p.description}
              </p>

              <ol className="mb-4 space-y-0.5 text-[12px] text-olive-gray">
                {p.steps.map((s, i) => (
                  <li key={i} className="flex items-baseline gap-2">
                    <span className="font-mono text-[10.5px] text-stone-gray">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>

              <div className="flex items-center justify-between">
                <span className="font-mono text-[10.5px] text-stone-gray">
                  pipeline_id: {p.id}
                </span>
                <button
                  className="rounded-md bg-terracotta/10 px-3 py-1 text-[12px] font-medium text-terracotta group-hover:bg-terracotta group-hover:text-ivory"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCurrentLab(p.target_lab);
                  }}
                >
                  进入 →
                </button>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-8 text-[12px] text-stone-gray">
          要新增 pipeline,在
          <code className="mx-1.5 rounded bg-warm-sand/40 px-1.5 py-0.5 font-mono text-[11px]">
            components/labs/pipeline-mgmt/lab.tsx
          </code>
          的
          <code className="mx-1 font-mono">PIPELINES</code>
          数组追加一项,并配套实现对应 lab 组件。
        </p>
      </div>
    </main>
  );
}
