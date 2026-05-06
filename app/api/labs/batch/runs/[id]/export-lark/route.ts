// prompt-rewriter/app/api/labs/batch/runs/[id]/export-lark/route.ts
//
// POST → 同步把跑批结果推到飞书云文档。
// body 可选 { include_excluded?: boolean, folder_token?: string }
//
// 阻塞调用,串行 spawn lark-cli,64 cell ~ 100s。Next.js 默认 route timeout
// 是 60s,所以这里 maxDuration 拉到 5 分钟。
//
// 失败模式:
//   - lark-cli 未安装/auth 过期 → 返回 { error, status: "needs_login" } 200
//     的 4xx (具体 401 / 412),前端弹明确提示
//   - 部分 cell 失败 → 200,带 image_failed 计数

import { NextResponse } from "next/server";
import { z } from "zod";
import { readRun } from "@/lib/batch-store";
import { exportBatchToLark } from "@/lib/lark/export-to-doc";
import { LarkCliError } from "@/lib/lark/cli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 64 cell × 1.5s/操作 ≈ 96s,留 5 分钟保险
export const maxDuration = 300;

const BodySchema = z.object({
  include_excluded: z.boolean().optional(),
  folder_token: z.string().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const run = await readRun(id);
  if (!run) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // body 是 optional 的,没传就当默认值
  let body: z.infer<typeof BodySchema> = {};
  try {
    const text = await req.text();
    if (text.trim()) {
      const parsed = BodySchema.safeParse(JSON.parse(text));
      if (parsed.success) body = parsed.data;
    }
  } catch {
    /* 空 body 即可 */
  }

  try {
    const result = await exportBatchToLark(run, {
      includeExcluded: body.include_excluded,
      folderToken: body.folder_token,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof LarkCliError) {
      const httpStatus =
        e.type === "not_installed"
          ? 412 // precondition failed:本机环境问题
          : e.type === "auth_expired"
            ? 401
            : 500;
      return NextResponse.json(
        {
          status: e.type === "auth_expired" ? "needs_login" : e.type,
          error: e.message,
        },
        { status: httpStatus }
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
