// prompt-rewriter/app/api/labs/format/skills/route.ts
//
// GET 返回 data/labs/format/skills/index.json — 列出全部可选格式 skill。
// PM 在 UI 上多选时消费这个列表。

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { FormatSkillsIndexSchema } from "@/lib/schema-format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE = path.join(process.cwd(), "data", "labs", "format", "skills", "index.json");

export async function GET() {
  try {
    const text = await fs.readFile(FILE, "utf-8");
    const data = FormatSkillsIndexSchema.parse(JSON.parse(text));
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: "无法加载 format skills index", detail: String(e) },
      { status: 500 }
    );
  }
}
