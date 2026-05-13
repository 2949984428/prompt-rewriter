// prompt-rewriter/app/api/questions/sets/import/route.ts
//
// POST /api/questions/sets/import   (multipart/form-data)
//   - file:        .xlsx(必填)
//   - name:        题目集显示名(可空 → 用 filename 推)
//   - description: 描述(可空)
//
// 每次调用 = 创建一个新题目集(set_id 由 server 端生成,UUID)。
// 不再支持 replace / merge 模式(那是单题目库的语义,跟"题目集"两级框架冲突)。

import { NextRequest, NextResponse } from "next/server";
import { parseQuestionsXlsx } from "@/lib/questions/import-xlsx";
import { createSet } from "@/lib/questions/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    return NextResponse.json(
      {
        error: "请用 multipart/form-data 上传文件",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "file 字段缺失或不是文件" },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `文件超过 ${MAX_BYTES / 1024 / 1024} MB 限制` },
      { status: 413 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const result = await parseQuestionsXlsx(buf, file.name);

  if (result.questions.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "xlsx 解析后没有有效题目",
        result,
      },
      { status: 400 },
    );
  }

  // name 默认 = 去掉扩展名的 filename
  const name =
    (form.get("name") as string | null)?.trim() ||
    file.name.replace(/\.[^.]+$/, "") ||
    "新题目集";
  const description = (form.get("description") as string | null) ?? "";

  try {
    const setHead = await createSet({
      name,
      description,
      source_filename: file.name,
      questions: result.questions,
      // 方案 A:把原 xlsx 也存一份,后续可下载
      source_xlsx: buf,
    });
    return NextResponse.json({
      ok: true,
      parsed: {
        total_rows: result.total_rows,
        accepted: result.questions.length,
        skipped: result.skipped,
        duplicates: result.duplicates,
        errors: result.errors.slice(0, 20),
      },
      set: setHead,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
