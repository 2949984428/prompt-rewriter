// prompt-rewriter/app/api/image-generators/route.ts
//
// 暴露"可选生图模型"列表给前端。前端拿来填 ImageModelSwitcher 下拉。
//
// 数据合并两路:
//   1) 内部 image gateway 的 gpt-image-2(env IMAGE_MODEL,默认 "gpt-image-2")
//      —— 我们没有它的 list endpoint,硬编码一个 entry
//   2) Lovart Agent Generator 的 57 个模型(types = image / image-modify / video / video-modify / font)
//      —— 只过滤出 image + image-modify,demo 阶段视频/字体先不上 UI(没图像 lab 接得住)
//
// 缓存:Lovart 的 list 不带认证,且基本是静态清单,缓存 5min。
// 走 process 内存,Next dev hot-reload 可能清掉缓存 —— demo 阶段无所谓。

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import {
  listGenerators,
  getGeneratorsSchema,
  resolveSchemaKey,
  type LovartGenerator,
  type LovartOpenAPISchema,
} from "@/lib/lovart-agent-client";
import {
  ConstraintsFileSchema,
  resolveConstraints,
  resolveConstraintsWithSchema,
  type ConstraintsFile,
  type ModelConstraints,
} from "@/lib/model-constraints";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 5 * 60 * 1000;
const CONSTRAINTS_FILE = path.join(process.cwd(), "data", "model-constraints.json");

let cached: { ts: number; data: LovartGenerator[] } | null = null;
let cachedSchema: { ts: number; data: LovartOpenAPISchema } | null = null;
let cachedConstraints: { ts: number; data: ConstraintsFile } | null = null;

async function loadLovartGenerators(): Promise<LovartGenerator[]> {
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }
  const items = await listGenerators();
  cached = { ts: Date.now(), data: items };
  return items;
}

// 拉全平台 schema(135 个 component schemas 的 OpenAPI 大文档)。带 auth header。
// 失败不致命(返回 null,fallback 走 model-constraints.json)。
async function loadLovartSchema(): Promise<LovartOpenAPISchema | null> {
  if (cachedSchema && Date.now() - cachedSchema.ts < CACHE_TTL_MS) {
    return cachedSchema.data;
  }
  try {
    const s = await getGeneratorsSchema();
    cachedSchema = { ts: Date.now(), data: s };
    return s;
  } catch {
    return null;
  }
}

async function loadConstraintsFile(): Promise<ConstraintsFile> {
  if (cachedConstraints && Date.now() - cachedConstraints.ts < CACHE_TTL_MS) {
    return cachedConstraints.data;
  }
  const text = await fs.readFile(CONSTRAINTS_FILE, "utf-8");
  const data = ConstraintsFileSchema.parse(JSON.parse(text));
  cachedConstraints = { ts: Date.now(), data };
  return data;
}

export type ImageGeneratorEntry = {
  name: string; // 路由用模型名,"gpt-image-2" 或 "vendor/name"
  display_name: string;
  icon: string;
  description: string;
  type: "image" | "image-modify" | string;
  provider: "igw" | "lovart";
  // 合并后的有效约束(default + provider + model 三层 overlay)。
  // 前端 ImageUploader / ImageModelSwitcher 直接读这里,不再硬编码。
  constraints: ModelConstraints;
};

export async function GET() {
  const igwModel = (process.env.IMAGE_MODEL ?? "gpt-image-2").trim() || "gpt-image-2";

  let cf: ConstraintsFile;
  try {
    cf = await loadConstraintsFile();
  } catch (e) {
    return NextResponse.json(
      { error: "model-constraints.json 加载失败", detail: String(e) },
      { status: 500 }
    );
  }

  const igwEntry: ImageGeneratorEntry = {
    name: igwModel,
    display_name: "GPT Image 2(内部)",
    icon: "",
    description: "内部生图网关默认模型,A/B 改写实验的 baseline",
    type: "image",
    provider: "igw",
    // IGW 不在 Lovart schema 里,只走文件 overlay
    constraints: resolveConstraints(igwModel, cf),
  };

  try {
    const [lovart, schema] = await Promise.all([
      loadLovartGenerators(),
      loadLovartSchema(),
    ]);
    const items: ImageGeneratorEntry[] = lovart
      .filter((g) => g.type === "image" || g.type === "image-modify")
      .map((g) => ({
        name: g.name,
        display_name: g.display_name,
        icon: g.icon,
        description: g.description,
        type: g.type,
        provider: "lovart" as const,
        // 文件兜底 + schema 真实数据(schema 优先覆盖)
        constraints: resolveConstraintsWithSchema(
          g.name,
          cf,
          schema,
          resolveSchemaKey
        ),
      }));
    return NextResponse.json({
      default: igwEntry.name,
      items: [igwEntry, ...items],
      schema_loaded: schema !== null,
    });
  } catch (e) {
    return NextResponse.json({
      default: igwEntry.name,
      items: [igwEntry],
      warn: `Lovart 模型列表加载失败:${String(e)}`,
    });
  }
}
