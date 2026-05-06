// prompt-rewriter/app/api/llm-models/route.ts
//
// 暴露可选 LLM 列表给前端。
//   GET → { default, available: [{ id, label, provider, notes }] }
// 后续若要支持"用户改默认 / 加新模型",再补 PUT。

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { LLMModelsConfigSchema } from "@/lib/schema-llm-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE = path.join(process.cwd(), "data", "llm-models.json");

export async function GET() {
  try {
    const text = await fs.readFile(FILE, "utf-8");
    const data = LLMModelsConfigSchema.parse(JSON.parse(text));
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: "无法加载 llm-models 配置", detail: String(e) },
      { status: 500 }
    );
  }
}
