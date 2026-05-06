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
      // 1. 入口 snapshot:把当前进度推一次,让前端立刻有数(不依赖后续 cell 事件)
      const p = progressOf(record);
      controller.enqueue(sseFrame("progress", p));
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
