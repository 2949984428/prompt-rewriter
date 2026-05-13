// prompt-rewriter/lib/pipeline/steps/index.ts
//
// 把 5 个 step 拼成 pipeline definition。POST handler 直接拿这个跑 runPipeline。

import { definePipeline } from "@/lib/pipeline/types";
import type { PipelineCtx } from "./types";
import { stepSearchIntent } from "./step-search-intent";
import { stepStrategyPack } from "./step-strategy-pack";
import { stepCreationPlanner } from "./step-creation-planner";
import { stepMediaReview } from "./step-media-review";
import { stepGenerateMedia } from "./step-generate-media";

// 顺序(2026-05-13 调整):CreationPlanner 提到 StrategyPack 之前 —— 它跟 StrategyPack
// 都只依赖 step1.intent(互不依赖),前置 CreationPlanner 让用户视角的 step2 成为
// "拆 N 个 function call 草稿" 这个有意义的环节,而非内部数据加载。
export const pipelineDefinition = definePipeline<PipelineCtx>({
  id: "labs.pipeline.main",
  steps: [
    stepSearchIntent,
    stepCreationPlanner,
    stepStrategyPack,
    stepMediaReview,
    stepGenerateMedia,
  ],
});

export type { PipelineCtx };
