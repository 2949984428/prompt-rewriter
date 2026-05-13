// prompt-rewriter/lib/image-router.ts
//
// 生图路由层:按 model 名分发到 image.ts(内部网关) 或 lovart-agent-client.ts(Lovart 57 模型)。
//
// 分发规则(简单粗暴,但足够):
//   - model 含 "/"        → Lovart(generator_name 一律 "vendor/name" 格式)
//   - 其余                → 内部 image gateway(目前主要是 "gpt-image-2")
//
// task_id 归一化:加 provider 前缀("igw:..." / "lovart:...")。
// 这样查询时只看前缀就能反路由,不需要前端记住自己用了哪条路。
//
// 响应归一化:两条路统一回 RoutedGetResp 形状,下游 image-job / batch-runner 等无需关心来源。

import {
  createImageTask as createGatewayTask,
  getImageResult as getGatewayResult,
  type ImageSize,
  type ImageQuality,
  type ImageFormat,
} from "./image";
import {
  createTask as createLovartTask,
  getTaskResult as getLovartTaskResult,
  getGeneratorsSchema,
  resolveSchemaKey,
} from "./lovart-agent-client";

export type ImageProvider = "igw" | "lovart";

// 路由不变量违反:input.model 推算的 provider 跟实际生成的 task_id 前缀对不上。
// 理论上自己代码不会触发(同一 input.model 决定路由 + 前缀),作为系统不变量
// 挡未来回归 + 第三方调用方实现错。被 batch-runner / generate-image route catch。
export class RoutingMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoutingMismatchError";
  }
}

// task_id 前缀反推 provider(给 invariant 校验用)
function providerFromTaskId(taskId: string): ImageProvider | null {
  if (taskId.startsWith("lovart:")) return "lovart";
  if (taskId.startsWith("igw:")) return "igw";
  return null;
}

// ─────────────────────── 输入 ───────────────────────

export interface RoutedCreateInput {
  // 模型名:
  //   - "gpt-image-2" 等无 "/" → 走内部 image gateway
  //   - "vertex/anon-bob" / "kling/kling-v2-6" 等含 "/" → 走 Lovart
  model: string;
  prompt: string;
  // image gateway 字段(Lovart 路径会尽力转译,转不了就丢)
  size?: ImageSize;
  quality?: ImageQuality;
  n?: number;
  output_format?: ImageFormat;
  reference_images?: string[];
  // Lovart 模型有自己的 input_args(每个 generator 不一样),透传给 Lovart 用
  // 与 prompt / reference_images 合并时,本字段优先
  lovart_input_args?: Record<string, unknown>;
}

export interface RoutedCreateResp {
  task_id: string; // "igw:<uuid>" / "lovart:<uuid>"
  status: string;
  provider: ImageProvider;
  model: string;
}

export interface RoutedArtifact {
  type: string; // image / video / 等
  content: string; // 公网 URL
  metadata?: Record<string, unknown>;
}

export interface RoutedGetResp {
  task_id: string; // 原前缀 task_id 回显
  status: "submitted" | "running" | "completed" | "failed" | string;
  provider: ImageProvider;
  model?: string;
  artifacts?: RoutedArtifact[];
  cost?: number;
  error?: string;
}

// ─────────────────────── provider 判定 ───────────────────────

export function pickProvider(model: string): ImageProvider {
  return model.includes("/") ? "lovart" : "igw";
}

function makePrefixed(provider: ImageProvider, taskId: string): string {
  return `${provider}:${taskId}`;
}

// 反向解析:从前缀 task_id 还原 (provider, raw_task_id)
// 兼容老数据:没前缀的全当 IGW(老 batch run 里都是裸 uuid)
export function parsePrefixed(prefixed: string): {
  provider: ImageProvider;
  taskId: string;
} {
  const idx = prefixed.indexOf(":");
  if (idx > 0) {
    const p = prefixed.slice(0, idx);
    if (p === "igw" || p === "lovart") {
      return { provider: p as ImageProvider, taskId: prefixed.slice(idx + 1) };
    }
  }
  return { provider: "igw", taskId: prefixed };
}

// ─────────────────────── Lovart 参考图字段动态解析 ───────────────────────
//
// **真相:Lovart 网关有 alias 层,schema 字段名 ≠ 网关实际接受的 body 字段名。**
// 实测映射:
//   schema 字段                   → 网关接受字段
//   ────────────────────────────────────────────
//   image_url (单数 string)       → image_url    (原名,如 remover / moveobject / imageexpand / layerseparation)
//   image     (数组 maxItems > 1) → image_urls   (alias!如 NB2 / NBP / NB1 / vectorizer / briaexpand / upscaler)
//   images    (复数数组)          → image_urls   (假定同上,wavespeed multipleangles 类)
//   无任何 image* 字段             → 不支持参考图
//
// 同时塞 image_url + image_urls 会让 schema 严格的模型(NB2/NBP)直接 code 2010 reject。
// 历史用 "两个都塞" 的兜底已经被 NB2/NBP 修正,**必须按 schema 选一个**。
//
// 5min schema 缓存,首次 hit 后基本零成本;schema 拉不到 fallback "image_urls"
// (因为 image-edit 类(多图)占主流,且单图也兼容 [URL] 数组语义)。
// 2026-05-13:严格按 schema property 真名,4 种之一。schema 找不到字段 → 抛错,
// 让调用方明确知道"model 不支持图生图,不能塞参考图",而不是 fallback 一个猜值最后 Lovart 静默忽略
type LovartImageField = "image" | "image_url" | "image_urls" | "images";
async function resolveLovartImageField(
  model: string,
): Promise<LovartImageField> {
  const schema = await getGeneratorsSchema();
  const key = resolveSchemaKey(model, schema);
  if (!key) {
    throw new Error(
      `Lovart Agent generator "${model}" 在 schema 中找不到对应 component`,
    );
  }
  const reqSchema = schema.components.schemas[key];
  const props = reqSchema?.properties ?? {};
  if (props.image_url) return "image_url";
  if (props.image_urls) return "image_urls";
  if (props.images) return "images";
  if (props.image) return "image";
  throw new Error(
    `Lovart Agent generator "${model}" 的 schema 没声明 image* 字段,不支持参考图(image-edit)`,
  );
}

// ─────────────────────── 创建 ───────────────────────

// size "1536x1024" → aspect_ratio "3:2"(Lovart 大多数 image generator 收 aspect_ratio)
function sizeToAspect(size?: ImageSize): string | undefined {
  if (!size || size === "auto") return undefined;
  const m = size.match(/^(\d+)x(\d+)$/);
  if (!m) return undefined;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return undefined;
  // 用最大公约数化简
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export async function createImageTaskRouted(
  input: RoutedCreateInput
): Promise<RoutedCreateResp> {
  const provider = pickProvider(input.model);

  if (provider === "igw") {
    const gw = await createGatewayTask({
      prompt: input.prompt,
      size: input.size,
      quality: input.quality,
      n: input.n,
      output_format: input.output_format,
      reference_images: input.reference_images,
    });
    const result = {
      task_id: makePrefixed("igw", gw.task_id),
      status: gw.status,
      provider: "igw" as const,
      model: input.model,
    };
    assertRoutingInvariant(input.model, result.task_id, "igw");
    return result;
  }

  // Lovart 分支:input_args 字段每个 generator 不同,按 schema 动态选参考图字段名
  const aspect = sizeToAspect(input.size);
  const hasRef =
    Array.isArray(input.reference_images) && input.reference_images.length > 0;

  // 按 schema 真名塞字段,4 种之一:image / image_url / image_urls / images
  // 单数(image_url)取数组第 1 个;数组型(其他三种)整组塞
  // schema 找不到字段时 resolveLovartImageField 会抛错,直接传给上层(POST handler 返 502)
  const refField = hasRef ? await resolveLovartImageField(input.model) : null;
  const refPatch: Record<string, unknown> = {};
  if (hasRef && refField === "image_url") {
    refPatch.image_url = input.reference_images![0];
  } else if (hasRef && refField) {
    refPatch[refField] = input.reference_images;
  }

  const inputArgs: Record<string, unknown> = {
    prompt: input.prompt,
    ...(aspect ? { aspect_ratio: aspect } : {}),
    ...refPatch,
    // 前端透传的 input_args 优先覆盖以上启发式默认
    ...(input.lovart_input_args ?? {}),
  };

  // 诊断日志:有参考图时打 inputArgs body,排查"字段名不对导致 reference 被吞"问题
  if (hasRef) {
    console.log(
      `[image-router] Lovart create task model=${input.model} refField=${refField} keys=${Object.keys(inputArgs).join(",")}`,
    );
  }
  const lv = await createLovartTask({
    generator_name: input.model,
    input_args: inputArgs,
  });
  const result = {
    task_id: makePrefixed("lovart", lv.task_id),
    status: lv.status,
    provider: "lovart" as const,
    model: input.model,
  };
  assertRoutingInvariant(input.model, result.task_id, "lovart");
  return result;
}

/**
 * 系统不变量:input.model 推算的 provider 必须等于 task_id 前缀决定的 provider。
 * 任一边违反就抛 RoutingMismatchError。
 */
function assertRoutingInvariant(
  model: string,
  taskId: string,
  actualBranch: ImageProvider
): void {
  const expected = pickProvider(model);
  const fromTaskId = providerFromTaskId(taskId);
  if (expected !== actualBranch || expected !== fromTaskId) {
    throw new RoutingMismatchError(
      `routing mismatch: model="${model}" → expected provider="${expected}", branch="${actualBranch}", task_id_prefix="${fromTaskId}"`
    );
  }
}

// ─────────────────────── 查询 ───────────────────────

function normalizeStatus(s?: string): RoutedGetResp["status"] {
  const v = (s ?? "").toLowerCase();
  if (["succeed", "success", "finished", "completed"].includes(v)) {
    return "completed";
  }
  if (["failed", "error"].includes(v)) return "failed";
  if (["submitted", "queued", "pending"].includes(v)) return "submitted";
  if (["running", "processing", "in_progress"].includes(v)) return "running";
  return v || "running";
}

export async function getImageResultRouted(
  prefixedTaskId: string
): Promise<RoutedGetResp> {
  const { provider, taskId } = parsePrefixed(prefixedTaskId);

  if (provider === "igw") {
    const r = await getGatewayResult(taskId);
    return {
      task_id: prefixedTaskId,
      status: normalizeStatus(r.status),
      provider: "igw",
      model: r.model,
      artifacts: r.artifacts?.map((a) => ({
        type: a.type,
        content: a.content,
      })),
      cost: r.cost,
      error:
        typeof r.error_details === "string"
          ? r.error_details
          : r.error_details
            ? JSON.stringify(r.error_details)
            : undefined,
    };
  }

  const r = await getLovartTaskResult(taskId);
  return {
    task_id: prefixedTaskId,
    status: normalizeStatus(r.status),
    provider: "lovart",
    model: r.generator_name,
    artifacts: r.artifacts?.map((a) => ({
      type: a.type,
      content: a.content,
      metadata: a.metadata,
    })),
    cost: r.cost,
    error: r.error,
  };
}
