// prompt-rewriter/app/api/compress-reference-image/route.ts
//
// 接收原图 base64 + 当前选中模型名,压到该模型 max_bytes 以下后回 client。
// 上层 ImageUploader 用:用户选完文件 → POST 这里 → 拿回压缩好的 base64 存进 state。

import { NextResponse } from "next/server";
import { z } from "zod";
import { promises as fs } from "fs";
import path from "path";
import { compressImageIfNeeded } from "@/lib/image-compress";
import {
  ConstraintsFileSchema,
  resolveConstraintsWithSchema,
} from "@/lib/model-constraints";
import {
  getGeneratorsSchema,
  resolveSchemaKey,
} from "@/lib/lovart-agent-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// base64 大图传上来,放宽 body 上限
export const maxDuration = 60;

const CONSTRAINTS_FILE = path.join(process.cwd(), "data", "model-constraints.json");

const BodySchema = z.object({
  dataUrl: z.string().min(1),
  model: z.string().default(""), // 空 → 用默认 / IGW
});

export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: "invalid body", detail: String(e) },
      { status: 400 }
    );
  }

  // 拿当前 model 的 constraints(file + schema 合并;schema 拉不到也无所谓,走文件兜底)
  let cf;
  try {
    const text = await fs.readFile(CONSTRAINTS_FILE, "utf-8");
    cf = ConstraintsFileSchema.parse(JSON.parse(text));
  } catch (e) {
    return NextResponse.json(
      { error: "constraints load failed", detail: String(e) },
      { status: 500 }
    );
  }
  let schema = null;
  try {
    schema = await getGeneratorsSchema();
  } catch {
    /* 可选 */
  }

  const modelName = body.model || "gpt-image-2";
  const c = resolveConstraintsWithSchema(modelName, cf, schema, resolveSchemaKey);
  const targetBytes = c.reference_image?.max_bytes ?? 1.5 * 1024 * 1024;
  const maxDim = c.reference_image?.max_dimension_px;

  try {
    const result = await compressImageIfNeeded({
      dataUrl: body.dataUrl,
      targetBytes,
      maxDimensionPx: maxDim,
    });
    return NextResponse.json({
      ok: true,
      model: modelName,
      target_bytes: targetBytes,
      ...result,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: String(e),
        model: modelName,
        target_bytes: targetBytes,
      },
      { status: 422 }
    );
  }
}
