// prompt-rewriter/app/api/upload-r2/route.ts
//
// 客户端在 ImageUploader 选图时立即调这个 endpoint,server 把 base64 上传到 R2
// 拿公网 URL 返回 → 前端在用户上传图时就能知道成不成功(失败立即弹错;成功 url
// 入 value),避免延迟到跑批 POST 才暴露 R2 挂的情况。
//
// 跟老 /api/upload-reference-image 区别:
//   - 老:multipart + 本地 disk + 返回 /api/image-file 内部 URL(外部 image gateway
//     拿不到)
//   - 新(本路由):base64 + Cloudflare R2 + 返回 https://pub-...r2.dev URL,任何
//     外部生图 gateway 都能 fetch
//
// 上层(ImageUploader)默认用老路径(其他 lab 历史行为);Pipeline lab 显式启用
// useR2Upload prop 走本路由。

import { NextRequest } from "next/server";
import { z } from "zod";
import { uploadDataUrlToR2 } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  dataUrl: z.string().min(1),
  prefix: z.string().default("ref"),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await req.json());
  } catch (e) {
    return Response.json(
      {
        ok: false,
        error: "参数错误",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 400 },
    );
  }
  try {
    const url = await uploadDataUrlToR2(body.dataUrl, body.prefix);
    return Response.json({ ok: true, url });
  } catch (e) {
    return Response.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }
}
