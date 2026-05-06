// prompt-rewriter/app/api/labs/format/history/route.ts
//
// Format Lab 的跑批 + 评分 + 备注全部落 data/labs/format/history.json。
// 设计与 /api/history(老的)对齐:
//   - GET 做 soft parse(坏条目跳过,不让一条老数据格式不兼容就整个历史拉不回来)
//   - PUT 全量校验 + 写盘
//   - 上限 200 条(format lab 跑批多 + 评分要事后回查,比老 rewrite 留得更多)

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { FormatRunRecordSchema } from "@/lib/schema-format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE = path.join(process.cwd(), "data", "labs", "format", "history.json");
const MAX = 200;
const ListSchema = z.array(FormatRunRecordSchema);

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
  const good: unknown[] = [];
  for (const item of raw) {
    const r = FormatRunRecordSchema.safeParse(item);
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
  // 确保父目录存在(首次部署时 data/labs/format/ 可能没建)
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(trimmed, null, 2), "utf-8");
  return NextResponse.json({ ok: true, count: trimmed.length });
}
