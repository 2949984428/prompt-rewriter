// prompt-rewriter/lib/format-runner.ts
//
// 共用层:把"用一个 skill 把一个 query 改成 final_prompt"这件事抽出来,
// 让 /api/labs/format/run 和 /api/labs/batch 都能复用,免得逻辑漂移。
//
// 不在这里做的事:
//   - 不组织"N 路并发":由调用方自己决定怎么并发(format lab 用 Promise.all,
//     batch 用 semaphore 限流)
//   - 不写日志 / 持久化:这只是一个纯函数式的 runner,只返回结果
//   - 不解决"怎么写历史":留给调用方
//
// 跟原 route.ts 行为完全一致(包括 quality 锁定 medium、JSON 兜底修复等)。

import { promises as fs } from "fs";
import path from "path";
import { callLLMToolStream, LLMError } from "@/lib/llm";
import { FinalPromptSchema, type FinalPrompt } from "@/lib/schema";
import { FormatSkillsIndexSchema } from "@/lib/schema-format";
import { formatPromptTool } from "@/lib/tool-schema";

const SKILLS_DIR = path.join(process.cwd(), "data", "labs", "format", "skills");
const INDEX_FILE = path.join(SKILLS_DIR, "index.json");
const UNIVERSAL_FILE = path.join(SKILLS_DIR, "_universal.md");

// SYSTEM_TAIL:补充 size 枚举的语义解释 + quality 锁定声明。
// 工具协议(formatPromptTool)已经把 schema 摆给 LLM,这里只补"人话"。
export const SYSTEM_TAIL = `

# 输出
通过工具 \`emit_format_prompt\` 提交 gpt-image-2 原生请求体(单次调用,5 个字段)。
prompt 字段:严格按上面"格式范式"写整段文本(可含中文标点 / 换行 / 引号,工具协议会自动转义)。
size 字段(按 query 推断比例,默认 "1024x1024",拿不准填 "auto"):
- "1024x1024"  → 1:1 默认
- "2048x2048"  → 1:1 高清(用户说"高清 / 主视觉 / 2K"时)
- "1536x1024"  → 3:2 横(标准横构图)
- "1024x1536"  → 2:3 竖(海报 / 小红书)
- "1792x1008"  → 16:9 横(视频封面 / 桌面壁纸)
- "1008x1792"  → 9:16 竖(手机壁纸 / Stories / Reels)
- "1536x1152"  → 4:3 横
- "1152x1536"  → 3:4 竖(Pinterest / 杂志页)
- "auto"       → 兜底
quality: 固定填 "medium"(本工程已锁定该档位作为成本/速度兜底,即便 query 里说"高清/2K",也不要升档到 high)
n: 1-10  ·  output_format: "png" | "jpeg" | "webp"`;

export async function loadSkill(id: string): Promise<string> {
  const safe = path.basename(id);
  const filepath = path.join(SKILLS_DIR, `${safe}.md`);
  if (!filepath.startsWith(SKILLS_DIR + path.sep)) {
    throw new Error("forbidden skill id");
  }
  return fs.readFile(filepath, "utf-8");
}

export async function loadUniversalRules(): Promise<string> {
  try {
    return await fs.readFile(UNIVERSAL_FILE, "utf-8");
  } catch {
    return "";
  }
}

export async function loadAllLabels(): Promise<Record<string, string>> {
  try {
    const text = await fs.readFile(INDEX_FILE, "utf-8");
    const data = FormatSkillsIndexSchema.parse(JSON.parse(text));
    return Object.fromEntries(data.versions.map((v) => [v.id, v.label]));
  } catch {
    return {};
  }
}

// 状态机扫一遍,只在双引号包裹的字符串内做替换。
// 用途:F8(中文任务式)等要求 prompt 字段含多行中文时,模型经常打印真实换行,
// 但 JSON 标准里 string 内部的真实换行非法 → JSON.parse 必失败。
function repairUnescapedNewlines(s: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  for (const c of s) {
    if (escape) {
      out += c;
      escape = false;
      continue;
    }
    if (c === "\\") {
      out += c;
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      out += c;
      continue;
    }
    if (inString) {
      if (c === "\n") {
        out += "\\n";
        continue;
      }
      if (c === "\r") {
        out += "\\r";
        continue;
      }
      if (c === "\t") {
        out += "\\t";
        continue;
      }
    }
    out += c;
  }
  return out;
}

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) {
      try {
        return JSON.parse(m[1]);
      } catch {
        try {
          return JSON.parse(repairUnescapedNewlines(m[1]));
        } catch {
          /* fallthrough */
        }
      }
    }
    try {
      return JSON.parse(repairUnescapedNewlines(s));
    } catch {
      throw new Error("LLM 返回不是合法 JSON");
    }
  }
}

export type FormatRunResult = {
  format_id: string;
  format_label: string;
  final_prompt: FinalPrompt | null;
  error: string | null;
  raw: string;
  ms: number;
};

/**
 * 用 skill_id 把 query 改成 final_prompt。
 * - 失败不抛异常,统一回包到 error 字段(调用方矩阵化跑时不希望一格炸全军)。
 * - quality 在 server 端硬锁 medium,即便 LLM 给 high 也覆盖。
 * - F11 特殊语义:走完整 LLM 路径(对齐 F10 的 size 推断质量),
 *   但 prompt 字段在落盘前被 server-side safety 强制覆盖回用户原 query。
 */
export async function runFormatOne(
  query: string,
  skill_id: string,
  labelMap: Record<string, string>,
  llmModel: string | undefined,
  // 是否前置 _universal.md 通用规则。默认 true 保持向后兼容。
  // batch lab 创建跑批时 PM 可以选择关掉,验证"只有 skill 不带通用规则"的输出表现。
  includeUniversal: boolean = true
): Promise<FormatRunResult> {
  const label = labelMap[skill_id] ?? skill_id;
  const startedAt = Date.now();

  let sys: string;
  try {
    // 关掉通用规则时省一次 IO + 少 ~1.5KB 的 system prompt token
    const [universal, skill] = await Promise.all([
      includeUniversal ? loadUniversalRules() : Promise.resolve(""),
      loadSkill(skill_id),
    ]);
    sys = (universal ? universal + "\n\n---\n\n" : "") + skill + SYSTEM_TAIL;
  } catch (e) {
    return {
      format_id: skill_id,
      format_label: label,
      final_prompt: null,
      error: `读取 skill 失败: ${String(e)}`,
      raw: "",
      ms: Date.now() - startedAt,
    };
  }
  const user = `用户原始 query:\n\n"""\n${query}\n"""\n\n按上面的格式范式调用 emit_format_prompt 工具。`;

  let raw = "";
  try {
    for await (const delta of callLLMToolStream(
      [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      formatPromptTool,
      llmModel
    )) {
      raw += delta;
    }
    if (!raw.trim()) {
      throw new LLMError("LLM 未通过工具返回任何参数");
    }
    const parsed = tryParseJson(raw);
    const fp = FinalPromptSchema.parse(parsed);
    // quality 硬锁 medium。
    // F11 special:prompt 字段强制 = 用户原 query.trim(),只保留 LLM 推出来的 size。
    // 这样 F11 跟 F10 共享同一套画幅推断逻辑(完全对齐),
    // 但作为 baseline 仍然不让 LLM 改写 prompt 内容。
    const lockedFp: FinalPrompt = {
      ...fp,
      quality: "medium",
      ...(skill_id === "F11-direct-api" ? { prompt: query.trim() } : {}),
    };
    return {
      format_id: skill_id,
      format_label: label,
      final_prompt: lockedFp,
      error: null,
      raw,
      ms: Date.now() - startedAt,
    };
  } catch (e) {
    const err = e as LLMError;
    return {
      format_id: skill_id,
      format_label: label,
      final_prompt: null,
      error: err?.message ?? String(e),
      raw,
      ms: Date.now() - startedAt,
    };
  }
}
