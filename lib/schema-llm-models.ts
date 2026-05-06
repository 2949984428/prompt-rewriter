// prompt-rewriter/lib/schema-llm-models.ts
import { z } from "zod";

export const LLMModelEntrySchema = z.object({
  id: z.string().min(1),       // gateway 模型 ID,如 bedrock/claude-sonnet-4-6
  label: z.string().min(1),    // UI 显示名,如 "Claude 4.6"
  provider: z.string().default(""),
  notes: z.string().default(""),
});
export type LLMModelEntry = z.infer<typeof LLMModelEntrySchema>;

export const LLMModelsConfigSchema = z.object({
  default: z.string().min(1),
  available: z.array(LLMModelEntrySchema).min(1),
});
export type LLMModelsConfig = z.infer<typeof LLMModelsConfigSchema>;
