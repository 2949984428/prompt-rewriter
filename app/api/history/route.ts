// prompt-rewriter/app/api/history/route.ts
//
// 历史轮次持久化:和 skill.md / rules / hints 一样落盘到 data/history.json。
//
// 设计要点:
// 1. GET 做 "soft parse" —— 坏条目直接丢掉,不让一条老数据格式不兼容就整个历史拉不回来。
//    因为历史里嵌套的是 RewriteResult,而 RewriteResult 是会随 skill 迭代的,
//    旧记录 schema 没对齐很正常,不能当错误处理。
// 2. PUT 做严格校验,新写进来的数据必须完整合法。
// 3. 上限 50 条,服务端兜底一次(前端也有,防客户端有 bug 把磁盘撑爆)。

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { HistoryItemSchema } from "@/lib/schema";

const FILE = path.join(process.cwd(), "data", "history.json");
const MAX = 50;
const ListSchema = z.array(HistoryItemSchema);

async function readFileSafe(): Promise<unknown[]> {
  try {
    const text = await fs.readFile(FILE, "utf-8");
    const json = JSON.parse(text);
    return Array.isArray(json) ? json : [];
  } catch {
    return [];
  }
}

export async function GET() {
  const raw = await readFileSafe();
  // soft parse:一条条过,坏的跳过,不让历史整体加载失败
  const good: unknown[] = [];
  for (const item of raw) {
    const r = HistoryItemSchema.safeParse(item);
    if (r.success) good.push(r.data);
  }
  return NextResponse.json(good);
}

export async function PUT(req: Request) {
  const body = await req.json();
  const parsed = ListSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "schema invalid", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const trimmed = parsed.data.slice(0, MAX);
  await fs.writeFile(FILE, JSON.stringify(trimmed, null, 2), "utf-8");
  return NextResponse.json({ ok: true, count: trimmed.length });
}
