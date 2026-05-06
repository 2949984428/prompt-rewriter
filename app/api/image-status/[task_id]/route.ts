// prompt-rewriter/app/api/image-status/[task_id]/route.ts
import { getImageResult, ImageGatewayError } from "@/lib/image";

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
    const result = await getImageResult(task_id);
    return Response.json(result);
  } catch (e) {
    if (e instanceof ImageGatewayError) {
      return Response.json(
        { error: e.message, status: e.status, raw: e.raw },
        { status: 502 }
      );
    }
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
