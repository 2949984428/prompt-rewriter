// prompt-rewriter/lib/concurrency-policy.ts
//
// 跑批时按 **provider** 分池,而不是按 model 分池。
// 原因(实测):Lovart Agent 网关返回 `task rejected: 1200000200` 时附带
//   `running_task_num: 15`,说明 token 级 in-flight 上限 = 15。
//   如果给每个 lovart model 各一个 cap=8 的池,3 model 同跑 = 24 in-flight,
//   必爆 15 上限,后面的 task 全 reject。所以**所有 lovart 模型共享一个 12 容量池**(留 3 余量)。
// IGW 是内部网关,扛并发好,独立一个 8 容量池。
//
// .env.local 可 override:CONCURRENCY_IGW(默认 8)/ CONCURRENCY_LOVART(默认 12)。

const HARD_MIN = 1;
const HARD_MAX = 32;
const DEFAULT_IGW = 8;
// Lovart 实测 token 上限 15,留 3 给手动操作 / SSE 心跳等余量。
const DEFAULT_LOVART = 12;

function parseEnvCap(key: string): number | null {
  const raw = process.env[key];
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(HARD_MIN, Math.min(HARD_MAX, n));
}

/**
 * 根据 model name 返回该 model 应该使用的 Semaphore 容量。
 * model 含 "/" → Lovart;否则 igw。
 * 空字符串 → igw 路径(走后端 IMAGE_MODEL 默认,一般是 gpt-image-2)。
 */
export type ImageProvider = "igw" | "lovart";

/** model name → provider key(跟 image-router 同一规则)。 */
export function providerOf(model: string): ImageProvider {
  return model.includes("/") ? "lovart" : "igw";
}

/**
 * 按 provider 拿池容量。同一 provider 下的所有 model 共享一个池。
 * 跨 provider 独立(IGW 跟 Lovart 互不挤压)。
 */
export function getProviderConcurrency(provider: ImageProvider): number {
  const envCap = parseEnvCap(provider === "lovart" ? "CONCURRENCY_LOVART" : "CONCURRENCY_IGW");
  if (envCap != null) return envCap;
  return provider === "lovart" ? DEFAULT_LOVART : DEFAULT_IGW;
}

/** 保留旧 API 防外部调用方坏掉;内部建议用 providerOf + getProviderConcurrency。 */
export function getModelConcurrency(model: string): number {
  return getProviderConcurrency(providerOf(model));
}
