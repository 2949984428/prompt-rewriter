// prompt-rewriter/lib/config.ts
// 集中管理 data/ 下可编辑配置资源的读写。
// 当前聚焦 target_model + model_profiles;skill.md / hard_rules.json / vertical_hints.json
// 因历史原因仍在各自的 api route 里直接读写,保持不动。
import { promises as fs } from "fs";
import path from "path";
import { MetaSchema, type Meta } from "./schema";

const DATA = path.join(process.cwd(), "data");
const META_FILE = path.join(DATA, "_meta.json");
const PROFILES_DIR = path.join(DATA, "model_profiles");

const DEFAULT_TARGET_MODEL = "gpt-image-2";

// ---------- model profile 文件名白名单(避免路径穿越) ----------

const SAFE_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

export function isSafeProfileName(name: string): boolean {
  return SAFE_NAME.test(name) && !name.includes("..") && name.length <= 64;
}

function profileFilePath(name: string): string {
  if (!isSafeProfileName(name)) {
    throw new Error(`invalid profile name: ${name}`);
  }
  return path.join(PROFILES_DIR, `${name}.md`);
}

// ---------- meta ----------

export async function loadMeta(): Promise<Meta> {
  try {
    const text = await fs.readFile(META_FILE, "utf-8");
    return MetaSchema.parse(JSON.parse(text));
  } catch {
    // 文件不存在或格式坏时降级到默认值,不抛错(保证改写链路不因 meta 坏掉而中断)
    return { target_model: DEFAULT_TARGET_MODEL };
  }
}

export async function saveMeta(meta: Meta): Promise<void> {
  const parsed = MetaSchema.parse(meta);
  // 额外校验:target_model 指向的 profile 必须存在
  const available = await listModelProfiles();
  if (!available.includes(parsed.target_model)) {
    throw new Error(
      `target_model "${parsed.target_model}" has no matching profile file. Available: ${available.join(", ")}`
    );
  }
  await fs.writeFile(META_FILE, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
}

// ---------- model profiles ----------

export async function listModelProfiles(): Promise<string[]> {
  try {
    const entries = await fs.readdir(PROFILES_DIR);
    return entries
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3))
      .filter(isSafeProfileName)
      .sort();
  } catch {
    return [];
  }
}

export async function loadModelProfile(name: string): Promise<string> {
  const file = profileFilePath(name);
  try {
    return await fs.readFile(file, "utf-8");
  } catch {
    // profile 不存在时返回空字符串,让 prompt-builder 可以降级
    return "";
  }
}

export async function saveModelProfile(name: string, md: string): Promise<void> {
  if (!md || md.length > 200_000) {
    throw new Error("profile empty or too large");
  }
  const file = profileFilePath(name);
  await fs.mkdir(PROFILES_DIR, { recursive: true });
  await fs.writeFile(file, md, "utf-8");
}

export async function deleteModelProfile(name: string): Promise<void> {
  const meta = await loadMeta();
  if (meta.target_model === name) {
    throw new Error(`cannot delete profile "${name}" while it is the active target_model`);
  }
  const file = profileFilePath(name);
  await fs.unlink(file).catch(() => {});
}

// ---------- 便捷:给 rewrite route 用 ----------

export async function loadActiveModelProfile(): Promise<{
  target_model: string;
  profile_md: string;
}> {
  const meta = await loadMeta();
  const md = await loadModelProfile(meta.target_model);
  return { target_model: meta.target_model, profile_md: md };
}
