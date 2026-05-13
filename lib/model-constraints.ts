// prompt-rewriter/lib/model-constraints.ts
//
// 生图模型的输入/输出约束元数据。
//
// 三层兜底:
//   1. data/model-constraints.json 里 per-model 显式写的(从厂商官方文档抄)
//   2. provider 级 fallback(igw / lovart 各一份默认,反映各自网关的兜底口径)
//   3. 全局 default(最保守的一组值,所有都拿不到时用)
//
// 改 prompt-rewriter 任意 lab 上传参考图前,先调 resolveConstraints(modelName) 拿真值。
//
// 大规则不变 = 这里 schema 固定;小幅适配 = data/model-constraints.json 里 per-model overlay。

import { z } from "zod";

// ─────────────────────── Schema ───────────────────────

const SourceSchema = z.object({
  kind: z.enum(["vendor_docs", "lovart_api", "empirical", "unknown"]),
  url: z.string().url().optional(),
  // ISO 8601 日期,人工核对当天写入。超过 90 天的项前端会标"过期待核"。
  verified_at: z.string().optional(),
  note: z.string().optional(),
});

const ReferenceImageConstraintsSchema = z.object({
  max_bytes: z.number().int().positive(),
  max_count: z.number().int().positive(),
  // MIME type 列表
  accepted_formats: z.array(z.string()).min(1),
  // 单边长度像素上限(>该值需要前端缩或后端拒)
  max_dimension_px: z.number().int().positive().optional(),
  min_dimension_px: z.number().int().positive().optional(),
  // 是否支持 multi-reference(blend);某些 image-modify 模型只接 1 张
  supports_multi: z.boolean().default(true),
});

const OutputConstraintsSchema = z.object({
  // 该模型实际支持的 aspect ratio 集合(用 "W:H" 字符串)
  aspect_ratios: z.array(z.string()).min(1),
  // resolution 预设(从 schema 的 properties.resolution.enum 抽出),如 ["1K","2K","4K"] 或 ["512*1536",...]
  // 跟 aspect_ratios 区分开:aspect 是"形状",resolution 是"尺寸档位"
  resolutions: z.array(z.string()).optional(),
  // 输出最大总像素(W*H)
  max_pixels: z.number().int().positive().optional(),
  output_formats: z.array(z.enum(["png", "jpeg", "webp"])).min(1),
  // 是否支持透明背景
  supports_transparent: z.boolean().default(false),
});

const PromptConstraintsSchema = z.object({
  max_chars: z.number().int().positive().optional(),
  // 人类语言提示,demo 阶段不强校,只 UI hint 用
  languages_hint: z.string().optional(),
});

export const ModelConstraintsSchema = z.object({
  // 该 model 的人类可读用途(给前端 ⓘ tooltip)
  capability: z.enum(["text-to-image", "image-edit", "remove-bg", "upscale", "vectorize", "expand", "other"]).optional(),
  reference_image: ReferenceImageConstraintsSchema.partial().optional(),
  output: OutputConstraintsSchema.partial().optional(),
  prompt: PromptConstraintsSchema.partial().optional(),
  source: SourceSchema.optional(),
});
export type ModelConstraints = z.infer<typeof ModelConstraintsSchema>;

// 数据文件格式:provider/model → constraints
export const ConstraintsFileSchema = z.object({
  // 全局默认(最保守的)
  _default: ModelConstraintsSchema,
  // provider 级覆盖
  _igw: ModelConstraintsSchema.optional(),
  _lovart: ModelConstraintsSchema.optional(),
  // per-model: key = model name(igw 单名 / "vendor/anon-bob" 这类)
  models: z.record(z.string(), ModelConstraintsSchema),
});
export type ConstraintsFile = z.infer<typeof ConstraintsFileSchema>;

// ─────────────────────── 合并逻辑 ───────────────────────

/**
 * 三层合并:default → provider → model overlay。
 * 每个嵌套对象浅合并(reference_image / output / prompt 各自独立浅合并),
 * source 字段保留 model 层的(因为这是该层最权威的来源标注)。
 */
export function mergeConstraints(
  layers: ModelConstraints[]
): ModelConstraints {
  const out: ModelConstraints = {};
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.capability) out.capability = layer.capability;
    if (layer.reference_image) {
      out.reference_image = { ...out.reference_image, ...layer.reference_image };
    }
    if (layer.output) {
      out.output = { ...out.output, ...layer.output };
    }
    if (layer.prompt) {
      out.prompt = { ...out.prompt, ...layer.prompt };
    }
    if (layer.source) out.source = layer.source;
  }
  return out;
}

/**
 * 给定 model 名 + 已加载的 ConstraintsFile,算出最终该 model 的有效约束。
 * provider 判定走 model 是否含 "/":含 → lovart,否则 → igw(跟 image-router 一致)。
 */
export function resolveConstraints(
  model: string,
  file: ConstraintsFile
): ModelConstraints {
  const provider: "igw" | "lovart" = model.includes("/") ? "lovart" : "igw";
  const layers: ModelConstraints[] = [file._default];
  const providerLayer = provider === "igw" ? file._igw : file._lovart;
  if (providerLayer) layers.push(providerLayer);
  const modelLayer = file.models[model];
  if (modelLayer) layers.push(modelLayer);
  return mergeConstraints(layers);
}

// ─────────────────────── 从 Lovart OpenAPI schema 抽 constraints ───────────────────────

import type {
  LovartOpenAPISchema,
  LovartSchemaObject,
  LovartSchemaProperty,
} from "./lovart-agent-client";

/**
 * 把 *Request schema 转成 ModelConstraints 的 partial:
 *   - properties.aspect_ratio.enum → output.aspect_ratios
 *   - properties.image.maxItems → reference_image.max_count
 *   - x-capabilities.modes 含 "image-to-image" → 支持参考图
 *   - properties.prompt.minLength/maxLength → prompt 约束
 *   - properties.resolution.enum → 备份给 output(resolution preset)
 *
 * **bytes / accepted formats 字段 schema 不暴露**,这两项继续走 model-constraints.json 兜底。
 */
export function constraintsFromSchema(
  reqSchema: LovartSchemaObject,
  enumLookup?: (refOrName: string) => LovartSchemaObject | null
): ModelConstraints {
  const out: ModelConstraints = {};
  const props = reqSchema.properties ?? {};

  // 解析一个 property 的 enum:可能直接在 .enum,也可能通过 $ref 引用别的 schema 的 enum
  const readEnum = (p?: LovartSchemaProperty): string[] | undefined => {
    if (!p) return;
    if (p.enum) return p.enum.map(String);
    const ref =
      p.$ref ??
      p.allOf?.[0]?.$ref ??
      (p.items?.$ref ? p.items.$ref : undefined);
    if (ref && enumLookup) {
      const name = ref.split("/").pop();
      if (name) {
        const s = enumLookup(name);
        if (s?.enum) return s.enum.map(String);
      }
    }
  };

  // 输出 aspect_ratios
  const ars = readEnum(props.aspect_ratio);
  if (ars && ars.length > 0) {
    out.output = { ...(out.output ?? {}), aspect_ratios: normalizeAspects(ars) };
  }

  // 输出 resolution 预设(NBP / Seedream 1K/2K/4K;Ideogram 是具体像素串)
  const res = readEnum(props.resolution);
  if (res && res.length > 0) {
    out.output = { ...(out.output ?? {}), resolutions: res };
  }

  // 参考图张数 + 是否支持
  if (props.image) {
    const maxItems = props.image.maxItems;
    out.reference_image = {
      ...(out.reference_image ?? {}),
      ...(maxItems ? { max_count: maxItems } : {}),
      supports_multi: (maxItems ?? 1) > 1,
    };
  }
  if (props.image_url || props.image_urls) {
    out.reference_image = {
      ...(out.reference_image ?? {}),
      supports_multi: Boolean(props.image_urls),
    };
  }

  // prompt 长度
  if (props.prompt) {
    const pc: NonNullable<ModelConstraints["prompt"]> = {};
    if (props.prompt.maxLength) pc.max_chars = props.prompt.maxLength;
    if (Object.keys(pc).length > 0) out.prompt = pc;
  }

  // capability
  const modes = reqSchema["x-capabilities"]?.modes ?? [];
  const modeNames = modes.map((m) => m.mode);
  if (modeNames.includes("image-to-image") && modeNames.includes("text-to-image")) {
    out.capability = "image-edit"; // 实际"双模式"算图生图(更具描述性)
  } else if (modeNames.includes("text-to-image")) {
    out.capability = "text-to-image";
  } else if (modeNames.includes("image-to-image")) {
    out.capability = "image-edit";
  }

  return out;
}

/** 把 "16:9" / "16x9" / "1.91:1" 等不同写法归一为 "W:H"。 */
function normalizeAspects(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of arr) {
    const v = a.replace(/x/i, ":");
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/**
 * 给定 model name + 全 schema + 文件兜底,算出有效约束。
 * 优先级:文件 _default → provider → model file overlay → schema-derived。
 * schema 数据放最后是因为它最权威(直接从 Lovart 接口拿),覆盖 empirical 兜底。
 */
export function resolveConstraintsWithSchema(
  model: string,
  file: ConstraintsFile,
  schema: LovartOpenAPISchema | null,
  resolveSchemaKey: (m: string, s: LovartOpenAPISchema) => string | null
): ModelConstraints {
  const base = resolveConstraints(model, file);
  if (!schema) return base;
  const key = resolveSchemaKey(model, schema);
  if (!key) return base;
  const reqSchema = schema.components.schemas[key];
  if (!reqSchema) return base;
  const enumLookup = (name: string): LovartSchemaObject | null =>
    schema.components.schemas[name] ?? null;
  const fromSchema = constraintsFromSchema(reqSchema, enumLookup);
  const merged = mergeConstraints([base, fromSchema]);

  // source 标识规则:
  //   - file.models[model].source.kind === "vendor_docs" → 优先(说明已经人工核过厂商文档)
  //   - 否则 → 用 schema 来源(lovart_api),让 UI 能区分"经厂商核实" vs "靠 Lovart 自报"
  const modelOverlay = file.models[model];
  const hasVerified = modelOverlay?.source?.kind === "vendor_docs";
  if (!hasVerified) {
    merged.source = {
      kind: "lovart_api",
      url: "/api/v1/generator/schema",
      verified_at: new Date().toISOString().slice(0, 10),
      note: `从 schema key ${key} 提取`,
    };
  }
  return merged;
}
