// prompt-rewriter/lib/pipeline/schema-shared.ts
//
// Pipeline 跨 step 共用的 Zod schema + 类型。原本内联在 app/api/labs/pipeline/route.ts,
// Phase 1 重构时抽出来,让 5 个 step 文件各自 import,route.ts re-export 保证外部 import 不破。

import { z } from "zod";

// ─────────── 线上 search_intent 输出 schema ───────────
export const SearchIntentSchema = z.object({
  has_search_intent: z.enum(["yes", "no"]),
  search_type: z.string(),
  intent_confidence: z.enum(["strong", "medium", "weak"]),
  vertical: z.enum(["ecommerce", "brand", "social", "other"]),
  platform: z.string(),
});

export type SearchIntent = z.infer<typeof SearchIntentSchema>;

// ─────────── 线上 media_prompt_review 输出 schema ───────────
export const MediaPromptReviewSchema = z.object({
  reviewed: z.array(
    z.object({
      id: z.string(),
      prompt: z.string(),
    }),
  ),
});

export type MediaPromptReviewResult = z.infer<typeof MediaPromptReviewSchema>;
