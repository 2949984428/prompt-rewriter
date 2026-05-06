// prompt-rewriter/lib/image.ts
// gpt-image-2 客户端:创建任务 + 查询结果。参考 gpt-image-2-usage.md。

const BASE = (
  process.env.IMAGE_GATEWAY_BASE_URL ?? "http://localhost:8000"
).replace(/\/+$/, "");
const SERVICE_NAME = process.env.IMAGE_SERVICE_NAME ?? "prompt-rewriter";
const HEADERS = {
  "Content-Type": "application/json",
  baggage: `agent.service_name=${SERVICE_NAME}`,
};

// gpt-image-2 实际支持任意 16 倍数 + 3:1~1:3 + 总像素 0.65-8.3MP。
// 为兼容 lovart gateway 与 PM demo 简化,先用以下 8 个常见比例 + auto。
// 全部都是 16 倍数,都 ≤ 8.3MP,都在 3:1~1:3 区间内。
export type ImageSize =
  | "1024x1024"   // 1:1 默认
  | "2048x2048"   // 1:1 高清(主视觉 / 商品大图)
  | "1536x1024"   // 3:2 横
  | "1024x1536"   // 2:3 竖
  | "1792x1008"   // 16:9 横(桌面 / 视频封面)
  | "1008x1792"   // 9:16 竖(手机壁纸 / Stories)
  | "1536x1152"   // 4:3 横
  | "1152x1536"   // 3:4 竖
  | "auto";
export type ImageQuality = "auto" | "high" | "medium" | "low";
export type ImageFormat = "png" | "jpeg" | "webp";

export interface CreateImageInput {
  prompt: string;
  size?: ImageSize;
  quality?: ImageQuality;
  n?: number;
  output_format?: ImageFormat;
}

export interface CreateImageResp {
  task_id: string;
  status: string;
  provider?: string;
  model?: string;
  endpoint?: string;
}

export interface ImageArtifact {
  type: "image" | string;
  content: string;
}

export interface GetImageResultResp {
  task_id: string;
  status: "submitted" | "running" | "completed" | "failed" | string;
  provider?: string;
  model?: string;
  artifacts?: ImageArtifact[];
  cost?: number;
  error_details?: unknown;
}

export class ImageGatewayError extends Error {
  constructor(message: string, public status?: number, public raw?: string) {
    super(message);
  }
}

/**
 * 从 query / extract / final_prompt 里尽力找到画面比例字符串。
 * 优先级:extract.field 含"比例" > query/prompt 中的正则。
 */
export function pickAspectRatio(
  query: string,
  extract: { field?: string; value?: string }[] | undefined,
  prompt: string
): string | undefined {
  const hit = (extract ?? []).find(
    (it) => (it.field ?? "").includes("比例") && (it.value ?? "").trim()
  );
  if (hit?.value) return hit.value;
  const hay = `${query}\n${prompt}`;
  const m = hay.match(/\b(\d{1,2})\s*[:x×]\s*(\d{1,2})\b/);
  if (m) return `${m[1]}:${m[2]}`;
  return undefined;
}

/**
 * 根据 query 里的比例语义映射 gpt-image-2 支持的 size。
 * 优先精确匹配比例,次之关键词("竖/横/手机壁纸/桌面壁纸")兜底。
 */
export function ratioToSize(ratio?: string | null): ImageSize {
  if (!ratio) return "1024x1024";
  const r = ratio.replace(/\s/g, "").toLowerCase();

  // 16:9 横宽(视频封面 / 桌面壁纸 / 横屏 banner)
  if (["16:9", "1.78", "桌面壁纸", "桌面"].some((k) => r.includes(k))) {
    return "1792x1008";
  }
  // 9:16 窄竖(手机壁纸 / Reels / Stories / 抖音)
  if (
    ["9:16", "0.56", "手机壁纸", "stories", "reels", "抖音", "tiktok"].some(
      (k) => r.includes(k)
    )
  ) {
    return "1008x1792";
  }
  // 4:3 横
  if (["4:3", "1.33"].some((k) => r.includes(k))) {
    return "1536x1152";
  }
  // 3:4 竖(Pinterest / 杂志页)
  if (["3:4", "0.75", "pinterest"].some((k) => r.includes(k))) {
    return "1152x1536";
  }
  // 3:2 横(标准摄影 / 编辑大片)
  if (
    ["3:2", "1.5", "2:1", "21:9", "landscape", "横"].some((k) => r.includes(k))
  ) {
    return "1536x1024";
  }
  // 2:3 / 4:5 等竖构图(海报 / 小红书 / portrait)
  if (
    ["2:3", "0.67", "4:5", "portrait", "vertical", "海报", "小红书", "竖"].some(
      (k) => r.includes(k)
    )
  ) {
    return "1024x1536";
  }
  // 1:1 高清(用户明示 2K/4K/高清/主视觉)
  if (["2048", "2k", "4k", "高清", "主视觉"].some((k) => r.includes(k))) {
    return "2048x2048";
  }
  return "1024x1024";
}

export async function createImageTask(
  input: CreateImageInput
): Promise<CreateImageResp> {
  const body = {
    prompt: input.prompt,
    size: input.size ?? "auto",
    // demo 默认用 medium,兼顾质量与出图时间(10-40s)。
    // 追求极致效果可在前端传 quality: "high"(60-120s)。
    quality: input.quality ?? "medium",
    n: input.n ?? 1,
    output_format: input.output_format ?? "png",
  };
  const resp = await fetch(`${BASE}/openai/gpt-image-2/text-to-image`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new ImageGatewayError(
      `生图任务创建失败 (${resp.status})`,
      resp.status,
      text
    );
  }
  try {
    return JSON.parse(text) as CreateImageResp;
  } catch {
    throw new ImageGatewayError("生图网关返回非法 JSON", resp.status, text);
  }
}

export async function getImageResult(
  taskId: string
): Promise<GetImageResultResp> {
  const resp = await fetch(`${BASE}/results/${encodeURIComponent(taskId)}`, {
    method: "GET",
    headers: { baggage: `agent.service_name=${SERVICE_NAME}` },
    cache: "no-store",
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new ImageGatewayError(
      `查询生图结果失败 (${resp.status})`,
      resp.status,
      text
    );
  }
  try {
    return JSON.parse(text) as GetImageResultResp;
  } catch {
    throw new ImageGatewayError("生图网关返回非法 JSON", resp.status, text);
  }
}
