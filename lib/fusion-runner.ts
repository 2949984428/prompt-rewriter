// prompt-rewriter/lib/fusion-runner.ts
//
// 核心:把 source_prompt + rule + (optional strategy/hint) 喂给 LLM,
// LLM 通过工具协议返回结构化融合结果。
//
// 不在这里做的事:
//   - 不写盘(由 API 路由调 fusion-store 写)
//   - 不做规则抽取(由 skill-rule-index 提前算好,API 路由透传 extracted_text)
//   - 不做并发控制(融合是单次同步调用,~20s,在线等)

import { callLLMToolStream, LLMError } from "@/lib/llm";
import { fusionTool } from "@/lib/tool-schema";
import {
  FusionMergeResultSchema,
  type FusionMergeResult,
  type FusionRuleSource,
  type FusionMergeStrategy,
} from "@/lib/schema";

const FUSION_SYSTEM = `
You are a Prompt Fusion Assistant. Your job: take a user's production prompt (SOURCE_PROMPT) and a rule (RULE), and merge the rule into the prompt while preserving the prompt's intent and structure.

# Strategies (you MUST pick exactly one)
1. append            — pure tail-append (rule has no semantic overlap with existing prompt)
2. insert_nearby     — find semantically related section, insert rule after it
3. replace_section   — old prompt has content that contradicts the rule, swap that section
4. wrap_reference    — rule is too long; add a brief "also follow X (defined below)" reference at top + full rule at end
5. rewrite_embed     — old prompt has a paragraph that should be rewritten to embody the rule
6. few_shot          — rule is best demonstrated by examples; append 1-2 few-shot demonstrations

If a STRATEGY_REQUEST is given, you MUST use that strategy. Otherwise pick the best fit.

# Hint
If a HINT is given (PM's feedback from a previous attempt), incorporate it. Common hints: "don't use X strategy", "rule should appear before section Y", "this paragraph shouldn't be touched".

# Conflict detection
A "conflict" = a region in the merged_prompt where the new rule's content directly contradicts what the source prompt previously stated. Examples:
  - Source says "always output English"; rule says "preserve Chinese characters verbatim"
  - Source says "be concise"; rule says "expand with detailed examples"

For each conflict, emit a conflict entry. The default resolution is "new" (rule wins). Conflicts SHOULD ALSO appear as a change marker (region overlap is fine).

# Change types
- addition     — new content inserted (no original)
- modification — existing content reworded but kept in place
- replacement  — existing content swapped wholesale

# Output (via emit_fusion_result tool)
Required fields:
- merged_prompt: full merged prompt text
- strategy: which of the 6 strategies you used
- changes: array of change markers (id stable like c1, c2, ...)
  region_start/end: char offsets in the FINAL merged_prompt (NOT source)
- conflicts: array of conflict markers (subset of changes that contradict source)
- llm_explanation: 1-3 sentence summary for the PM (what you did and why)

# Important rules
- Preserve source prompt's overall structure and voice; only change what's necessary
- Don't summarize the rule unless absolutely needed; preserve verbatim where possible
- All change/conflict ids should be short stable strings (c1, c2, ... / cf1, cf2, ...)
- region offsets MUST refer to char positions in merged_prompt, validated against the actual text you produce
- Do not invent strategies outside the 6 listed
- If RULE has no meaningful overlap or conflict with SOURCE_PROMPT, default to append with empty conflicts
`.trim();

function ruleToText(rule: FusionRuleSource): string {
  return rule.kind === "lab" ? rule.extracted_text : rule.text;
}

export type FusionRunInput = {
  source_prompt: string;
  rule: FusionRuleSource;
  strategy_request?: FusionMergeStrategy;
  hint?: string;
  llm_model?: string;
};

export type FusionRunOutput = {
  result: FusionMergeResult | null;
  error: string | null;
};

export async function runFusion(input: FusionRunInput): Promise<FusionRunOutput> {
  const startedAt = Date.now();
  const userMsg = [
    `<SOURCE_PROMPT>\n${input.source_prompt}\n</SOURCE_PROMPT>`,
    `<RULE>\n${ruleToText(input.rule)}\n</RULE>`,
    input.strategy_request
      ? `<STRATEGY_REQUEST>${input.strategy_request}</STRATEGY_REQUEST>`
      : "",
    input.hint ? `<HINT>${input.hint}</HINT>` : "",
    "Call emit_fusion_result with the structured fusion output.",
  ]
    .filter(Boolean)
    .join("\n\n");

  let raw = "";
  try {
    for await (const delta of callLLMToolStream(
      [
        { role: "system", content: FUSION_SYSTEM },
        { role: "user", content: userMsg },
      ],
      fusionTool,
      input.llm_model
    )) {
      raw += delta;
    }
    if (!raw.trim()) throw new LLMError("LLM 未通过工具返回任何参数");
    const parsed = JSON.parse(raw);
    // 把 server 运行时字段(ms / raw)塞进去,过 FusionMergeResultSchema 校验
    const validated = FusionMergeResultSchema.parse({
      ...parsed,
      ms: Date.now() - startedAt,
      raw,
    });
    return { result: validated, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { result: null, error: msg };
  }
}
