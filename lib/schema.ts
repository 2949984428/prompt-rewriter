// prompt-rewriter/lib/schema.ts
import { z } from "zod";

// ───────────── 配置文件类型 ─────────────

export const HardRuleSchema = z.object({
  id: z.string(),
  title: z.string(),
  enabled: z.boolean(),
  trigger_keywords: z.array(z.string()).default([]),
  trigger_hint: z.string().optional().default(""),
  rule: z.string(),
  source_case: z.string().optional().default(""),
});
export type HardRule = z.infer<typeof HardRuleSchema>;

export const VerticalHintSchema = z.object({
  id: z.string(),
  match: z.string(),
  hint: z.string(),
});
export type VerticalHint = z.infer<typeof VerticalHintSchema>;

// 目标模型元数据:当前使用的 target_model, 决定加载哪个 model_profile
export const MetaSchema = z.object({
  target_model: z.string().min(1),
});
export type Meta = z.infer<typeof MetaSchema>;

// ───────────── Skill 版本化 ─────────────
// skill.md 不再是单一文件,而是 data/skills/<id>.md + data/skills/index.json。
// 每次改写跑的永远是 active 版本;用户可以并存多个版本用于对照 / 回退。
export const SkillVersionMetaSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9._-]*$/i, "id 只能是字母/数字/._- 且首字母非特殊符号"),
  label: z.string().min(1),
  notes: z.string().default(""),
  createdAt: z.string().default(""), // ISO 8601;允许空以兼容老数据
});
export type SkillVersionMeta = z.infer<typeof SkillVersionMetaSchema>;

export const SkillsIndexSchema = z.object({
  active: z.string().min(1),
  versions: z.array(SkillVersionMetaSchema).min(1),
});
export type SkillsIndex = z.infer<typeof SkillsIndexSchema>;

// ───────────── LLM 输出类型 ─────────────

export const ClassifyLevelSchema = z.object({
  level: z.number().int(),
  label: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()).default([]),
  alternatives_considered: z
    .array(z.object({ label: z.string(), rejected_because: z.string() }))
    .default([]),
});
export type ClassifyLevel = z.infer<typeof ClassifyLevelSchema>;

export const ExtractItemSchema = z.object({
  field: z.string(),
  value: z.string(),
  from: z.enum(["user_query", "ai_inferred", "gap"]),
  reason: z.string().optional().default(""),
});
export type ExtractItem = z.infer<typeof ExtractItemSchema>;

export const DomainThoughtSchema = z.object({
  trigger: z.string(),
  thought: z.string(),
  produces_phrases: z.array(z.string()).default([]),
});
export type DomainThought = z.infer<typeof DomainThoughtSchema>;

export const AppliedRuleSchema = z.object({
  rule_id: z.string(),
  hit: z.boolean(),
  triggered_by: z.string().optional().default(""),
  injection: z.string().optional().default(""),
  injection_location: z.enum(["head", "body", "tail"]).optional().default("tail"),
  skipped_because: z.string().optional().default(""),
});
export type AppliedRule = z.infer<typeof AppliedRuleSchema>;

export const BufferSchema = z.object({
  label: z.string(),
  picked: z.boolean(),
  reason: z.string(),
  phrases: z.array(z.string()).default([]),
});
export type Buffer = z.infer<typeof BufferSchema>;

// final_prompt 直接对齐 gpt-image-2 原生请求体字段。
// 设计原则:LLM 产出的结构 == 图像模型的入参结构,零变换、零歧义。
// - prompt: 要发给模型的完整自然语言 prompt,一整段,不拆结构。
//   (推导链路已经在 extract/classify/domain_thinking/buffers/applied_hard_rules 里展示,
//    这里不再重复标注 annotated。)
// - size/quality/n/output_format: 直接就是 gpt-image-2 的 API 字段名和合法值。
export const FinalPromptSchema = z.object({
  prompt: z.string(),
  size: z
    .enum([
      "1024x1024",
      "2048x2048",
      "1536x1024",
      "1024x1536",
      "1792x1008",
      "1008x1792",
      "1536x1152",
      "1152x1536",
      "auto",
    ])
    .optional()
    .default("auto"),
  quality: z
    .enum(["auto", "high", "medium", "low"])
    .optional()
    .default("medium"),
  n: z.number().int().min(1).max(10).optional().default(1),
  output_format: z
    .enum(["png", "jpeg", "webp"])
    .optional()
    .default("png"),
});
export type FinalPrompt = z.infer<typeof FinalPromptSchema>;

// ─── 两阶段 schema ─────────────────────────────────────────
//   阶段 1:AnalysisResult(5 步结构化思考,不含 final_prompt)
//   阶段 2:FinalPromptResult(只含 final_prompt,由 model profile 驱动合成)
//   对外暴露的完整产物仍然是 RewriteResult = AnalysisResult ∪ FinalPromptResult,
//   保持前端 / 历史记录 / atoms 的消费契约不变。
export const AnalysisResultSchema = z.object({
  classify: z.object({
    vertical_path: z.array(ClassifyLevelSchema),
    stop_reason: z.string().optional().default(""),
  }),
  extract: z.array(ExtractItemSchema),
  domain_thinking: z.array(DomainThoughtSchema),
  applied_hard_rules: z.array(AppliedRuleSchema),
  buffers: z.array(BufferSchema),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export const FinalPromptResultSchema = z.object({
  final_prompt: FinalPromptSchema,
});
export type FinalPromptResult = z.infer<typeof FinalPromptResultSchema>;

export const RewriteResultSchema = AnalysisResultSchema.extend({
  final_prompt: FinalPromptSchema,
});
export type RewriteResult = z.infer<typeof RewriteResultSchema>;

// ───────────── 生图结果快照(用于历史持久化) ─────────────
// 说明:
//   - atoms.ts 里的 ImageJobState 是"运行时状态"(含 idle/creating/polling 这些过渡态)
//   - 这里的 ImageJobRecordSchema 是"最终结果快照",只在 image-card 的 finishedAt 从 null 变非 null 时生成
//   - 两套不混用,防止 polling 中途的半成品污染历史

export const ImageVariantSchema = z.enum(["baseline", "optimized"]);
export type ImageVariant = z.infer<typeof ImageVariantSchema>;

export const ImageJobStatusSchema = z.enum([
  "idle",
  "creating",
  "polling",
  "completed",
  "failed",
]);
export type ImageJobStatus = z.infer<typeof ImageJobStatusSchema>;

export const ImageJobParamsSchema = z.object({
  size: z.string().optional(),
  quality: z.string().optional(),
  n: z.number().optional(),
  output_format: z.string().optional(),
});
export type ImageJobParams = z.infer<typeof ImageJobParamsSchema>;

export const ImageJobRecordSchema = z.object({
  variant: ImageVariantSchema,
  status: ImageJobStatusSchema,
  prompt: z.string().default(""),
  params: ImageJobParamsSchema.default({}),
  task_id: z.string().nullable().default(null),
  urls: z.array(z.string()).default([]),
  local_paths: z.array(z.string()).default([]),
  cost: z.number().nullable().default(null),
  started_at: z.number().nullable().default(null),
  finished_at: z.number().nullable().default(null),
  latency_ms: z.number().nullable().default(null),
  error: z.string().nullable().default(null),
});
export type ImageJobRecord = z.infer<typeof ImageJobRecordSchema>;

// ───────────── 单轮改写配置快照(用于归因) ─────────────
// 每次跑 query 时把当时的 skill / rules / hints / model 固化进历史,事后对比时能知道这条结果是哪版说明书跑出来的
export const ConfigSnapshotSchema = z.object({
  skill_id: z.string().default(""),
  skill_md_hash: z.string().default(""),
  hard_rules: z.array(HardRuleSchema).default([]),
  vertical_hints: z.array(VerticalHintSchema).default([]),
  model_profile_hash: z.string().default(""),
  target_model: z.string().default(""),
  // 驱动改写的 LLM 模型 id;"" = 用后端 env 默认
  rewrite_llm: z.string().default(""),
});
export type ConfigSnapshot = z.infer<typeof ConfigSnapshotSchema>;

// ───────────── 单条历史 ─────────────
// config_snapshot / image_jobs 是"后填"字段:前者跑完改写当下就落,后者要等生图异步回填
// 都设成 optional,老数据和中途状态都合法
//
// result 用 partial 而非严格 RewriteResultSchema:
//   - rewrite API 的 soft 策略:某些字段没通过严格 schema 校验时仍返回可渲染的 partial
//   - 历史是辅助分析工具,应该收容所有"真实跑过的轮次"(包括 schema 不全的),而不是只收黄金路径
//   - 消费端(history-sidebar / 各 card)已按 Partial<RewriteResult> 模式消费,天然兼容
export const HistoryItemSchema = z.object({
  id: z.string(),
  ts: z.number(),
  query: z.string(),
  result: RewriteResultSchema.partial(),
  config_snapshot: ConfigSnapshotSchema.optional(),
  // image_jobs 是"半填"容器:baseline / optimized 两路异步到齐,任意一路都可能暂不存在
  // 用 partial object 而非 z.record(enum, v),否则 infer 出的 Record<K,V> 会要求所有 key 都存在
  image_jobs: z
    .object({
      baseline: ImageJobRecordSchema.optional(),
      optimized: ImageJobRecordSchema.optional(),
    })
    .optional(),
});
export type HistoryItem = z.infer<typeof HistoryItemSchema>;

// ───────────── 批量测试台(/labs/batch) ─────────────
// 一次任务 = N 个 query × M 个 skill 的矩阵,跑完后人工打分 + 聚合排行榜。
// cell 是矩阵的最小单元;status 流转 pending → running → done|failed,
// 用户可主动改成 excluded(从排行榜剔除,但保留产物)。
//
// 设计上跟 FormatRunRecord 不复用,因为:
// 1) format lab 是 1 query × M skill,batch 是 N×M
// 2) batch 多了 scoring 维度,FormatRunRecord 没有
// 3) cell 状态机比 format run 更复杂(需要 excluded、需要中途 patch)
export const ScoringDimensionSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9._-]*$/i, "评分维度 id 仅允许字母/数字/._-"),
  label: z.string().min(1),
  description: z.string().default(""),
});
export type ScoringDimension = z.infer<typeof ScoringDimensionSchema>;

export const BatchCellStatusSchema = z.enum([
  "pending",
  "running",
  "done",
  "failed",
  "excluded",
]);
export type BatchCellStatus = z.infer<typeof BatchCellStatusSchema>;

// 评分对象:维度 id → 0-5 分(0 表示未评)
// 用 record 而不是数组,因为维度集合是 record 级别配置,cell 级别只关心键值。
export const BatchCellSchema = z.object({
  query_idx: z.number().int().min(0),
  skill_id: z.string().min(1),
  status: BatchCellStatusSchema,
  final_prompt: FinalPromptSchema.nullable().default(null),
  image_urls: z.array(z.string()).nullable().default(null),
  scores: z.record(z.string(), z.number().min(0).max(5)).default({}),
  note: z.string().default(""),
  error: z.string().nullable().default(null),
  raw: z.string().default(""),
  ms: z.number().default(0),
});
export type BatchCell = z.infer<typeof BatchCellSchema>;

export const BatchQueryModeSchema = z.enum([
  "derive", // LLM 从 purpose 派生 N 个 query
  "manual", // 用户自填 N 行 query
  "repeat", // 用户给 1 个 query,跑 N 次取方差
]);
export type BatchQueryMode = z.infer<typeof BatchQueryModeSchema>;

export const BatchRunStatusSchema = z.enum([
  "draft",
  "running",
  "finished",
  // 用户主动取消:语义上跟 finished 一样属于 terminal,但成因不同。
  // - cells 里所有未跑完的格子被 cancel 路由批量改为 status:"failed" + error:"用户已取消"
  // - SSE / 排行榜按"已 terminal"处理(等同 finished)
  // - 列表页 / detail header 用单独的 badge 文案区分,让 PM 能看出是手动停的
  "cancelled",
]);
export type BatchRunStatus = z.infer<typeof BatchRunStatusSchema>;

// 外部盲评结果:每 query 评审者认为最好的那一格(只选一个 winner,不打分,不分维度)。
// key = query_idx 字符串化,value = skill_id。
// 反向导入时整段覆盖(同 reviewer 多次提交以最新一份为准)。
export const ExternalPicksSchema = z.object({
  reviewer: z.string().default(""),
  imported_at: z.string().default(""),
  picks: z.record(z.string(), z.string()).default({}),
});
export type ExternalPicks = z.infer<typeof ExternalPicksSchema>;

export const BatchRunRecordSchema = z.object({
  id: z.string().min(1),
  created_at: z.string(),
  name: z.string().default(""),
  query_mode: BatchQueryModeSchema,
  // derive 模式下保留派生时的目的描述;其他模式留空
  purpose: z.string().default(""),
  // 三种模式最终都收敛成 queries[]:不论原始输入,server 端跑的就是这 N 行
  queries: z.array(z.string()).min(1),
  skill_ids: z.array(z.string()).min(1),
  scoring_dimensions: z.array(ScoringDimensionSchema).default([]),
  cells: z.array(BatchCellSchema),
  rewrite_llm: z.string().default(""),
  status: BatchRunStatusSchema.default("draft"),
  // 是否在每条 skill 的 system prompt 前注入 _universal.md(通用 5 条规则)。
  // 默认 true:跟历史行为一致;新建跑批时 PM 可以勾掉验证"无通用规则" 时的输出表现。
  // 旧 record(没有这个字段)被 default(true) 兜底,行为不变。
  include_universal: z.boolean().default(true),
  // 外部盲评结果(可选,通过导出 → 评分 → 导入流程获得)。
  // 不放在 cell 上是因为 picks 是 query 级别决策(每 query 一个 winner),不是 cell 级别评分。
  external_picks: ExternalPicksSchema.optional(),
});
export type BatchRunRecord = z.infer<typeof BatchRunRecordSchema>;

// 列表页用的瘦索引项:不带 cells / 大字段,避免读历史列表时 IO 爆炸
export const BatchRunSummarySchema = z.object({
  id: z.string(),
  created_at: z.string(),
  name: z.string(),
  query_mode: BatchQueryModeSchema,
  status: BatchRunStatusSchema,
  n_queries: z.number().int(),
  n_skills: z.number().int(),
  done_cells: z.number().int(),
  total_cells: z.number().int(),
});
export type BatchRunSummary = z.infer<typeof BatchRunSummarySchema>;

// ───────────── 融合台 (Fusion Lab) ─────────────
//
// 把"任意 production prompt + 实验台规则"融合成新 prompt。
// 复用 batch lab 的"一 run 一 file + per-id mutex"持久化模式,但 schema 独立。
//
// 关键点:
// - attempts 是数组(每次 LLM 重试都 append),便于 PM 回看每一版尝试,不覆盖
// - changes 跟 conflicts 都用 char offset 标位置(不是行号),前端渲染时基于 merged_prompt 切片
// - rule 用 discriminated union 区分"实验台来源"和"自由 paste"
// - 没有外部 SSE / 长跑后台,因为融合是单次 LLM 调用,~20s 出结果,跟 rewrite 一样在线等
export const FusionMergeStrategySchema = z.enum([
  "append",          // 追加在末尾
  "insert_nearby",   // 就近插入(LLM 找语义相近段)
  "replace_section", // 替换冲突段(老规则 swap 成新规则)
  "wrap_reference",  // 包裹引用(prompt 头加引用 + 末尾 append 全文)
  "rewrite_embed",   // 改写嵌入(把现有段改写成体现新规则)
  "few_shot",        // 加 few-shot 示例
]);
export type FusionMergeStrategy = z.infer<typeof FusionMergeStrategySchema>;

export const FusionRuleSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("lab"),
    skill_id: z.string(),
    granularity: z.enum(["skill", "section", "principle"]),
    section_anchor: z.string().optional(),  // section 标题 or 原则 id
    extracted_text: z.string(),             // 实际抽出的规则原文(冗余存,便于复盘)
  }),
  z.object({
    kind: z.literal("custom"),
    text: z.string(),                       // PM 自由 paste 的文本
  }),
]);
export type FusionRuleSource = z.infer<typeof FusionRuleSourceSchema>;

export const FusionConflictSchema = z.object({
  id: z.string(),
  region_start: z.number(),
  region_end: z.number(),
  original_text: z.string(),                // 原 prompt 的对应段落
  new_rule_text: z.string(),                // 新规则相关内容
  // 默认 "new" = LLM 让新规则赢;PM 点"回退该处"后由 hint-retry 重新生成,
  // 这个字段主要是给前端展示状态用,不影响存储语义。
  resolution: z.enum(["new", "old"]).default("new"),
});
export type FusionConflict = z.infer<typeof FusionConflictSchema>;

export const FusionChangeMarkerSchema = z.object({
  id: z.string(),
  type: z.enum(["addition", "modification", "replacement"]),
  region_start: z.number(),
  region_end: z.number(),
  strategy: FusionMergeStrategySchema,
  reason: z.string(),                       // LLM 给的"为什么这么改"
  original_text: z.string().optional(),     // type ≠ addition 时,被替换的原文
});
export type FusionChangeMarker = z.infer<typeof FusionChangeMarkerSchema>;

export const FusionMergeResultSchema = z.object({
  merged_prompt: z.string(),
  strategy: FusionMergeStrategySchema,
  changes: z.array(FusionChangeMarkerSchema),
  conflicts: z.array(FusionConflictSchema),
  llm_explanation: z.string(),              // 1-3 段 PM 看的总结
  ms: z.number(),
  raw: z.string(),                          // 原始 LLM 输出(调试用)
});
export type FusionMergeResult = z.infer<typeof FusionMergeResultSchema>;

export const FusionAttemptSchema = z.object({
  timestamp: z.string(),
  // PM 强制策略 / undefined = LLM 自选
  strategy_request: FusionMergeStrategySchema.optional(),
  hint: z.string().default(""),             // PM 重试时给的 hint
  result: FusionMergeResultSchema.nullable(), // null = LLM 调用失败
  error: z.string().nullable().default(null),
});
export type FusionAttempt = z.infer<typeof FusionAttemptSchema>;

export const FusionRunStatusSchema = z.enum([
  "draft",     // 创建未跑融合(实际不会停留在这,因为创建即跑首次融合)
  "merging",   // LLM 跑中(短暂状态)
  "ready",     // 至少有一次成功融合(主状态)
  "discarded", // PM 主动丢弃
]);
export type FusionRunStatus = z.infer<typeof FusionRunStatusSchema>;

export const FusionRunRecordSchema = z.object({
  id: z.string().min(1),
  created_at: z.string(),
  name: z.string().default(""),
  source_prompt: z.string(),
  rule: FusionRuleSourceSchema,
  rewrite_llm: z.string().default(""),
  // 历次融合(初始 + 重试都 append),最新一次 = attempts.at(-1)
  // 不删旧 attempt,便于 PM 回看每一版尝试和对比
  attempts: z.array(FusionAttemptSchema),
  status: FusionRunStatusSchema.default("draft"),
});
export type FusionRunRecord = z.infer<typeof FusionRunRecordSchema>;

// 列表页瘦索引(避免读全文)
export const FusionRunSummarySchema = z.object({
  id: z.string(),
  created_at: z.string(),
  name: z.string(),
  status: FusionRunStatusSchema,
  rule_kind: z.enum(["lab", "custom"]),
  rule_label: z.string(),                   // "F15 / Language strategy" 或 "自定义规则"
  source_prompt_preview: z.string(),        // 前 60 字
  attempt_count: z.number().int(),
});
export type FusionRunSummary = z.infer<typeof FusionRunSummarySchema>;
