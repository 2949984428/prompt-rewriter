// prompt-rewriter/app/api/labs/batch/runs/[id]/stream/route.ts
//
// SSE:订阅一个 run 的执行事件流。
//
// 协议:
//   event: cell      data: { query_idx, skill_id, patch: Partial<BatchCell> }
//   event: progress  data: { done, failed, excluded, total }
//   event: finished  data: { id }
//
// 前端用法:
//   const es = new EventSource("/api/labs/batch/runs/<id>/stream");
//   es.addEventListener("cell", e => merge(JSON.parse(e.data)));
//   ...
//
// 一旦收到 finished 或连接错误,前端可关闭 EventSource。
// 重连策略:前端拿不到 cell:done 但 record.status === "finished" 时,直接 GET /runs/[id] 拿快照。

import { subscribe, isRunning } from "@/lib/batch-bus";
import { readRun } from "@/lib/batch-store";
import { progressOf } from "@/lib/batch-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;

function sseFrame(event: string, data: unknown): Uint8Array {
  const payload =
    `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
  return new TextEncoder().encode(payload);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const record = await readRun(id);
  if (!record) {
    return new Response("not found", { status: 404 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 1. 入口 snapshot:推 progress + 把所有非 pending cells 的最新状态推一遍。
      //    cells snapshot 的存在意义:SSE 重连(浏览器 retry / dev hot-reload / 之前 SSE
      //    被污染的 state)时,前端 record state 一次性被纠正,不需要刷页面。
      //    pending cell 不推(等价 server-side 默认状态,推它浪费带宽)。
      const p = progressOf(record);
      controller.enqueue(sseFrame("progress", p));
      for (const c of record.cells) {
        if (c.status === "pending") continue;
        controller.enqueue(
          sseFrame("cell", {
            query_idx: c.query_idx,
            skill_id: c.skill_id,
            image_model: c.image_model ?? "",
            patch: {
              status: c.status,
              final_prompt: c.final_prompt,
              image_urls: c.image_urls,
              scores: c.scores,
              note: c.note,
              error: c.error,
              raw: c.raw,
              ms: c.ms,
            },
          })
        );
      }
      // 已经 terminal 的 run(finished 或用户取消):推一次 finished 后让前端关连接
      if (record.status === "finished" || record.status === "cancelled") {
        controller.enqueue(sseFrame("finished", { id }));
      }

      // 2. 订阅总线
      const unsubscribe = subscribe(id, (ev) => {
        try {
          if (ev.type === "cell") {
            controller.enqueue(
              sseFrame("cell", {
                query_idx: ev.query_idx,
                skill_id: ev.skill_id,
                // 多 model 改造后必须透传:同 (q, s) 可能有多 cell(不同 model),
                // 客户端没这个字段就会退化成"按 (q, s) 匹第一条",GPT-2/NB2 永远不更新。
                image_model: ev.image_model,
                patch: ev.patch,
              })
            );
          } else if (ev.type === "progress") {
            controller.enqueue(
              sseFrame("progress", {
                done: ev.done,
                failed: ev.failed,
                excluded: ev.excluded,
                total: ev.total,
              })
            );
          } else if (ev.type === "finished") {
            controller.enqueue(sseFrame("finished", { id }));
          }
        } catch {
          // controller 可能已 closed,忽略
        }
      });

      // 3. 心跳:防代理 / 浏览器空闲断流
      const hb = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(`: heartbeat\n\n`));
        } catch {
          /* closed */
        }
      }, HEARTBEAT_MS);

      // 4. 连接关闭:清订阅 + 心跳
      const cleanup = () => {
        clearInterval(hb);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      // ReadableStream 没有"客户端断开"原生回调,靠 controller.error / 取消信号
      // Next.js Edge / Node 都能在客户端断开时触发 cancel
      (this as unknown as { __cleanup?: () => void }).__cleanup = cleanup;

      // 5. 兜底:如果 run 已经不在 running,且没有事件来,heartbeat 内主动 close
      // (留给前端通过 GET snapshot + finished 自洽)
      if (!isRunning(id) && record.status !== "running") {
        // 不立刻 close,留 200ms 给客户端有机会接到 progress / finished
        setTimeout(cleanup, 200);
      }
    },
    cancel() {
      const cleanup = (this as unknown as { __cleanup?: () => void })
        .__cleanup;
      if (cleanup) cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
