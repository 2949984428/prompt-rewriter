// prompt-rewriter/lib/llm.ts
import OpenAI from "openai";
import type { ChatTool } from "./tool-schema";

type ChatMsg = { role: "system" | "user"; content: string };

export class LLMError extends Error {
  constructor(message: string, public raw?: string) {
    super(message);
  }
}

const BASE_URL = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
const API_KEY = process.env.LLM_API_KEY ?? "sk-placeholder";
const MODEL = process.env.LLM_MODEL ?? "gpt-4o-mini";

const client = new OpenAI({ baseURL: BASE_URL, apiKey: API_KEY });

// 解析"调用方传的模型覆盖"。空 / 无效 → fallback 到 env 配置的 MODEL。
// 三处 callLLM* 共用,确保前端切换模型对所有调用入口生效。
function resolveModel(modelOverride?: string): string {
  const m = modelOverride?.trim();
  return m && m.length > 0 ? m : MODEL;
}

// 不同模型对 temperature 有不同硬约束,集中在这里维护。
// - Kimi K2.5: `only 0.6 is allowed for this model`(Moonshot 服务端强制)
// - Claude / 其他: 0.4(原默认值,适合结构化改写,既不死板又不发散)
function temperatureFor(model: string): number {
  if (model.startsWith("kimi/")) return 0.6;
  return 0.4;
}

/** 非流式（保留，作为 fallback / 单元测试用）。 */
export async function callLLM(
  messages: ChatMsg[],
  modelOverride?: string
): Promise<string> {
  const model = resolveModel(modelOverride);
  try {
    const resp = await client.chat.completions.create({
      model,
      messages,
      temperature: temperatureFor(model),
      max_tokens: 8192,
    });

    const content = resp.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new LLMError("LLM 返回缺 content", JSON.stringify(resp));
    }
    return content;
  } catch (e) {
    if (e instanceof LLMError) throw e;
    const err = e as { status?: number; message?: string };
    throw new LLMError(
      `LLM 调用失败${err.status ? ` (${err.status})` : ""}: ${err.message ?? String(e)} [model=${model}]`
    );
  }
}

/** 流式：逐 token 吐出 content delta 文本。（保留作 fallback / 其他不需要结构化输出的调用） */
export async function* callLLMStream(
  messages: ChatMsg[],
  modelOverride?: string
): AsyncGenerator<string, void, void> {
  const model = resolveModel(modelOverride);
  try {
    const stream = await client.chat.completions.create({
      model,
      messages,
      temperature: temperatureFor(model),
      max_tokens: 8192,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) {
        yield delta;
      }
    }
  } catch (e) {
    const err = e as { status?: number; message?: string };
    throw new LLMError(
      `LLM 流式调用失败${err.status ? ` (${err.status})` : ""}: ${err.message ?? String(e)} [model=${model}]`
    );
  }
}

/**
 * 流式 + 强制 tool_choice：让 LLM 必须调用某个工具,逐 token 吐出该工具的
 * function.arguments 字符串 delta(这是一段合法 JSON 的增量前缀)。
 *
 * 和 callLLMStream 的区别:
 *   - LLM 的输出结构由 tool.parameters(JSON Schema)强制约束,不再靠 prompt 话术
 *   - 前端收到的每个 delta 累加起来 = 一段有效 JSON,不会混入 markdown 围栏
 *   - 不再需要 extractJsonFragment / coerceNulls 这类 fallback
 */
export async function* callLLMToolStream(
  messages: ChatMsg[],
  tool: ChatTool,
  modelOverride?: string
): AsyncGenerator<string, void, void> {
  const model = resolveModel(modelOverride);
  try {
    const stream = await client.chat.completions.create({
      model,
      messages,
      temperature: temperatureFor(model),
      max_tokens: 8192,
      stream: true,
      tools: [tool],
      tool_choice: {
        type: "function",
        function: { name: tool.function.name },
      },
    });

    for await (const chunk of stream) {
      const toolCalls = chunk.choices?.[0]?.delta?.tool_calls;
      if (!Array.isArray(toolCalls) || toolCalls.length === 0) continue;
      // 强制只调用一个工具,index 0 即可
      const delta = toolCalls[0]?.function?.arguments;
      if (typeof delta === "string" && delta.length > 0) {
        yield delta;
      }
    }
  } catch (e) {
    const err = e as { status?: number; message?: string };
    throw new LLMError(
      `LLM 工具调用失败${err.status ? ` (${err.status})` : ""}: ${err.message ?? String(e)} [model=${model}]`
    );
  }
}
