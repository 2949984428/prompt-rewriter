// prompt-rewriter/app/api/labs/batch/runs/[id]/cells/retry-all/route.ts
//
// POST → 把当前 record 里所有 status=failed 的 cell 一次性重新跑。
//
// 流程跟 /start 平行(也用 Semaphore 控并发,默认 4),区别只在:
//   - 不是跑所有 pending,只跑 failed
//   - 跑前先 patchRecord(status: "running")  → 让前端 SSE 重连(否则 finished 状态下 SSE 已关)
//   - 每个 failed cell 走单 cell 锁(跟 /cells/retry 一致),防跟单点重试并发踩
//
// 立刻返回 202 + 统计;真实重试在 background 跑。前端通过 SSE 看 cell 状态翻转。

import { NextResponse } from "next/server";
import { z } from "zod";
import { Semaphore, readRun, patchRecord, patchCell } from "@/lib/batch-store";
import { runCell, publishProgress } from "@/lib/batch-runner";
import { markRunning, markDone, publish } from "@/lib/batch-bus";
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
  // 老字段:多 model 改造后语义降级为"未指定 model 时的兜底"。
  // 主要并发上限由 lib/concurrency-policy 按 per-model 决定。
  concurrency: z.number().int().min(1).max(16).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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

  // 防跟 /start 或另一次 /retry-all 并发(共享 run-level lockKey)
  if (!markRunning(id)) {
    return NextResponse.json(
      {
        error: "another batch operation (start or retry-all) is in progress",
      },
      { status: 409 }
    );
  }

  const failed = record.cells.filter((c) => c.status === "failed");
  if (failed.length === 0) {
    markDone(id);
    return NextResponse.json({
      ok: true,
      found: 0,
      queued: 0,
      skipped_locked: 0,
      message: "no failed cells",
    });
  }

  // 顺序很关键:先 patchRecord 把 status 拉回 running,
  // 再 patchCell 把 failed cells 改 pending。否则 patchCell 内部
  // auto-converge 会因 (cells 全 terminal) 把 status 又设回 finished。
  await patchRecord(id, { status: "running" });

  const labelMap = await loadAllLabels();
  let queued = 0;
  let skippedLocked = 0;

  // 单 cell 锁:与 /cells/retry 共用同一锁 key,防跟单点重试并发踩
  // 三维定位:加 image_model 到 lockKey
  const eligibleForRetry: typeof failed = [];
  for (const cell of failed) {
    const effModel = cell.image_model ?? "";
    const lockKey = `${id}::${cell.query_idx}::${cell.skill_id}::${effModel}`;
    if (!markRunning(lockKey)) {
      skippedLocked++;
      continue;
    }
    // 清旧产物,标 pending(让 SSE 看到状态回退)
    await patchCell(
      id,
      cell.query_idx,
      cell.skill_id,
      {
        status: "pending",
        final_prompt: null,
        image_urls: null,
        error: null,
        raw: "",
        ms: 0,
      },
      effModel
    );
    eligibleForRetry.push(cell);
    queued++;
  }

  // 后台 fire-and-forget:**per-model 独立 Semaphore**,跑完每个 cell 都 publishProgress
  void (async () => {
    try {
      await publishProgress(id);

      // 按 provider 分组(同 provider 下所有 model 共享一个池;跨 provider 独立)
      // 原因见 lib/concurrency-policy.ts:Lovart token-level in-flight ≤ 15
      const cellsByProvider = new Map<ImageProvider, BatchCell[]>();
      for (const c of eligibleForRetry) {
        const effModel = c.image_model || record.image_model || "";
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
                const cellModel = c.image_model ?? "";
                try {
                  // 方案 C:per_query 优先,空 / 越界 fallback record.reference_images
                  const perQ = record.per_query_reference_images?.[c.query_idx];
                  const effRefImages =
                    perQ && perQ.length > 0 ? perQ : record.reference_images;
                  await runCell(
                    id,
                    record.queries[c.query_idx],
                    c.query_idx,
                    c.skill_id,
                    record.rewrite_llm || undefined,
                    labelMap,
                    record.include_universal,
                    effRefImages,
                    cellModel || record.image_model,
                    {
                      imageModelIds: record.image_model_ids,
                      recordImageModel: record.image_model,
                    },
                    record.test_kind,
                    c.pipeline_id ?? ""
                  );
                  await publishProgress(id);
                } finally {
                  markDone(`${id}::${c.query_idx}::${c.skill_id}::${cellModel}`);
                }
              })
            )
          );
        })
      );
      await publishProgress(id);
    } catch (e) {
      publish(id, {
        type: "cell",
        query_idx: -1,
        skill_id: "__retry_all__",
        patch: { error: `retry-all crashed: ${String(e)}` },
      });
    } finally {
      markDone(id); // run-level lock 释放
    }
  })();

  return NextResponse.json(
    { ok: true, found: failed.length, queued, skipped_locked: skippedLocked },
    { status: 202 }
  );
}
