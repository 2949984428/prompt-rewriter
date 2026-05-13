// prompt-rewriter/components/labs/pipeline/types.ts
//
// Pipeline lab 共享类型:从 lab.tsx 抽出,Experiments 详情页也复用同一份。
// NDJSON 事件 phase / data 字段集见后端 vfs.md(2026-05-12),前端只消费其中已知的几个 phase。

export type SearchIntent = {
  has_search_intent: "yes" | "no";
  search_type: string;
  intent_confidence: "strong" | "medium" | "weak";
  vertical: "ecommerce" | "brand" | "social" | "other";
  platform: string;
};

export type Reviewed = { id: string; prompt: string };

export type Generation = {
  id: string;
  prompt: string;
  image_urls: string[];
  error: string | null;
  elapsed_ms: number;
  // 重试相关(跟 batch lab 对齐)
  status?: "retrying" | "done" | "failed";
  attempt?: number;
  max_attempts?: number;
  last_error?: string | null;
  attempts?: number;          // 终态时记总共试了几次
  manual_retry?: boolean;     // 是不是用户主动点的重试
  // 2026-05-12 加:CreationPlanner 推的 size,handleStreamPhase 从 step3_item / step3_item_progress 透传
  // 用于:1) 生图卡片显示 size chip 2) 手动 retry 时透传到 /retry-image
  size?: string;
};

// Phase 1 加,每个 step 跑批轨迹(done 事件 data.trace 携带)
export type TraceEntry = {
  step: string;
  ms: number;
  status: "ok" | "failed" | "skipped";
  attempts: number;
  error?: string;
};

// Phase 2 加,4 个 namespace 当时跑批用的版本号
// done 事件 data.strategy_versions 携带,key 见后端 vfs.md(sp1 / sp2 / vertical / platform)
export type StrategyVersions = Record<string, string>;

export type PipelineResponse = {
  query: string;
  step1: {
    search_intent: SearchIntent | null;
    raw: string;
    error?: string;
    elapsed_ms: number;
    llm_model?: string | null;
    sp_version?: string;                      // Phase 2 加
  };
  creation_planner: {
    // 2026-05-12 升级:CreationPlanner 从 mock 改成 LLM 调用,新增 size 字段
    function_calls: Array<{ id: string; prompt: string; size?: string }>;
    elapsed_ms: number;
    llm_model?: string | null;                  // Phase 升级加
    sp_version?: string;                        // Phase 升级加
    fallback?: string | null;                   // LLM 失败时 fallback 到 mock,这里记原因
  };
  strategy_pack: {
    vertical_standard: { vertical: string; label?: string; standards: string[] };
    platform_tone: { platform: string; label?: string; tone: string[] };
    elapsed_ms: number;
    versions?: { vertical: string; platform: string };  // Phase 2 加
  };
  step2: {
    review_result: { reviewed: Reviewed[] } | null;
    raw: string;
    composed_system?: string;
    error?: string;
    elapsed_ms: number;
    llm_model?: string | null;
    sp_version?: string;                      // Phase 2 加
  };
  step3: {
    generations: Generation[];
    elapsed_ms: number;
    skipped: boolean;
    image_model?: string | null;
  };
  // 2026-05-13 加:API 直出对比通道(用 CreationPlanner 原始 prompt 跳过 SP2 直生图)
  // 由独立 POST /api/labs/pipeline/direct-generate 触发,NDJSON phase 命名 direct_*
  step3_direct?: {
    generations: Generation[];
    elapsed_ms: number;
    image_model?: string | null;
  };
  total_elapsed_ms: number;
  trace?: TraceEntry[];                       // Phase 1 加,done 事件携带
  strategy_versions?: StrategyVersions;       // Phase 2 加,done 事件携带
  experiment_id?: string;                     // P3a 加,experiment_saved 事件携带
};
