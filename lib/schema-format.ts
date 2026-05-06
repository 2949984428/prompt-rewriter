// prompt-rewriter/lib/schema-format.ts
//
// Format Lab 专用 schema —— 故意单独成文件,避免和主 schema.ts 的并行编辑冲突。
//
// Format Lab 的核心数据单位是 "一次跑批 (一个 query × N 个格式) + 评分":
//   ┌─ FormatRunRecord ───────────────────────────┐
//   │ id, ts, query, use_case_hint                │
//   │ format_runs: [                              │
//   │   { format_id, prompt, image_job, pm_score,│
//   │     pm_notes, rated_at }, …                 │
//   │ ]                                           │
//   │ winner_format_id (评分后自动算)              │
//   │ config_snapshot (target_model + profile hash)│
//   └─────────────────────────────────────────────┘
//
// 老 history (data/history.json) 的 ImageJobRecord 不复用,因为 format lab
// 每路只跑 1 张图、不跑 baseline 对比,字段少且语义不同。

import { z } from "zod";

// ─────────── Format Lab 的 skill 索引 ───────────
//
// 与主 SkillsIndex 不同:format lab 没有 "active" 概念,因为它本来就是
// "勾选多个并发跑";versions 列表本身就是"可选格式池"。
export const FormatSkillVersionSchema = z.object({
  id: z.string().min(1),                // 必须能作为文件名:F1-long-comma 等
  label: z.string().min(1),             // UI 显示:F1 Long Comma
  notes: z.string().default(""),        // 一句话简介
  createdAt: z.string().default(""),
});
export type FormatSkillVersion = z.infer<typeof FormatSkillVersionSchema>;

export const FormatSkillsIndexSchema = z.object({
  versions: z.array(FormatSkillVersionSchema).default([]),
});
export type FormatSkillsIndex = z.infer<typeof FormatSkillsIndexSchema>;


// 单路格式跑出的产物
export const FormatRunSchema = z.object({
  format_id: z.string(),                 // skills/index.json 里的版本 id
  format_label: z.string().default(""),  // 显示用 (如 "F1 Long Comma")

  // LLM 改写后的 final_prompt 对象 (与 FinalPromptSchema 同构)
  final_prompt: z
    .object({
      prompt: z.string(),
      size: z.string().optional(),
      quality: z.string().optional(),
      n: z.number().optional(),
      output_format: z.string().optional(),
    })
    .partial(),

  // 这次跑出来的图(任务元数据 + 落盘路径)
  image_job: z
    .object({
      task_id: z.string().nullable().default(null),
      urls: z.array(z.string()).default([]),         // gateway url(可能 expire)
      local_paths: z.array(z.string()).default([]),  // /api/image-file/... 永久路径
      cost: z.number().nullable().default(null),
      latency_ms: z.number().nullable().default(null),
      error: z.string().nullable().default(null),
    })
    .default({
      task_id: null,
      urls: [],
      local_paths: [],
      cost: null,
      latency_ms: null,
      error: null,
    }),

  // PM 主观评分(1-10) + 备注。null = 未打分。
  pm_score: z.number().int().min(1).max(10).nullable().default(null),
  pm_notes: z.string().default(""),
  rated_at: z.number().nullable().default(null),
});
export type FormatRun = z.infer<typeof FormatRunSchema>;

// 一次完整跑批 = 1 query × N 个格式
export const FormatRunRecordSchema = z.object({
  id: z.string(),
  ts: z.number(),
  query: z.string(),
  use_case_hint: z.string().default(""),  // PM 可选标注,方便后续按 use_case 聚合

  format_runs: z.array(FormatRunSchema).default([]),

  // 所有 pm_score 出齐后,前端自动算最高分 format → 写到这个字段。
  // 评分中途为 null。
  winner_format_id: z.string().nullable().default(null),

  // 跑这次时的环境快照(便于事后回看时知道是哪个 model + profile + 改写 LLM)
  config_snapshot: z
    .object({
      target_model: z.string().default(""),
      model_profile_hash: z.string().default(""),
      // 驱动改写的 LLM 模型 id,空串 = 用后端 env 默认。历史记录里曾长期缺这个字段,
      // 老记录里没有该 key 时 default 为空串,前端展示时显示"-"或"默认"。
      rewrite_llm: z.string().default(""),
    })
    .default({ target_model: "", model_profile_hash: "", rewrite_llm: "" }),
});
export type FormatRunRecord = z.infer<typeof FormatRunRecordSchema>;
