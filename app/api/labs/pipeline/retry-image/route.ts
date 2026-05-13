// prompt-rewriter/app/api/labs/pipeline/retry-image/route.ts
//
// Step 3 单格手动重试。点 Pipeline 卡片上的「重试」按钮 → 这个 endpoint。
// 流式 NDJSON,跟 POST /api/labs/pipeline 的 step3_item / step3_item_progress
// 完全相同 schema,前端可以复用同一份 reducer。

import { NextRequest } from "next/server";
import { z } from "zod";
import { runImageWithRetry } from "@/lib/pipeline-image-runner";
import { uploadDataUrlToR2 } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RetryBodySchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  image_model: z.string().optional(),
  // 单格 retry 也要带 size,前端从原 step3_item 透传(缺省 fallback 1024x1024)
  size: z.string().optional(),
  reference_images: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof RetryBodySchema>;
  try {
    const json = await req.json();
    body = RetryBodySchema.parse(json);
  } catch (e) {
    return Response.json(
      {
        error: "request 参数错误",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 400 },
    );
  }

  const imageModel = body.image_model || "gpt-image-2";
  // 跟主 POST 路由同款:base64 data URL 先转 R2 公网 URL,失败 502 抛回(不 fallback base64)
  let refs: string[];
  try {
    refs = await Promise.all(
      (body.reference_images ?? []).map((r) =>
        r.startsWith("data:")
          ? uploadDataUrlToR2(r, "pipeline-ref")
          : Promise.resolve(r),
      ),
    );
  } catch (e) {
    return Response.json(
      {
        error: "参考图上传 R2 失败",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }
  const size = body.size || "1024x1024";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (msg: {
        phase: "step3_item_progress" | "step3_item";
        data: Record<string, unknown>;
      }) => {
        controller.enqueue(encoder.encode(JSON.stringify(msg) + "\n"));
      };

      try {
        await runImageWithRetry({
          id: body.id,
          prompt: body.prompt,
          imageModel,
          size,
          referenceImages: refs,
          emit: send,
          manualRetry: true,
        });
      } catch (e) {
        // 兜底:runImageWithRetry 自己不抛,但万一抛了走这里
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              phase: "step3_item",
              data: {
                id: body.id,
                prompt: body.prompt,
                image_urls: [],
                error: e instanceof Error ? e.message : String(e),
                elapsed_ms: 0,
                status: "failed",
              },
            }) + "\n",
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
