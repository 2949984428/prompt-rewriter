// prompt-rewriter/app/api/hints/route.ts
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { VerticalHintSchema } from "@/lib/schema";

const FILE = path.join(process.cwd(), "data", "vertical_hints.json");
const ListSchema = z.array(VerticalHintSchema);

export async function GET() {
  const text = await fs.readFile(FILE, "utf-8");
  const data = ListSchema.parse(JSON.parse(text));
  return NextResponse.json(data);
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
  await fs.writeFile(FILE, JSON.stringify(parsed.data, null, 2), "utf-8");
  return NextResponse.json({ ok: true, count: parsed.data.length });
}
