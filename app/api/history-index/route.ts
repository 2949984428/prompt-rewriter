// prompt-rewriter/app/api/history-index/route.ts
//
// 跨实验台的全局索引 endpoint。
//   GET                          → 返回全部索引(可选 ?lab=xxx 过滤)
//   POST  body=HistoryIndexEntry → 追加一条
//   PUT   body=HistoryIndexEntry → upsert(已存在 id 则 patch,不存在则追加)
//
// 详情数据**不**在这里读写,详情走 /api/history-runs/[id]。

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { HistoryIndexEntrySchema, type HistoryIndexEntry } from "@/lib/schema-history-index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE = path.join(process.cwd(), "data", "history-index.json");
const ListSchema = z.array(HistoryIndexEntrySchema);

async function readIndex(): Promise<HistoryIndexEntry[]> {
  try {
    const text = await fs.readFile(FILE, "utf-8");
    const json = JSON.parse(text);
    if (!Array.isArray(json)) return [];
    // soft parse:坏条目跳过,不让一条老格式整个 GET 挂掉
    const good: HistoryIndexEntry[] = [];
    for (const item of json) {
      const r = HistoryIndexEntrySchema.safeParse(item);
      if (r.success) good.push(r.data);
    }
    return good;
  } catch {
    return [];
  }
}

async function writeIndex(items: HistoryIndexEntry[]) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(items, null, 2), "utf-8");
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lab = searchParams.get("lab");
  const items = await readIndex();
  const filtered = lab ? items.filter((x) => x.lab_id === lab) : items;
  // 默认按 ts 倒序(最新在前)
  filtered.sort((a, b) => b.ts - a.ts);
  return NextResponse.json(filtered);
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = HistoryIndexEntrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "schema invalid", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const items = await readIndex();
  // 防重:同 id 已存在就报错(用 PUT 做 upsert)
  if (items.some((x) => x.id === parsed.data.id)) {
    return NextResponse.json(
      { error: "id 已存在,请用 PUT upsert" },
      { status: 409 }
    );
  }
  const next = [parsed.data, ...items];
  await writeIndex(next);
  return NextResponse.json({ ok: true, count: next.length });
}

export async function PUT(req: Request) {
  // upsert 单条:body 是单个 HistoryIndexEntry
  const body = await req.json();
  const parsed = HistoryIndexEntrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "schema invalid", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const items = await readIndex();
  const idx = items.findIndex((x) => x.id === parsed.data.id);
  if (idx >= 0) {
    items[idx] = parsed.data;
  } else {
    items.unshift(parsed.data);
  }
  await writeIndex(items);
  return NextResponse.json({ ok: true, count: items.length });
}
