// prompt-rewriter/lib/experiments/build.ts
//
// 把不同测试台的跑批结果统一构造成 ExperimentRecord,落到 Experiments 平台。
//
// 4 种 source kind:
//   - pipeline_lab     —— PipelineLab 单 query(已在 app/api/labs/pipeline/route.ts 直接 build)
//   - batch_skill      —— Skill 批量测试台 1 个 BatchRun
//   - batch_pipeline   —— Pipeline 测试台 1 个 BatchRun(cell.pipeline_outputs 已含完整 trace)
//   - format           —— API 测试台单次 query × M skill(没生图)
//
// 落盘时 image_urls 已经是 /api/image-file/<sha> 本地缓存路径(batch-runner / runFormatOne 保证)。

import { randomUUID } from "node:crypto";
import type {
  BatchRunRecord,
  ExperimentRecord,
  ExperimentSourceKind,
} from "@/lib/schema";

export function newExperimentId(): string {
  return `exp_${randomUUID()}`;
}

/** Skill 批量测试台 BatchRun → ExperimentRecord */
export function buildFromBatchSkillRun(
  run: BatchRunRecord,
): ExperimentRecord {
  const cellsLite = run.cells.map((c) => ({
    query_idx: c.query_idx,
    skill_id: c.skill_id,
    image_model: c.image_model,
    status: c.status,
    final_prompt: c.final_prompt,
    image_urls: c.image_urls,
    error: c.error,
  }));
  return {
    id: newExperimentId(),
    ts: new Date(run.created_at).getTime(),
    pipeline_id: "(skill)",
    source: {
      kind: "batch_skill",
      run_id: run.id,
      run_meta: {
        name: run.name,
        n_queries: run.queries.length,
        n_skills: run.skill_ids.length,
        skill_ids: run.skill_ids,
        image_models: run.image_model_ids.length > 0 ? run.image_model_ids : [run.image_model],
        n_cells: run.cells.length,
        status: run.status,
      },
    },
    inputs: {
      query: run.queries.length === 1 ? run.queries[0] : `${run.queries.length} queries × ${run.skill_ids.length} skills`,
      queries: run.queries,
      function_call_count: 1,
    },
    config_snapshot: {
      strategy_versions: {},
      models: {
        search: run.rewrite_llm,
        review: run.rewrite_llm,
        image: run.image_model,
      },
    },
    output: {
      queries: run.queries,
      cells: cellsLite,
      skill_ids: run.skill_ids,
      scoring_dimensions: run.scoring_dimensions,
    },
    trace: [],
    tags: [],
    metadata: { author: "", note: "" },
    status: "finished",
  };
}

/** Pipeline 测试台 BatchRun → ExperimentRecord(每个 cell 自带完整 pipeline_outputs) */
export function buildFromBatchPipelineRun(
  run: BatchRunRecord,
): ExperimentRecord {
  const cellsLite = run.cells.map((c) => ({
    query_idx: c.query_idx,
    pipeline_id: c.pipeline_id,
    image_model: c.image_model,
    status: c.status,
    image_urls: c.image_urls,
    pipeline_outputs: c.pipeline_outputs,  // 含 step1/step2/strategy_pack/creation_planner/generations/trace
    error: c.error,
  }));
  return {
    id: newExperimentId(),
    ts: new Date(run.created_at).getTime(),
    pipeline_id: run.pipeline_ids[0] ?? "vertical_prompt_rewrite_v1",
    source: {
      kind: "batch_pipeline",
      run_id: run.id,
      run_meta: {
        name: run.name,
        n_queries: run.queries.length,
        n_pipelines: run.pipeline_ids.length,
        pipeline_ids: run.pipeline_ids,
        n_cells: run.cells.length,
        status: run.status,
      },
    },
    inputs: {
      query: run.queries.length === 1 ? run.queries[0] : `${run.queries.length} queries × ${run.pipeline_ids.length} pipelines`,
      queries: run.queries,
      function_call_count: 1,
    },
    config_snapshot: {
      strategy_versions: {},
      models: {
        search: "(pipeline 默认)",
        review: "(pipeline 默认)",
        image: "(pipeline 默认)",
      },
    },
    output: {
      queries: run.queries,
      cells: cellsLite,
      pipeline_ids: run.pipeline_ids,
      scoring_dimensions: run.scoring_dimensions,
    },
    trace: [],
    tags: [],
    metadata: { author: "", note: "" },
    status: "finished",
  };
}

/** API 测试台一次 query × M skill 跑批 → ExperimentRecord */
export function buildFromFormatRun(args: {
  query: string;
  skill_ids: string[];
  llm_model: string;
  include_universal: boolean;
  runs: Array<{
    format_id: string;
    format_label: string;
    final_prompt: unknown;
    error: string | null;
    raw: string;
    ms?: number;
  }>;
}): ExperimentRecord {
  return {
    id: newExperimentId(),
    ts: Date.now(),
    pipeline_id: "(format)",
    source: {
      kind: "format",
      run_id: "",
      run_meta: {
        skill_ids: args.skill_ids,
        include_universal: args.include_universal,
        n_runs: args.runs.length,
      },
    },
    inputs: {
      query: args.query,
      skill_ids: args.skill_ids,
      function_call_count: 1,
    },
    config_snapshot: {
      strategy_versions: {},
      models: {
        search: args.llm_model,
        review: args.llm_model,
        image: "",
      },
    },
    output: {
      runs: args.runs,
    },
    trace: [],
    tags: [],
    metadata: { author: "", note: "" },
    status: "finished",
  };
}

/** 统一构造 helper(给调用方按 kind 分流) */
export function buildExperimentRecord(
  kind: ExperimentSourceKind,
  ...args: unknown[]
): ExperimentRecord {
  if (kind === "batch_skill") return buildFromBatchSkillRun(args[0] as BatchRunRecord);
  if (kind === "batch_pipeline") return buildFromBatchPipelineRun(args[0] as BatchRunRecord);
  if (kind === "format") return buildFromFormatRun(args[0] as Parameters<typeof buildFromFormatRun>[0]);
  throw new Error(`buildExperimentRecord 不支持 kind=${kind}(pipeline_lab 走 app/api/labs/pipeline/route.ts 内联 build)`);
}
