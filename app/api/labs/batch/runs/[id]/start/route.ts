// prompt-rewriter/app/api/labs/batch/runs/[id]/start/route.ts
//
// 启动后台执行:
//   - 把 record.status 改成 running
//   - 用 Semaphore 并发跑所有 pending cells
//   - 立即返回 202;真实执行在 background
//
// 每个 cell 完成 / 失败都会:
//   - patchCell 写盘
//   - publish(cell:...)
//   - 顺带 publishProgress(汇总进度)
//
// 前端拿到 202 后立刻去开 SSE,从那一刻起接所有事件。

import { NextResponse } from "next/server";
import { z } from "zod";
import { Semaphore, readRun, patchRecord } from "@/lib/batch-store";
import { runCell, publishProgress } from "@/lib/batch-runner";
import { isRunning, markRunning, markDone, publish } from "@/lib/batch-bus";
import { loadAllLabels } from "@/lib/format-runner";
import {
  providerOf,
  getProviderConcurrency,
  type ImageProvider,
} from "@/lib/concurrency-policy";
import type { BatchCell } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  // 老字段:多 model 改造前是"全局 cell 并发上限"。
  // 现在改成 per-provider 共享池(见 lib/concurrency-policy),此字段语义降级为"全部 provider 池都用这个 cap"的强 override。
  // 不传 → 走 policy 默认(igw=8 / lovart=12)。
  concurrency: z.number().int().min(1).max(16).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // 允许空 body(取默认 concurrency)
  let bodyJson: unknown = {};
  try {
    bodyJson = await req.json();
  } catch {
    bodyJson = {};
  }
  const parsed = RequestSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const { concurrency } = parsed.data;

  const record = await readRun(id);
  if (!record) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // 心跳锁(lib/batch-bus.ts):
  //   - 真的有 runner 在跑(60s 内有心跳)→ markRunning 返 false,short-circuit 返 202
  //   - 老 runner 死了(无心跳 > 60s,典型场景:dev hot-reload kill async)→ markRunning 自动 takeover,继续跑
  // 不再需要 force 参数;锁的生命周期跟 runner 自身绑定。
  if (!markRunning(id)) {
    return NextResponse.json(
      { ok: true, already_running: true },
      { status: 202 }
    );
  }

  await patchRecord(id, { status: "running" });

  // 后台 fire-and-forget;return 之后才执行
  const labelMap = await loadAllLabels();
  void (async () => {
    try {
      const fresh = await readRun(id);
      if (!fresh) return;
      const pendingCells = fresh.cells.filter((c) => c.status === "pending");
      await publishProgress(id); // 先推一次 progress(让前端拿到 total)

      // ── per-provider 并发池 ──
      // 实测:Lovart 网关 token-level in-flight 上限 = 15(超出返 1200000200),
      // 所以同 provider 下的所有 model **共享**一个池(而不是 per-model 独立)。
      // 跨 provider 互相独立(IGW 跟 Lovart 互不挤压)。
      const cellsByProvider = new Map<ImageProvider, BatchCell[]>();
      for (const c of pendingCells) {
        const effModel = c.image_model || fresh.image_model || "";
        const p = providerOf(effModel);
        const arr = cellsByProvider.get(p);
        if (arr) arr.push(c);
        else cellsByProvider.set(p, [c]);
      }

      await Promise.all(
        Array.from(cellsByProvider.entries()).map(async ([provider, cellsOfProvider]) => {
          const cap = concurrency ?? getProviderConcurrency(provider);
          const sem = new Semaphore(cap);
          await Promise.all(
            cellsOfProvider.map((c) =>
              sem.run(async () => {
                // 方案 C:per_query 优先,空 / 越界 fallback 到 record 级 reference_images
                const perQ = fresh.per_query_reference_images?.[c.query_idx];
                const effRefImages =
                  perQ && perQ.length > 0 ? perQ : fresh.reference_images;
                await runCell(
                  id,
                  fresh.queries[c.query_idx],
                  c.query_idx,
                  c.skill_id,
                  fresh.rewrite_llm || undefined,
                  labelMap,
                  fresh.include_universal,
                  effRefImages,
                  c.image_model || fresh.image_model,
                  {
                    imageModelIds: fresh.image_model_ids,
                    recordImageModel: fresh.image_model,
                  },
                  // Phase 2:test_kind + pipeline_id 透传
                  fresh.test_kind,
                  c.pipeline_id
                );
                await publishProgress(id);
              })
            )
          );
        })
      );
      // 最终态 publish(publishProgress 会发 finished,这里兜底)
      await publishProgress(id);
    } catch (e) {
      // 后台炸了:发一个错误事件让前端知道
      publish(id, {
        type: "cell",
        query_idx: -1,
        skill_id: "__runner__",
        patch: { error: `runner crashed: ${String(e)}` },
      });
    } finally {
      markDone(id);
    }
  })();

  return NextResponse.json(
    { ok: true, concurrency: concurrency ?? "per-model-policy" },
    { status: 202 }
  );
}
