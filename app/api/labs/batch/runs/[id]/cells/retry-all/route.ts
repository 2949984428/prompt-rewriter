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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  // 同时跑几个 cell(LLM gateway + 生图 gateway 两条都不至于打爆)
  concurrency: z.number().int().min(1).max(16).default(4),
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
  const eligibleForRetry: typeof failed = [];
  for (const cell of failed) {
    const lockKey = `${id}::${cell.query_idx}::${cell.skill_id}`;
    if (!markRunning(lockKey)) {
      skippedLocked++;
      continue;
    }
    // 清旧产物,标 pending(让 SSE 看到状态回退)
    await patchCell(id, cell.query_idx, cell.skill_id, {
      status: "pending",
      final_prompt: null,
      image_urls: null,
      error: null,
      raw: "",
      ms: 0,
    });
    eligibleForRetry.push(cell);
    queued++;
  }

  // 后台 fire-and-forget:Semaphore 限流,跑完每个 cell 都 publishProgress
  void (async () => {
    try {
      const sem = new Semaphore(concurrency);
      // 推一次进度让前端立刻看到状态变化
      await publishProgress(id);
      await Promise.all(
        eligibleForRetry.map((c) =>
          sem.run(async () => {
            try {
              await runCell(
                id,
                record.queries[c.query_idx],
                c.query_idx,
                c.skill_id,
                record.rewrite_llm || undefined,
                labelMap,
                record.include_universal
              );
              await publishProgress(id);
            } finally {
              markDone(`${id}::${c.query_idx}::${c.skill_id}`);
            }
          })
        )
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
