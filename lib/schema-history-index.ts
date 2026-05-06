// prompt-rewriter/lib/schema-history-index.ts
//
// 跨实验台的轻量索引。所有 lab 的"我跑过这条 query"都在这里登记一行,
// 详情数据各 lab 自己存在 data/labs/<lab_id>/runs/<run_id>.json。
//
// 为什么 index 和 detail 分开:
//   - index 全局共享,改字段动很多代码 → 必须保守、字段精简
//   - detail 各 lab 各自演进 → schema 自由,改 schema 不影响其他 lab 的索引展示
//   - schema 出 bug 时索引仍可读 → 历史不会"清空只剩新一条"

import { z } from "zod";

// 实验台标识。union 而非 enum:未来加台不动 schema 文件,只在使用方处加 string。
export const LAB_IDS = ["rewrite", "format"] as const;
export type LabId = (typeof LAB_IDS)[number];

export const HistoryIndexEntrySchema = z.object({
  id: z.string(),                    // run_id (uuid)
  ts: z.number(),                    // 跑批时间戳
  lab_id: z.string(),                // "rewrite" / "format" / 未来扩展
  query: z.string(),                 // 用户原始 query
  summary: z.string().default(""),   // 一句话摘要(每 lab 自己生成,如"分类→ 电商→服装"或"3 路 PM 平均 7.5")
  status: z.enum(["completed", "failed", "partial"]).default("completed"),
  ref: z.string(),                   // 详情文件路径,相对项目根: "data/labs/<lab_id>/runs/<id>.json"
  // 可选评分汇总(用于排序/筛选,避免每次都拉详情)
  pm_score_avg: z.number().nullable().default(null),
  pm_score_count: z.number().int().default(0),
  // 任意 lab-specific 元数据(标签 / 用了哪些 skill 等),保持 JSON 形态
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type HistoryIndexEntry = z.infer<typeof HistoryIndexEntrySchema>;
