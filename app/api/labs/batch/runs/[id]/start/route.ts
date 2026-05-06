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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  // 同时跑的 cell 数:默认 4(LLM gateway + 生图 gateway 两条都不至于打爆)
  concurrency: z.number().int().min(1).max(16).default(4),
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

  // 重复 start 防御:已经在跑就直接 202(幂等),不抛
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
      const sem = new Semaphore(concurrency);
      const fresh = await readRun(id);
      if (!fresh) return;
      const pendingCells = fresh.cells.filter((c) => c.status === "pending");
      // 先推一次 progress(让前端拿到 total)
      await publishProgress(id);
      await Promise.all(
        pendingCells.map((c) =>
          sem.run(async () => {
            await runCell(
              id,
              fresh.queries[c.query_idx],
              c.query_idx,
              c.skill_id,
              fresh.rewrite_llm || undefined,
              labelMap,
              fresh.include_universal
            );
            await publishProgress(id);
          })
        )
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

  return NextResponse.json({ ok: true, concurrency }, { status: 202 });
}
