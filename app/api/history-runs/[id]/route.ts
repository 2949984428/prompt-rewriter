// prompt-rewriter/app/api/history-runs/[id]/route.ts
//
// 单条详情读写。
//   GET  → 从 index 找 ref → 读 data/labs/<lab>/runs/<id>.json → 返回
//   PUT  body={ lab_id, detail, index_patch? } → 写 detail 文件 + 同步 index 字段
//   DELETE → 删 detail 文件 + index 移除条目
//
// 路径硬化:id 必须只含 [a-zA-Z0-9_-],lab_id 必须在白名单。

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import {
  HistoryIndexEntrySchema,
  type HistoryIndexEntry,
} from "@/lib/schema-history-index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = process.cwd();
const INDEX_FILE = path.join(ROOT, "data", "history-index.json");

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;
const ALLOWED_LABS = ["rewrite", "format"] as const;

const PutBodySchema = z.object({
  lab_id: z.enum(ALLOWED_LABS),
  detail: z.unknown(), // 各 lab 自己的 detail schema,这里不强约束
  // 部分字段(如 summary / pm_score_avg)可以让前端在 PUT 时一并更新到 index
  index_patch: z
    .object({
      query: z.string().optional(),
      summary: z.string().optional(),
      status: z.enum(["completed", "failed", "partial"]).optional(),
      pm_score_avg: z.number().nullable().optional(),
      pm_score_count: z.number().int().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

function safeRunPath(lab_id: string, id: string): string | null {
  if (!SAFE_ID.test(id)) return null;
  if (!ALLOWED_LABS.includes(lab_id as (typeof ALLOWED_LABS)[number])) return null;
  const dir = path.join(ROOT, "data", "labs", lab_id, "runs");
  const file = path.join(dir, `${id}.json`);
  if (!file.startsWith(dir + path.sep)) return null;
  return file;
}

async function readIndex(): Promise<HistoryIndexEntry[]> {
  try {
    const text = await fs.readFile(INDEX_FILE, "utf-8");
    const json = JSON.parse(text);
    if (!Array.isArray(json)) return [];
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
  await fs.mkdir(path.dirname(INDEX_FILE), { recursive: true });
  await fs.writeFile(INDEX_FILE, JSON.stringify(items, null, 2), "utf-8");
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!SAFE_ID.test(id ?? "")) return new Response("bad id", { status: 400 });
  const index = await readIndex();
  const entry = index.find((x) => x.id === id);
  if (!entry) return new Response("not found", { status: 404 });

  const file = safeRunPath(entry.lab_id, id);
  if (!file) return new Response("forbidden", { status: 403 });
  try {
    const text = await fs.readFile(file, "utf-8");
    return new NextResponse(text, {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response("detail file missing", { status: 404 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!SAFE_ID.test(id ?? "")) return new Response("bad id", { status: 400 });

  const body = await req.json();
  const parsed = PutBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const { lab_id, detail, index_patch } = parsed.data;

  const file = safeRunPath(lab_id, id);
  if (!file) return new Response("forbidden", { status: 403 });

  // 1) 写详情文件
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(detail, null, 2), "utf-8");

  // 2) 同步 index(已存在则 patch,不存在则用最小合理默认创建)
  const index = await readIndex();
  const idx = index.findIndex((x) => x.id === id);
  if (idx >= 0) {
    index[idx] = {
      ...index[idx],
      ...(index_patch ?? {}),
      // 保险:防 patch 误改 id / lab_id / ts / ref
      id,
      lab_id,
      ref: index[idx].ref,
    };
  } else {
    // 首次创建:必须有 query 字段(否则索引不完整)
    if (!index_patch?.query) {
      return NextResponse.json(
        {
          error:
            "首次创建需要 index_patch.query(后续 PUT 同 id 时不再要求)",
        },
        { status: 400 }
      );
    }
    const ref = path
      .relative(ROOT, file)
      .split(path.sep)
      .join("/"); // 跨平台稳定的相对路径
    index.unshift({
      id,
      ts: Date.now(),
      lab_id,
      query: index_patch.query,
      summary: index_patch.summary ?? "",
      status: index_patch.status ?? "completed",
      ref,
      pm_score_avg: index_patch.pm_score_avg ?? null,
      pm_score_count: index_patch.pm_score_count ?? 0,
      metadata: index_patch.metadata ?? {},
    });
  }
  await writeIndex(index);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!SAFE_ID.test(id ?? "")) return new Response("bad id", { status: 400 });
  const index = await readIndex();
  const entry = index.find((x) => x.id === id);
  if (!entry) return new Response("not found", { status: 404 });

  const file = safeRunPath(entry.lab_id, id);
  if (file) {
    await fs.unlink(file).catch(() => {}); // 详情文件丢了也允许从 index 删
  }
  await writeIndex(index.filter((x) => x.id !== id));
  return NextResponse.json({ ok: true });
}
