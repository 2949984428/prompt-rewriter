// prompt-rewriter/lib/lovart-agent-client.ts
//
// Lovart Agent Generator API client（57 个模型，含 image / image-modify / video / video-modify / font）。
// 跟 lib/image.ts（OpenAI 兼容内部网关）平行，由 lib/image-router.ts 按模型名分发。
//
// 鉴权方案：demo 阶段用 env var 写死 token + signature + timestamp（一份手动从浏览器抓）。
// - 签名实测**不强校时间戳**，固定一份 signature 能跨次复用（只要 body 哈希相关字段不变）
// - 生产路径：找 Lovart 后端拿服务端 token（switch 时只需改本文件的 readCreds()）
//
// 归一化：本 client 的输出 schema 跟 lib/image.ts 的 CreateImageResp / GetImageResultResp **保持对齐**，
// router 拿到任一 client 的返回都能用同一组下游代码渲染。

const BASE = (
  process.env.LOVART_AGENT_BASE_URL ?? "https://agent-generator-pre.lovart.vip"
).replace(/\/+$/, "");

const TOKEN = process.env.LOVART_AGENT_TOKEN ?? "";
const USER_UUID = process.env.LOVART_AGENT_USER_UUID ?? "";
const SIGNATURE = process.env.LOVART_AGENT_SIGNATURE ?? "";
const TIMESTAMP = process.env.LOVART_AGENT_TIMESTAMP ?? "";
const PROJECT_ID = process.env.LOVART_AGENT_PROJECT_ID ?? "";

// 通用错误
export class LovartAgentError extends Error {
  constructor(message: string, public status?: number, public raw?: string) {
    super(message);
  }
}

// ─────────────────────── 类型 ───────────────────────

export type LovartGeneratorType =
  | "image"
  | "image-modify"
  | "video"
  | "video-modify"
  | "font";

export interface LovartGenerator {
  name: string; // 如 "vertex/anon-bob" / "kling/kling-v2-6"
  display_name: string;
  icon: string;
  description: string;
  type: LovartGeneratorType;
  index: number;
}

export interface LovartCreateTaskInput {
  generator_name: string;
  input_args: Record<string, unknown>;
}

export interface LovartCreateTaskResp {
  task_id: string; // 实际是 generator_task_id，对外统一叫 task_id
  status: string;
}

// 归一化后的产物（跟 image.ts 的 ImageArtifact 对齐）
export interface LovartArtifact {
  type: string; // "image" / "video" / 其他
  content: string; // 公网 URL
  metadata?: Record<string, unknown>;
}

export interface LovartTaskResult {
  task_id: string;
  status: "submitted" | "running" | "completed" | "failed" | string;
  generator_name?: string;
  artifacts?: LovartArtifact[];
  cost?: number;
  error?: string;
  raw?: unknown;
}

// ─────────────────────── 鉴权 header ───────────────────────

function authHeaders(): Record<string, string> {
  if (!TOKEN || !USER_UUID || !SIGNATURE || !TIMESTAMP) {
    throw new LovartAgentError(
      "Lovart Agent 鉴权未配置。请在 .env.local 设置 LOVART_AGENT_TOKEN / USER_UUID / SIGNATURE / TIMESTAMP"
    );
  }
  return {
    "Content-Type": "application/json",
    Accept: "*/*",
    Origin: "https://www-pre.lovart.vip",
    Referer: "https://www-pre.lovart.vip/",
    token: TOKEN,
    "X-User-Uuid": USER_UUID,
    "X-Client-Signature": SIGNATURE,
    "X-Send-Timestamp": TIMESTAMP,
  };
}

// ─────────────────────── 列模型清单（无认证） ───────────────────────

export async function listGenerators(): Promise<LovartGenerator[]> {
  const resp = await fetch(`${BASE}/api/v1/generator/list`, {
    method: "GET",
    headers: { Accept: "*/*" },
  });
  if (!resp.ok) {
    throw new LovartAgentError(
      `list generators 失败 (${resp.status})`,
      resp.status
    );
  }
  const json = (await resp.json()) as {
    code: number;
    message?: string;
    data?: { items?: LovartGenerator[] };
  };
  if (json.code !== 0 || !json.data?.items) {
    throw new LovartAgentError(
      `list generators 响应异常: ${json.message ?? "unknown"}`
    );
  }
  return json.data.items;
}

// ─────────────────────── 全平台 OpenAPI schema ───────────────────────
//
// /api/v1/generator/schema?name=<任意> 返回的是**整个平台**所有 generator 的 OpenAPI 风格 schema
// (一份 ~135 个 component schemas 的大文档),不是单 generator 的。query 参数 name 似乎是必填但内容
// 不影响返回(每次都返回全量)。
//
// 关键 component:
//   - <ModelKey>Request: 每个 generator 的 input_args 字段定义。key 是 PascalCase 化的 model name + "Request"。
//   - 各种 enum 类型(如 Seedream4AspectRatio / IdeogramAspectRatio / KlingModel),被 *Request schema 引用。
//
// 我们关心的字段:
//   - properties.aspect_ratio.enum  → 该 model 支持的输出比例
//   - properties.image.maxItems     → 支持的参考图张数(image-to-image 模型)
//   - properties.prompt.minLength   → prompt 字符下限
//   - x-capabilities.modes          → text-to-image / image-to-image 等模式

export interface LovartOpenAPISchema {
  components: {
    schemas: Record<string, LovartSchemaObject>;
  };
  info?: unknown;
  openapi?: string;
  paths?: unknown;
}

export interface LovartSchemaObject {
  type?: string;
  description?: string;
  title?: string;
  required?: string[];
  properties?: Record<string, LovartSchemaProperty>;
  enum?: unknown[];
  default?: unknown;
  "x-capabilities"?: {
    description?: string;
    model_type?: string;
    modes?: { mode: string; required_fields: string[] }[];
    conflicts?: unknown[];
    ui_fields?: string[];
  };
  "x-ui-visible-fields"?: string[];
}

export interface LovartSchemaProperty {
  type?: string;
  description?: string;
  title?: string;
  enum?: (string | number)[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: { type?: string; $ref?: string };
  $ref?: string;
  allOf?: { $ref?: string }[];
  "x-resolution-mapping"?: Record<string, string>;
}

export async function getGeneratorsSchema(): Promise<LovartOpenAPISchema> {
  // name 必填但任意值都返回全量
  const url = `${BASE}/api/v1/generator/schema?name=ping`;
  const resp = await fetch(url, {
    method: "GET",
    headers: authHeaders(),
  });
  if (!resp.ok) {
    throw new LovartAgentError(
      `schema 拉取失败 (${resp.status})`,
      resp.status
    );
  }
  const json = (await resp.json()) as {
    code: number;
    message?: string;
    data?: LovartOpenAPISchema;
  };
  if (json.code !== 0 || !json.data) {
    throw new LovartAgentError(
      `schema 响应异常: ${json.message ?? "unknown"}`
    );
  }
  return json.data;
}

/**
 * 把 generator name 映射到 schema 里的 *Request key(case-insensitive 模糊匹配)。
 * "vertex/anon-bob" → 找 "Vertexanonbob" + "Request" 这种(实际 key 大小写规则不一致,
 * 比如 "fal/flux-2-pro" → "Falflux2ProRequest",所以用 case-insensitive 比对)。
 */
export function resolveSchemaKey(
  modelName: string,
  schema: LovartOpenAPISchema
): string | null {
  const norm = modelName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = `${norm}request`;
  for (const k of Object.keys(schema.components.schemas)) {
    if (k.toLowerCase() === target) return k;
  }
  return null;
}

// ─────────────────────── 创建任务 ───────────────────────

export async function createTask(
  input: LovartCreateTaskInput
): Promise<LovartCreateTaskResp> {
  if (!PROJECT_ID) {
    throw new LovartAgentError(
      "缺 LOVART_AGENT_PROJECT_ID（body.project_id 必填）"
    );
  }
  const body = {
    project_id: PROJECT_ID,
    generator_type: "generator",
    generator_name: input.generator_name,
    input_args: input.input_args,
  };
  const resp = await fetch(`${BASE}/api/v1/generator/tasks`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new LovartAgentError(
      `创建任务失败 (${resp.status})`,
      resp.status,
      text.slice(0, 500)
    );
  }
  let parsed: { code: number; message?: string; data?: { generator_task_id?: string } };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LovartAgentError("返回非法 JSON", resp.status, text.slice(0, 500));
  }
  if (parsed.code !== 0 || !parsed.data?.generator_task_id) {
    throw new LovartAgentError(
      `创建任务返回业务错: ${parsed.message ?? "unknown"}`,
      resp.status,
      text.slice(0, 500)
    );
  }
  return {
    task_id: parsed.data.generator_task_id,
    status: "submitted",
  };
}

// ─────────────────────── 查询任务 ───────────────────────

export async function getTaskResult(taskId: string): Promise<LovartTaskResult> {
  const url = `${BASE}/api/v1/generator/tasks?task_id=${encodeURIComponent(taskId)}`;
  const resp = await fetch(url, { method: "GET", headers: authHeaders() });
  const text = await resp.text();
  if (!resp.ok) {
    throw new LovartAgentError(
      `查询任务失败 (${resp.status})`,
      resp.status,
      text.slice(0, 500)
    );
  }
  let parsed: {
    code: number;
    message?: string;
    data?: {
      generator_task_id?: string;
      generator_name?: string;
      status?: string;
      artifacts?: LovartArtifact[];
      cost?: number;
      error?: string;
    };
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LovartAgentError("返回非法 JSON", resp.status, text.slice(0, 500));
  }
  if (parsed.code !== 0 || !parsed.data) {
    throw new LovartAgentError(
      `查询返回业务错: ${parsed.message ?? "unknown"}`,
      resp.status,
      text.slice(0, 500)
    );
  }
  const d = parsed.data;
  return {
    task_id: d.generator_task_id ?? taskId,
    status: d.status ?? "unknown",
    generator_name: d.generator_name,
    artifacts: d.artifacts,
    cost: d.cost,
    error: d.error,
    raw: parsed,
  };
}

// ─────────────────────── 帮助：env 自查 ───────────────────────

export function checkCreds(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!TOKEN) missing.push("LOVART_AGENT_TOKEN");
  if (!USER_UUID) missing.push("LOVART_AGENT_USER_UUID");
  if (!SIGNATURE) missing.push("LOVART_AGENT_SIGNATURE");
  if (!TIMESTAMP) missing.push("LOVART_AGENT_TIMESTAMP");
  if (!PROJECT_ID) missing.push("LOVART_AGENT_PROJECT_ID");
  return { ok: missing.length === 0, missing };
}
