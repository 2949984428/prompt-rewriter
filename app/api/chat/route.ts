// prompt-rewriter/app/api/chat/route.ts
//
// 对话 lab 后端:接前端来的 messages 数组(含多模态 content parts) → 走 callLLMStream
// → NDJSON 流式 yield "delta" 事件。前端 readable stream 接,一行一条 JSON。
//
// 不持久化:每条 user message 都全量重发 messages[](无 server-side session)。
// 跟 Pipeline 主路由的 NDJSON 协议一致(easy reuse 前端 reducer 风格)。

import { NextRequest } from "next/server";
import { z } from "zod";
import { callLLMStream } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ContentPartSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("image_url"),
    image_url: z.object({
      url: z.string(),
      detail: z.enum(["auto", "low", "high"]).optional(),
    }),
  }),
]);

const MessageSchema = z.union([
  z.object({ role: z.literal("system"), content: z.string() }),
  z.object({
    role: z.literal("user"),
    content: z.union([z.string(), z.array(ContentPartSchema).min(1)]),
  }),
  z.object({ role: z.literal("assistant"), content: z.string() }),
]);

const RequestSchema = z.object({
  messages: z.array(MessageSchema).min(1),
  llm_model: z.string().optional(),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await req.json());
  } catch (e) {
    return Response.json(
      { error: "请求参数错误", detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const send = (event: { phase: string; data: Record<string, unknown> }) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
        }
      };
      const t0 = Date.now();
      let firstTokenAt = 0;
      let tokenCount = 0;
      try {
        send({ phase: "start", data: {} });
        const iter = callLLMStream(
          body.messages as Parameters<typeof callLLMStream>[0],
          body.llm_model,
        );
        for await (const delta of iter) {
          if (firstTokenAt === 0) {
            firstTokenAt = Date.now();
            console.log(
              `[chat] first token ${firstTokenAt - t0}ms model=${body.llm_model ?? "(default)"}`,
            );
          }
          tokenCount++;
          send({ phase: "delta", data: { content: delta } });
        }
        const total = Date.now() - t0;
        const rate = tokenCount > 0 && total > firstTokenAt - t0
          ? Math.round((tokenCount / ((total - (firstTokenAt - t0)) / 1000)) * 10) / 10
          : 0;
        console.log(
          `[chat] done total=${total}ms first=${firstTokenAt - t0}ms tokens=${tokenCount} rate=${rate}/s`,
        );
        send({ phase: "done", data: {} });
      } catch (e) {
        send({
          phase: "error",
          data: { error: e instanceof Error ? e.message : String(e) },
        });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
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
