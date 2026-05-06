// prompt-rewriter/app/api/labs/batch/runs/[id]/cells/retry/route.ts
//
// 单格重试:把指定 cell 状态改回 pending,异步重新跑。
// 不影响其他格,不依赖整 run 是否在 running。
//
// 注意:retry 不进 Semaphore(它是单点的),如果用户疯狂点会有 N 个并发。
// 为防爆,markRunning 用一个特殊 key,同 cell 的重试串行化。

import { NextResponse } from "next/server";
import { z } from "zod";
import { readRun, patchCell, patchRecord } from "@/lib/batch-store";
import { runCell, publishProgress } from "@/lib/batch-runner";
import { loadAllLabels } from "@/lib/format-runner";
import { markRunning, markDone } from "@/lib/batch-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  query_idx: z.number().int().min(0),
  skill_id: z.string().min(1),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const { query_idx, skill_id } = parsed.data;

  const record = await readRun(id);
  if (!record) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const cell = record.cells.find(
    (c) => c.query_idx === query_idx && c.skill_id === skill_id
  );
  if (!cell) {
    return NextResponse.json({ error: "cell not found" }, { status: 404 });
  }
  if (cell.status === "running") {
    return NextResponse.json(
      { error: "cell 正在跑,等结束后再重试" },
      { status: 409 }
    );
  }

  // 防同 cell 并发重试:用专属 key
  const lockKey = `${id}::${query_idx}::${skill_id}`;
  if (!markRunning(lockKey)) {
    return NextResponse.json(
      { error: "该 cell 正在重试,请稍候" },
      { status: 409 }
    );
  }

  // 若 record 已经收敛到 terminal(finished 或用户已取消),先拉回 running,
  // 否则 patchCell 完成后 allTerminal 检查会立刻又把 record 标 finished,
  // 客户端 SSE useEffect 检测不到状态变更。
  // cancelled → running 同时也解除 batch-store 的 patchCell silent-no-op 守卫,允许新结果写回。
  if (record.status === "finished" || record.status === "cancelled") {
    await patchRecord(id, { status: "running" });
  }

  // 清空旧产物,回到 pending(让 SSE 看到状态回退)
  await patchCell(id, query_idx, skill_id, {
    status: "pending",
    final_prompt: null,
    image_urls: null,
    error: null,
    raw: "",
    ms: 0,
  });

  const labelMap = await loadAllLabels();
  void (async () => {
    try {
      await runCell(
        id,
        record.queries[query_idx],
        query_idx,
        skill_id,
        record.rewrite_llm || undefined,
        labelMap,
        record.include_universal
      );
      await publishProgress(id);
    } finally {
      markDone(lockKey);
    }
  })();

  return NextResponse.json({ ok: true }, { status: 202 });
}
