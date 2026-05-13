// prompt-rewriter/app/api/image-status/[task_id]/route.ts
//
// 接收带 provider 前缀的 task_id("igw:..." / "lovart:..."),由 image-router 反查路由。
// 老数据(裸 uuid)被 router 兜底为 "igw"。
import { getImageResultRouted } from "@/lib/image-router";
import { ImageGatewayError } from "@/lib/image";
import { LovartAgentError } from "@/lib/lovart-agent-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ task_id: string }> }
) {
  try {
    const { task_id } = await params;
    if (!task_id) {
      return Response.json({ error: "task_id 缺失" }, { status: 400 });
    }
    const result = await getImageResultRouted(task_id);
    return Response.json(result);
  } catch (e) {
    if (e instanceof ImageGatewayError || e instanceof LovartAgentError) {
      return Response.json(
        { error: e.message, status: e.status, raw: e.raw },
        { status: 502 }
      );
    }
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
