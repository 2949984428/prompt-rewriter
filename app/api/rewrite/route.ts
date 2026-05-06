// prompt-rewriter/app/api/rewrite/route.ts
//
// 两阶段 tool calling:
//   阶段 1 (analysis):       emit_analysis_result  → 产 5 步分析
//   阶段 2 (compose):        emit_final_prompt     → 基于分析 + model profile 合 final_prompt
//
// 错误处理策略(关键):**schema 是提示,不是门槛**。
//   - 任何一阶段 schema 严格校验挂掉,不 fail-fast,走 sanitizePartial 软路径输出
//     所有"能渲染"的数据,同时用 schema_warnings 把错误原因捎给前端,前端以提示
//     形式展示,绝不 block。
//   - 只有在完全拿不到可渲染数据(比如 LLM 一字未出)的极端情况才发 error。

import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { parse as besteffortParse } from "best-effort-json-parser";
import {
  HardRuleSchema,
  VerticalHintSchema,
  AnalysisResultSchema,
  FinalPromptResultSchema,
  type AnalysisResult,
  type HardRule,
  type VerticalHint,
} from "@/lib/schema";
import {
  buildAnalysisSystem,
  buildAnalysisUser,
  buildComposeSystem,
  buildComposeUser,
} from "@/lib/prompt-builder";
import { callLLMToolStream, LLMError } from "@/lib/llm";
import {
  rewriteAnalysisTool,
  rewriteFinalPromptTool,
} from "@/lib/tool-schema";
import { loadActiveModelProfile } from "@/lib/config";
import { loadActiveSkill } from "@/lib/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA = path.join(process.cwd(), "data");

async function readConfig(): Promise<{
  skill: string;
  enabledRules: HardRule[];
  hints: VerticalHint[];
  targetModel: string;
  modelProfileMd: string;
}> {
  const [{ md: skill }, rulesText, hintsText, { target_model, profile_md }] =
    await Promise.all([
      loadActiveSkill(),
      fs.readFile(path.join(DATA, "hard_rules.json"), "utf-8"),
      fs.readFile(path.join(DATA, "vertical_hints.json"), "utf-8"),
      loadActiveModelProfile(),
    ]);
  const allRules = z.array(HardRuleSchema).parse(JSON.parse(rulesText));
  const hints = z.array(VerticalHintSchema).parse(JSON.parse(hintsText));
  return {
    skill,
    enabledRules: allRules.filter((r) => r.enabled),
    hints,
    targetModel: target_model,
    modelProfileMd: profile_md,
  };
}

// ── 净化 / 归一化辅助函数 ─────────────────────────────────

/**
 * 尝试把一段字符串解释成 JSON(object / array)。
 *
 * Claude 的 tool_call 偶发把长数组 / 大对象整体字符串化塞进字段,内层 JSON
 * 里还可能夹带中文弯引号、未 escape 的双引号、截断、未闭合等破损形态,严格
 * JSON.parse 会直接放弃。这里用两段式容错:
 *   1. 先跑严格 JSON.parse(最常见情况、最快)
 *   2. 失败再退到 best-effort-json-parser(能吃截断 / 未闭合 / 多余逗号)
 * 两次都救不回来才返回 undefined,保持字符串原值让上层继续兜。
 */
function tryParseJsonish(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    // strict fail, fallback
  }
  try {
    const parsed = besteffortParse(str);
    if (parsed !== null && typeof parsed === "object") return parsed;
  } catch {
    // ignore
  }
  return undefined;
}

type FinalPromptLoose = {
  prompt: string;
  size?: string;
  quality?: string;
  n?: number;
  output_format?: string;
};

/**
 * 最后一道防线:从一段**破损 JSON 字符串**里用正则硬抠 final_prompt 的关键字段。
 *
 * 当 JSON.parse 和 best-effort-json-parser 都挂掉时(典型场景:Claude 把 final_prompt
 * 整体字符串化,内层还夹带未 escape 的 ASCII 双引号比如 `正文:"xxx"`),这个函数接管。
 * 只要能扒出 prompt,就返回可渲染的对象,其他参数有几个算几个。
 *
 * 这是"完全放弃结构"、纯字符串模式匹配,容忍度最高但产物最粗糙。
 */
function regexExtractFinalPrompt(src: string): FinalPromptLoose | null {
  if (typeof src !== "string" || src.length < 20) return null;

  // 抠 prompt 字段:"prompt": "...." 之后一直到下一个顶层键之前。
  // 注意 prompt 内部可能有 \"、换行等,我们放弃严格闭合,靠"下一个顶层字段出现"来截断。
  let prompt = "";
  const keyMatch = src.match(/"prompt"\s*:\s*"/);
  if (keyMatch && keyMatch.index !== undefined) {
    const afterColon = keyMatch.index + keyMatch[0].length;
    const nextKeyPatterns = [
      /",\s*"size"\s*:/,
      /",\s*"quality"\s*:/,
      /",\s*"n"\s*:/,
      /",\s*"output_format"\s*:/,
      /"\s*\}\s*,?\s*"final_prompt"/, // 外层结束
      /"\s*\}\s*\}?\s*$/, // 整段末尾
    ];
    let endIdx = -1;
    for (const pat of nextKeyPatterns) {
      const m = src.slice(afterColon).match(pat);
      if (m && m.index !== undefined) {
        const candidate = afterColon + m.index;
        if (endIdx < 0 || candidate < endIdx) endIdx = candidate;
      }
    }
    if (endIdx < 0) endIdx = src.length;
    const rawPrompt = src.slice(afterColon, endIdx);
    prompt = rawPrompt
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }

  // size / quality / output_format:简单键值对,直接正则
  const strField = (key: string): string | undefined => {
    const m = src.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
    return m ? m[1] : undefined;
  };
  const numField = (key: string): number | undefined => {
    const m = src.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`));
    return m ? Number(m[1]) : undefined;
  };

  const size = strField("size");
  const quality = strField("quality");
  const output_format = strField("output_format");
  const n = numField("n");

  if (prompt || size || quality || output_format || n !== undefined) {
    return { prompt, size, quality, n, output_format };
  }
  return null;
}

function unwrapStringifiedJson<T>(v: T): T {
  if (Array.isArray(v)) return v.map(unwrapStringifiedJson) as T;
  if (v && typeof v === "object") {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(src)) {
      if (typeof val === "string") {
        const trimmed = val.trim();
        const looksLikeJson =
          (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
          (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
          // Claude 有时会截断,末尾漏 } / ]。只要开头是 { 或 [ 就尝试。
          trimmed.startsWith("{") ||
          trimmed.startsWith("[");
        if (looksLikeJson) {
          const parsed = tryParseJsonish(trimmed);
          if (parsed !== undefined && parsed !== null && typeof parsed === "object") {
            out[k] = unwrapStringifiedJson(parsed);
            continue;
          }
        }
      }
      out[k] = unwrapStringifiedJson(val);
    }
    return out as T;
  }
  return v;
}

const FROM_ALIASES: Record<string, "user_query" | "ai_inferred" | "gap"> = {
  user_query: "user_query",
  query: "user_query",
  user: "user_query",
  original: "user_query",
  ai_inferred: "ai_inferred",
  inferred: "ai_inferred",
  ai: "ai_inferred",
  auto: "ai_inferred",
  gap: "gap",
  missing: "gap",
  need: "gap",
  needs: "gap",
  needed: "gap",
};

const INJECTION_LOCATION_ALIASES: Record<string, "head" | "body" | "tail"> = {
  head: "head",
  start: "head",
  beginning: "head",
  top: "head",
  body: "body",
  middle: "body",
  center: "body",
  tail: "tail",
  end: "tail",
  bottom: "tail",
};

function normalizeEnums<T>(v: T): T {
  if (Array.isArray(v)) return v.map(normalizeEnums) as T;
  if (v && typeof v === "object") {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(src)) {
      if (k === "from" && typeof val === "string") {
        out[k] = FROM_ALIASES[val.toLowerCase().trim()] ?? val;
      } else if (k === "injection_location" && typeof val === "string") {
        out[k] = INJECTION_LOCATION_ALIASES[val.toLowerCase().trim()] ?? val;
      } else {
        out[k] = normalizeEnums(val);
      }
    }
    return out as T;
  }
  return v;
}

function coerceNulls<T>(v: T): T {
  if (v === null) return undefined as T;
  if (Array.isArray(v)) return v.map(coerceNulls) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const cleaned = coerceNulls(val);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out as T;
  }
  return v;
}

/** 统一的 raw 清洗管线:JSON → unwrap → normalize → coerce nulls */
function cleanse<T = unknown>(v: unknown): T {
  return coerceNulls(normalizeEnums(unwrapStringifiedJson(v))) as T;
}

type Loose = Record<string, unknown>;

function sanitizePartial(obj: unknown): Loose | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Loose;
  const out: Loose = {};

  if (o.classify && typeof o.classify === "object") {
    const c = o.classify as Loose;
    const vpath = Array.isArray(c.vertical_path)
      ? c.vertical_path.filter(
          (lv) =>
            lv &&
            typeof lv === "object" &&
            typeof (lv as Loose).level === "number" &&
            typeof (lv as Loose).label === "string" &&
            typeof (lv as Loose).confidence === "number"
        )
      : [];
    out.classify = {
      vertical_path: vpath,
      stop_reason: typeof c.stop_reason === "string" ? c.stop_reason : "",
    };
  }

  if (Array.isArray(o.extract)) {
    out.extract = o.extract.filter((it) => {
      if (!it || typeof it !== "object") return false;
      const i = it as Loose;
      return (
        typeof i.field === "string" &&
        typeof i.value === "string" &&
        (i.from === "user_query" || i.from === "ai_inferred" || i.from === "gap")
      );
    });
  }

  if (Array.isArray(o.domain_thinking)) {
    out.domain_thinking = o.domain_thinking.filter((t) => {
      if (!t || typeof t !== "object") return false;
      const i = t as Loose;
      return typeof i.trigger === "string" && typeof i.thought === "string";
    });
  }

  if (Array.isArray(o.applied_hard_rules)) {
    out.applied_hard_rules = o.applied_hard_rules.filter((r) => {
      if (!r || typeof r !== "object") return false;
      const i = r as Loose;
      return typeof i.rule_id === "string" && typeof i.hit === "boolean";
    });
  }

  if (Array.isArray(o.buffers)) {
    out.buffers = o.buffers.filter((b) => {
      if (!b || typeof b !== "object") return false;
      const i = b as Loose;
      return typeof i.label === "string" && typeof i.picked === "boolean";
    });
  }

  // final_prompt 兜底:
  //   - Claude 偶发把整个 object 字符串化 → 先用 tryParseJsonish 解一次
  //   - 新结构 = { prompt, size, quality, n, output_format },直接对齐 gpt-image-2 API
  let fpSource: unknown = o.final_prompt;
  if (typeof fpSource === "string") {
    const parsed = tryParseJsonish(fpSource);
    if (parsed && typeof parsed === "object") {
      fpSource = parsed;
    }
  }
  if (fpSource && typeof fpSource === "object") {
    const fp = fpSource as Loose;
    const prompt = typeof fp.prompt === "string" ? fp.prompt : "";
    const size = typeof fp.size === "string" ? fp.size : undefined;
    const quality = typeof fp.quality === "string" ? fp.quality : undefined;
    const n = typeof fp.n === "number" ? fp.n : undefined;
    const output_format =
      typeof fp.output_format === "string" ? fp.output_format : undefined;

    if (prompt || size || quality || n !== undefined || output_format) {
      out.final_prompt = {
        prompt,
        ...(size ? { size } : {}),
        ...(quality ? { quality } : {}),
        ...(n !== undefined ? { n } : {}),
        ...(output_format ? { output_format } : {}),
      };
    }
  }

  return out;
}

function formatZodError(err: unknown): string {
  if (!(err instanceof z.ZodError)) return String(err);
  return err.issues
    .map((i) => {
      const p = i.path
        .map((seg) =>
          typeof seg === "number" ? `[${seg}]` : `.${String(seg)}`
        )
        .join("")
        .replace(/^\./, "");
      return `${p || "<root>"}: ${i.message}`;
    })
    .join("; ");
}

// ── 两阶段通用:单次流式 tool call,只维护一段 raw ──────────

type StreamCtx = {
  send: (event: unknown) => void;
  /** 每累积多少字符触发一次 partial */
  emitEveryChars?: number;
};

/**
 * 跑一次流式 tool call。每累积若干字符触发一次 partial 回调,
 * 流结束返回完整 raw 字符串。分析 / 合成两阶段都用这个函数。
 */
async function runToolStream(
  messages: Parameters<typeof callLLMToolStream>[0],
  tool: Parameters<typeof callLLMToolStream>[1],
  onPartial: (clean: Loose) => void,
  emitEveryChars = 80,
  modelOverride?: string
): Promise<string> {
  let raw = "";
  let lastEmitLen = 0;
  for await (const delta of callLLMToolStream(messages, tool, modelOverride)) {
    raw += delta;
    if (raw.length - lastEmitLen < emitEveryChars) continue;
    lastEmitLen = raw.length;
    try {
      if (!raw.trimStart().startsWith("{")) continue;
      const rough = cleanse(besteffortParse(raw));
      const clean = sanitizePartial(rough);
      if (clean) onPartial(clean);
    } catch {
      // partial parse 失败忽略,等下一个窗口
    }
  }
  return raw;
}

// ── 合并 partial:阶段 2 的 partial 只带 final_prompt,要合进阶段 1 的成品 ──

function mergePartials(
  base: Loose | null,
  patch: Loose
): Loose {
  if (!base) return patch;
  return { ...base, ...patch };
}

export async function POST(req: Request) {
  const { query, llm_model } = await req.json();
  // llm_model 是可选,空 / undefined 时由 lib/llm.ts 用 env LLM_MODEL 兜底。
  const modelOverride = typeof llm_model === "string" ? llm_model : undefined;
  if (typeof query !== "string" || !query.trim()) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", error: "query 不能为空" })}\n\n`,
      { status: 400, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  const cfg = await readConfig();

  const encoder = new TextEncoder();

  const body = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      send({ type: "started" });

      // 累积两阶段的 partial 产物,用于最终 merge 和错误兜底
      let analysisPartial: Loose | null = null;
      let rawAnalysis = "";
      let rawCompose = "";
      const schemaWarnings: Array<{ phase: "analysis" | "compose"; message: string }> = [];

      try {
        // ── 阶段 1:分析 ─────────────────────────────────
        send({ type: "phase", phase: "analysis" });

        const analysisSys = buildAnalysisSystem({
          skillMd: cfg.skill,
          modelProfileMd: cfg.modelProfileMd,
          targetModel: cfg.targetModel,
          enabledRules: cfg.enabledRules,
          hints: cfg.hints,
        });
        const analysisUsr = buildAnalysisUser(query);

        rawAnalysis = await runToolStream(
          [
            { role: "system", content: analysisSys },
            { role: "user", content: analysisUsr },
          ],
          rewriteAnalysisTool,
          (clean) => {
            analysisPartial = clean;
            send({ type: "partial", result: clean });
          },
          80,
          modelOverride
        );

        // 阶段 1 严格校验(soft 策略:挂了也继续,记入 warnings)
        let analysisStrict: AnalysisResult | null = null;
        try {
          const parsed = cleanse(JSON.parse(rawAnalysis));
          analysisStrict = AnalysisResultSchema.parse(parsed);
          analysisPartial = analysisStrict as unknown as Loose;
          send({ type: "partial", result: analysisPartial });
        } catch (e) {
          const msg = formatZodError(e);
          schemaWarnings.push({ phase: "analysis", message: msg });
          console.error("[rewrite:analysis] schema_warning:", msg);
          // 尝试从 raw 最后兜一次 sanitize
          try {
            const rough = cleanse(besteffortParse(rawAnalysis));
            const clean = sanitizePartial(rough);
            if (clean) {
              analysisPartial = clean;
              send({ type: "partial", result: clean, schema_warnings: schemaWarnings });
            }
          } catch {
            // 完全救不回来,analysisPartial 可能仍是流式 partial 的最后一版,继续走阶段 2
          }
        }

        // ── 阶段 2:合成 final_prompt ────────────────────
        send({ type: "phase", phase: "compose" });

        // 即使阶段 1 没拿到 strict,也把 partial 作为 context 喂给阶段 2。
        // 字段缺失时 LLM 自然会按 model profile 补齐,而不是完全失去方向。
        const analysisForCompose = (analysisStrict ??
          analysisPartial ??
          {}) as AnalysisResult;

        const composeSys = buildComposeSystem({
          modelProfileMd: cfg.modelProfileMd,
          targetModel: cfg.targetModel,
        });
        const composeUsr = buildComposeUser({
          query,
          analysis: analysisForCompose,
        });

        rawCompose = await runToolStream(
          [
            { role: "system", content: composeSys },
            { role: "user", content: composeUsr },
          ],
          rewriteFinalPromptTool,
          (clean) => {
            // clean 形如 { final_prompt: {...} },merge 回 analysisPartial
            const merged = mergePartials(analysisPartial, clean);
            send({ type: "partial", result: merged });
          },
          80,
          modelOverride
        );

        // ── 最终组装 ────────────────────────────────────
        // finalPromptStrict:不一定是严格 schema 通过,只要拿到任何可渲染的 final_prompt
        // 对齐 gpt-image-2 原生请求体:{ prompt, size, quality, n, output_format }。
        let finalPromptStrict: FinalPromptLoose | null = null;

        // 四级兜底管线:越往下越"暴力",只要有一级拿到 prompt 就停。
        //   L1 严格 JSON.parse + Zod
        //   L2 best-effort parse + sanitizePartial(结构化字段筛选)
        //   L3 抠出被字符串化的 final_prompt 再正则拆
        //   L4 直接对整段 rawCompose 正则抠
        try {
          const parsed = cleanse(JSON.parse(rawCompose));
          const parsedFp = FinalPromptResultSchema.parse(parsed);
          finalPromptStrict = parsedFp.final_prompt as FinalPromptLoose;
        } catch (e) {
          const msg = formatZodError(e);
          schemaWarnings.push({ phase: "compose", message: msg });
          console.error("[rewrite:compose] schema_warning:", msg);
          // L2
          try {
            const rough = cleanse(besteffortParse(rawCompose));
            const clean = sanitizePartial(rough);
            const fp = clean?.final_prompt as FinalPromptLoose | undefined;
            if (fp && (fp.prompt || fp.size || fp.quality || fp.n || fp.output_format)) {
              finalPromptStrict = fp;
            }
          } catch {
            // L2 fail
          }
          // L3:final_prompt 值被字符串化(外层有 "final_prompt": "{...}")
          if (!finalPromptStrict || !finalPromptStrict.prompt) {
            const fpStringMatch = rawCompose.match(
              /"final_prompt"\s*:\s*"([\s\S]*?)"\s*\}?\s*$/
            );
            if (fpStringMatch) {
              const inner = fpStringMatch[1]
                .replace(/\\n/g, "\n")
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, "\\");
              const extracted = regexExtractFinalPrompt(inner);
              if (extracted && extracted.prompt) {
                finalPromptStrict = extracted;
                console.log("[rewrite:compose] recovered via regex L3");
              }
            }
          }
          // L4:直接对整段 rawCompose 做正则
          if (!finalPromptStrict || !finalPromptStrict.prompt) {
            const extracted = regexExtractFinalPrompt(rawCompose);
            if (extracted && extracted.prompt) {
              finalPromptStrict = extracted;
              console.log("[rewrite:compose] recovered via regex L4");
            }
          }
        }

        // 组装最终 result:优先用 strict 数据,其次用 partial 兜底。
        // 默认 quality 锁定 medium:与 format lab 一致,LLM 自由选 high 时
        // server 强制覆盖,保证历史 / UI / generate-image 三处看到的是同一个值。
        const mergedResult: Loose = {
          ...(analysisPartial ?? {}),
          ...(finalPromptStrict
            ? { final_prompt: { ...finalPromptStrict, quality: "medium" } }
            : {}),
        };

        // 软成功:只要有任何可渲染数据就 done。
        const hasAnything =
          !!analysisPartial && Object.keys(analysisPartial).length > 0;
        const hasFinal =
          !!finalPromptStrict &&
          (!!finalPromptStrict.prompt?.trim() ||
            !!finalPromptStrict.size ||
            !!finalPromptStrict.quality ||
            !!finalPromptStrict.output_format);

        if (hasAnything || hasFinal) {
          send({
            type: "done",
            result: mergedResult,
            raw: rawAnalysis + "\n---\n" + rawCompose,
            soft: true,
            schema_warnings: schemaWarnings,
          });
          return;
        }

        // 彻底没拿到东西才报 error
        send({
          type: "error",
          error: "LLM 未产出任何可渲染数据",
          schema_warnings: schemaWarnings,
          raw: rawAnalysis + "\n---\n" + rawCompose,
        });
      } catch (e) {
        const err = e as LLMError;
        // 网络 / 模型级错误:尽量把已收到的 partial 一起给前端
        send({
          type: "error",
          error: err.message ?? String(e),
          raw: err.raw ?? rawAnalysis + "\n---\n" + rawCompose,
          partial: analysisPartial ?? undefined,
          schema_warnings: schemaWarnings.length ? schemaWarnings : undefined,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
