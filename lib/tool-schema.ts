// prompt-rewriter/lib/tool-schema.ts
//
// Zod schema → JSON Schema → OpenAI tool definition。
// 两阶段 tool calling:
//   阶段 1 → emit_analysis_result   (AnalysisResultSchema, 5 步结构化分析)
//   阶段 2 → emit_final_prompt      (FinalPromptResultSchema, 只产 final_prompt)
//
// 拆成两次调用的动机(见 route.ts 注释):
//   - 单次调用时,LLM 必须按字段顺序一次性产出 6 步,final_prompt 被排在最后,
//     总体 E2E 约 100s,体感上"最后一张卡出得很慢"。
//   - 拆开后第一次调用 tokens 砍掉 ~30%,第二次调用的 system prompt 可以专注
//     model profile,让 LLM 合最终 prompt 时注意力更集中。

import { z } from "zod";
import {
  AnalysisResultSchema,
  FinalPromptResultSchema,
  FinalPromptSchema,
} from "./schema";

// ── 阶段 1:分析 tool ───────────────────────────────────────
export const ANALYSIS_TOOL_NAME = "emit_analysis_result";
const analysisParams = z.toJSONSchema(AnalysisResultSchema, { io: "input" });

// ── 阶段 2:合成 tool ───────────────────────────────────────
export const FINAL_PROMPT_TOOL_NAME = "emit_final_prompt";
const finalPromptParams = z.toJSONSchema(FinalPromptResultSchema, {
  io: "input",
});

export type ChatTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export const rewriteAnalysisTool: ChatTool = {
  type: "function",
  function: {
    name: ANALYSIS_TOOL_NAME,
    description:
      "把 Prompt 改写的前 5 步产物(分类 / 抽取 / 域思考 / 硬约束 / 缓冲)作为结构化参数一次性提交回来。必须且只能调用一次。不要输出 final_prompt —— 那是下一阶段的工作。",
    parameters: analysisParams,
  },
};

export const rewriteFinalPromptTool: ChatTool = {
  type: "function",
  function: {
    name: FINAL_PROMPT_TOOL_NAME,
    description:
      "基于上一阶段分析结论,遵循目标模型 profile,合成 final_prompt。必须且只能调用一次。final_prompt 直接对齐 gpt-image-2 原生请求体:prompt(完整自然语言)/size/quality/n/output_format。不要再产出 annotated 标注(推导链路已由 analysis 阶段展示)。",
    parameters: finalPromptParams,
  },
};

// ── format lab 专用 tool ───────────────────────────────────
// 直接以 FinalPromptSchema 作为参数(扁平,不包 final_prompt 层),
// 让 LLM 一次性给出 gpt-image-2 原生请求体的 5 个字段。
//
// 用 tool calling 而非 raw text + JSON.parse 的关键收益:
//   prompt 字段值里的 ASCII 双引号 / 真实换行 / 中文标点等"易破坏 JSON"的内容,
//   由 Anthropic / OpenAI tool-calling 协议层自动转义,LLM 不可能产生非法 JSON。
//   修复了 F5 等格式因 query 含引号文本时频繁 "LLM 返回不是合法 JSON" 的 bug。
export const FORMAT_PROMPT_TOOL_NAME = "emit_format_prompt";
const formatPromptParams = z.toJSONSchema(FinalPromptSchema, { io: "input" });

export const formatPromptTool: ChatTool = {
  type: "function",
  function: {
    name: FORMAT_PROMPT_TOOL_NAME,
    description:
      "按当前 skill.md 描述的格式,把用户 query 改写成 gpt-image-2 原生请求体并提交。必须且只能调用一次。prompt 字段是按当前格式(逗号长串 / 字段表 / 中文任务 / 极简短句…)写好的整段文本;size/quality/n/output_format 按 query 推断填合法值。",
    parameters: formatPromptParams,
  },
};

// ── fusion lab 工具 ─────────────────────────────────────
// 用法:source_prompt + rule (+ optional strategy_request, hint) → 结构化融合结果。
// LLM 选 6 种策略之一,产出 merged_prompt + changes + conflicts + 总结。
// `ms` / `raw` 是 server 端运行时字段(耗时 / 原始输出),不让 LLM 填,所以这里
// 用一个独立的 tool-input schema(剔除 ms / raw)生成 JSON Schema。
export const FUSION_TOOL_NAME = "emit_fusion_result";

const fusionToolInputSchema = z.object({
  merged_prompt: z.string(),
  strategy: z.enum([
    "append",
    "insert_nearby",
    "replace_section",
    "wrap_reference",
    "rewrite_embed",
    "few_shot",
  ]),
  changes: z.array(
    z.object({
      id: z.string(),
      type: z.enum(["addition", "modification", "replacement"]),
      region_start: z.number(),
      region_end: z.number(),
      strategy: z.enum([
        "append",
        "insert_nearby",
        "replace_section",
        "wrap_reference",
        "rewrite_embed",
        "few_shot",
      ]),
      reason: z.string(),
      original_text: z.string().optional(),
    })
  ),
  conflicts: z.array(
    z.object({
      id: z.string(),
      region_start: z.number(),
      region_end: z.number(),
      original_text: z.string(),
      new_rule_text: z.string(),
    })
  ),
  llm_explanation: z.string(),
});

const fusionToolParams = z.toJSONSchema(fusionToolInputSchema, { io: "input" });

export const fusionTool: ChatTool = {
  type: "function",
  function: {
    name: FUSION_TOOL_NAME,
    description:
      "把 SOURCE_PROMPT 和 RULE 融合,选 6 种策略之一(append / insert_nearby / replace_section / wrap_reference / rewrite_embed / few_shot),产出融合后 prompt 全文 + 改动标注 + 冲突标注。region_start/end 是融合后 prompt 的 char offset。如有 STRATEGY_REQUEST 则必须遵守;如有 HINT 则必须满足。必须且只能调用一次。",
    parameters: fusionToolParams,
  },
};

// ── batch lab 派生 query 工具 ───────────────────────────────
// 用法:用户写一段"测试目的",LLM 派生 N 条具体 query。
// 用 tool calling 是为了得到稳定的 string 数组,免去 JSON.parse 兜底。
export const DERIVE_QUERIES_TOOL_NAME = "emit_derived_queries";
export const deriveQueriesTool: ChatTool = {
  type: "function",
  function: {
    name: DERIVE_QUERIES_TOOL_NAME,
    description:
      "根据用户给出的『测试目的』,派生若干条具体的图像生成 query。每条都应是用户视角的自然语言指令,覆盖目的描述里的不同子场景 / 不同品类 / 不同风格。必须且只能调用一次。",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["queries"],
      properties: {
        queries: {
          type: "array",
          minItems: 1,
          items: { type: "string", minLength: 1 },
          description:
            "派生出来的 query 列表,长度严格等于用户要求的 N。每条 30-200 字,自然语言,不要带编号前缀。",
        },
      },
    },
  },
};
