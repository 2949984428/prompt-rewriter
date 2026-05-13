// prompt-rewriter/app/api/questions/sets/[set_id]/xlsx/route.ts
//
// GET /api/questions/sets/<set_id>/xlsx
//   → 下载该题目集的源 xlsx 备份(导入时一并存的方案 A 产物)。
//   - 404 若没备份(老 set / xlsx 写盘失败时跳过)
//   - filename = 原 source_filename(从 set.json 读),fallback "<set_id>.xlsx"

import { NextRequest, NextResponse } from "next/server";
import { readSet, readSourceXlsx } from "@/lib/questions/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ set_id: string }> },
) {
  const { set_id } = await params;
  const buf = await readSourceXlsx(set_id);
  if (!buf) {
    return NextResponse.json(
      {
        error:
          "源 xlsx 备份不存在(可能是导入失败时跳过,或这是方案 A 之前创建的老题目集)",
      },
      { status: 404 },
    );
  }
  const set = await readSet(set_id);
  const filename =
    set?.source_filename && set.source_filename.endsWith(".xlsx")
      ? set.source_filename
      : `${set_id}.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": String(buf.length),
      "Cache-Control": "no-store",
    },
  });
}
