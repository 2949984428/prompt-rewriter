// prompt-rewriter/lib/pipeline/steps/types.ts
//
// Pipeline 5 个 step 共享的 ctx 形状。每个 step 写自己负责的那个顶层字段,
// 互不重叠(浅合并的最佳实践)。

import type { SearchIntent, MediaPromptReviewResult } from "@/lib/pipeline/schema-shared";

export interface PipelineCtx {
  // ─── 入参(POST handler build initialCtx 时填好) ───
  query: string;
  searchModel?: string;
  reviewModel?: string;
  imageModel: string;
  referenceImages: string[];
  functionCallCount: number;
  doGenerate: boolean;
  // 2026-05-13 加:勾选后跟 reviewed 并发跑直生图(用 planner 原始 prompt),emit direct_* phase
  alsoRunDirect: boolean;
  startTotal: number;

  // ─── 各 step 产物 ───
  step1?: {
    intent: SearchIntent | null;
    raw: string;
    error?: string;
  };
  strategyPack?: {
    vertical_standard: { vertical: string; label?: string; standards: string[] };
    platform_tone: { platform: string; label?: string; tone: string[] };
  };
  creationPlanner?: {
    // size 由 CreationPlanner LLM 推理(参考 F11-direct-api 启发式),
    // SP2 不感知 size(reviewed schema 不带),stepGenerateMedia 按 id 反查这里拿
    function_calls: Array<{ id: string; prompt: string; size: string }>;
  };
  step2?: {
    result: MediaPromptReviewResult | null;
    raw: string;
    composed_system?: string;
    error?: string;
  };

  // Phase 2 · Registry 整合后由 step-strategy-pack(等)写入,
  // Phase 3a · ExperimentRecord 在 done phase 之前从这里读 config_snapshot.strategy_versions
  // 字段名跟现网代码字段保持一致(vertical / platform 而非 plan 的 L1 / L2)
  strategyVersions?: Record<string, string>;
}

// 共用:有参考图时给 LLM 的 user text 加一段映射说明,
// 让 query 里的 `[@image:#N:label]` 占位符跟下方 image_url[] 顺序一一对应
export function buildRefImagesMapping(refs: string[]): string {
  if (refs.length === 0) return "";
  const lines = refs.map(
    (_, i) =>
      `- 第 ${i + 1} 张参考图 = query 文本里的 [@image:#${i + 1}:...] 占位符`,
  );
  return [
    `## 参考图 (${refs.length} 张,按顺序附在本消息后)`,
    "",
    ...lines,
    "",
    "请基于图内容理解用户意图(细节描述以图为准,不要凭空发明)。",
  ].join("\n");
}
