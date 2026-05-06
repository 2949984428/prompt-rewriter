// prompt-rewriter/app/api/labs/batch/runs/[id]/cancel/route.ts
//
// POST → 用户主动取消整 run。
//
// 流程:
//   - cancelRun() 原子性地把 record.status 改成 "cancelled"、所有 pending/running cells 改成 failed("用户已取消")
//   - publish "finished" 事件让 SSE 客户端关闭连接(对前端来说,cancel 跟 finish 都是 terminal)
//   - markDone(id) 释放 run-level lock,让用户能立刻在同 run 上做单格重试 / retry-all
//
// 关于"in-flight" cells:
//   - 已发出去的 LLM 调用 / 生图轮询无法中断(没有 AbortController 接入),会跑到底
//   - 但 patchCell 在 record.status === "cancelled" 时 silent no-op,迟到的结果不会污染数据
//   - 所以用户体感是"立刻全停"(UI 上所有未完成 cell 立刻变 failed),实际后台 LLM 跑完就跑完不影响

import { NextResponse } from "next/server";
import { cancelRun } from "@/lib/batch-store";
import { publish, markDone } from "@/lib/batch-bus";
import { progressOf } from "@/lib/batch-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = await cancelRun(id);
  if (!result) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const { record, cancelled_cells } = result;
  if (!record) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // 推一次进度让前端看到 cells 状态翻转,再推 finished 让 SSE 关连接
  const p = progressOf(record);
  publish(id, { type: "progress", ...p });
  publish(id, { type: "finished" });

  // 释放 run-level lock,允许后续 retry-all / 单格重试
  markDone(id);

  return NextResponse.json({
    ok: true,
    cancelled_cells,
    status: record.status,
  });
}
