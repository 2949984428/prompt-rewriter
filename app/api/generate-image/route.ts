// prompt-rewriter/app/api/generate-image/route.ts
//
// 直接消费 LLM 产出的 final_prompt 对象(和 gpt-image-2 原生请求体完全同构):
//   { prompt, size, quality, n, output_format }
// 前端把 result.final_prompt 原样作为 body 发过来,这里做最小容错/归一化即可。
//
// model 字段决定走哪条路:
//   - 未传 / "gpt-image-2" 等无 "/" → 内部 image gateway(lib/image.ts)
//   - "vertex/anon-bob" 等含 "/" → Lovart Agent Generator(lib/lovart-agent-client.ts)
// 由 lib/image-router.ts 统一分发。返回的 task_id 带 provider 前缀。

import {
  createImageTaskRouted,
} from "@/lib/image-router";
import {
  ratioToSize,
  ImageGatewayError,
  type ImageSize,
  type ImageQuality,
  type ImageFormat,
} from "@/lib/image";
import { LovartAgentError } from "@/lib/lovart-agent-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_SIZES: ImageSize[] = [
  "1024x1024",
  "2048x2048",
  "1536x1024",
  "1024x1536",
  "1792x1008",
  "1008x1792",
  "1536x1152",
  "1152x1536",
  "auto",
];

// size 容错:LLM 应该填 gpt-image-2 原生像素,但万一塞了 "3:4" / "portrait" 之类,
// 兜底走 ratioToSize 映射一次。
function normalizeSize(s?: unknown): ImageSize {
  if (typeof s !== "string") return "auto";
  const v = s.trim().toLowerCase();
  if ((VALID_SIZES as string[]).includes(v)) return v as ImageSize;
  return ratioToSize(v);
}

// quality 固定死在 medium。不接受 LLM 或前端传入的任何其他值 —— 避免 A/B 对照中
// 两路因为 quality 不同产生成本/画质差异,使对比不纯净;也防止 LLM 误判成 high 拉高账单。
const FIXED_QUALITY: ImageQuality = "medium";

function normalizeFormat(f?: unknown): ImageFormat {
  if (typeof f !== "string") return "png";
  const s = f.trim().toLowerCase();
  if (s === "jpeg" || s === "jpg") return "jpeg";
  if (s === "webp") return "webp";
  return "png";
}

function normalizeN(n?: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(10, Math.round(n)));
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      prompt?: string;
      size?: string;
      quality?: string;
      n?: number;
      output_format?: string;
      reference_images?: string[];
      // 路由相关:
      model?: string; // 默认 "gpt-image-2"(走 image gateway);"vendor/name" 走 Lovart
      lovart_input_args?: Record<string, unknown>; // 透传给 Lovart input_args
    };
    const prompt = (body.prompt ?? "").trim();
    if (!prompt) {
      return Response.json({ error: "prompt 不能为空" }, { status: 400 });
    }
    // gpt-image-2 限制 32000 字符;Lovart 各模型一般 ~2000,过长由 Lovart 侧自己拒。
    const safePrompt = prompt.slice(0, 32000);

    const model = (body.model ?? "gpt-image-2").trim() || "gpt-image-2";
    const size = normalizeSize(body.size);
    const quality = FIXED_QUALITY; // 固定 medium,忽略 body.quality(只对 IGW 路径生效;Lovart 不收 quality)
    const output_format = normalizeFormat(body.output_format);
    const n = normalizeN(body.n);

    // 参考图:非空走 image-edit(图生图)/ image-modify;空走 text-to-image / 文生图。上限 4 张。
    const refs = Array.isArray(body.reference_images)
      ? body.reference_images
          .filter((s): s is string => typeof s === "string" && s.length > 0)
          .slice(0, 4)
      : [];

    const task = await createImageTaskRouted({
      model,
      prompt: safePrompt,
      size,
      quality,
      n,
      output_format,
      reference_images: refs,
      lovart_input_args: body.lovart_input_args,
    });
    return Response.json({
      task_id: task.task_id,
      status: task.status,
      provider: task.provider,
      model: task.model,
      // 回显实际用到的参数,形成"输入-参数-输出"的闭环可见
      resolved_params: {
        size,
        quality,
        n,
        output_format,
        reference_count: refs.length,
        endpoint:
          task.provider === "lovart"
            ? "lovart-generator"
            : refs.length > 0
              ? "image-edit"
              : "text-to-image",
      },
    });
  } catch (e) {
    if (e instanceof ImageGatewayError || e instanceof LovartAgentError) {
      // dev 排错用:在 server log 里 dump 网关返回的 raw,前端只能看到摘要
      console.error(
        `[generate-image] ${e.constructor.name} status=${e.status} msg=${e.message}\n  raw=${(e.raw ?? "").slice(0, 800)}`
      );
      return Response.json(
        { error: e.message, status: e.status, raw: e.raw },
        { status: 502 }
      );
    }
    console.error("[generate-image] unknown error:", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
