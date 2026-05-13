// prompt-rewriter/lib/strategies/registry.ts
//
// 策略库注册中心。给 pipeline step 提供"读 active 版本内容"的统一入口。
// 抽屉 UI 通过 list / publish / activate / delete 管理版本。
//
// 设计要点：
// - 每个 namespace 对应磁盘上一个目录（strategies/<name>/ 或 sps/<name>/）
// - _index.json 记录 active + versions[]，每个版本一个 vN.json/vN.md
// - 所有读路径都走 fs.readFile（**不缓存**），保证编辑器改完 → 下一次跑批立刻生效
// - 所有写路径都用 tmp + rename 原子写盘，防 server crash 时 _index.json 半写入

import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";

const STRATEGY_BASE = path.join(
  process.cwd(),
  "data",
  "labs",
  "pipeline",
  "strategies",
);

const SP_BASE = path.join(process.cwd(), "data", "labs", "pipeline", "sps");

// ─── 版本元信息 schema ─────────────────────────────
export const VersionMetaSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/i),
  label: z.string(),
  notes: z.string().default(""),
  createdAt: z.string(),
  author: z.string().default(""),
});

export const IndexSchema = z.object({
  active: z.string(),
  versions: z.array(VersionMetaSchema).min(1),
});

export type VersionMeta = z.infer<typeof VersionMetaSchema>;
export type Index = z.infer<typeof IndexSchema>;

// ─── 注册的"命名空间"(namespace = 一类策略文件) ─────────────────────────
//   namespace 是版本化资源的逻辑分组，比如 "vertical-standard" / "platform-tone" / "sp-classification" / "sp-rewrite"
//   每个 namespace 在磁盘上对应一个目录(strategies/<name>/ 或 sps/<name>/)
export type Namespace =
  | "vertical-standard"
  | "platform-tone"
  | "sp-classification"
  | "sp-rewrite"
  | "sp-creation-planner";

interface NamespaceConfig {
  baseDir: string;
  versionExt: ".json" | ".md";
}

export const NS_CONFIG: Record<Namespace, NamespaceConfig> = {
  "vertical-standard": {
    baseDir: path.join(STRATEGY_BASE, "vertical-standard"),
    versionExt: ".json",
  },
  "platform-tone": {
    baseDir: path.join(STRATEGY_BASE, "platform-tone"),
    versionExt: ".json",
  },
  "sp-classification": {
    baseDir: path.join(SP_BASE, "classification"),
    versionExt: ".md",
  },
  "sp-rewrite": {
    baseDir: path.join(SP_BASE, "rewrite"),
    versionExt: ".md",
  },
  "sp-creation-planner": {
    baseDir: path.join(SP_BASE, "creation-planner"),
    versionExt: ".md",
  },
};

// ─── 工具：原子写盘 ──────────────────────────────────
// POSIX rename 是原子操作，先写 .tmp 再 rename 可以防 server crash 时半写入。
async function atomicWriteFile(target: string, content: string): Promise<void> {
  const tmp = target + ".tmp";
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, target);
}

// ─── 工具：读 / 写 index ──────────────────────────────
async function readIndex(ns: Namespace): Promise<Index> {
  const raw = await fs.readFile(
    path.join(NS_CONFIG[ns].baseDir, "_index.json"),
    "utf8",
  );
  return IndexSchema.parse(JSON.parse(raw));
}

async function writeIndex(ns: Namespace, idx: Index): Promise<void> {
  const target = path.join(NS_CONFIG[ns].baseDir, "_index.json");
  await atomicWriteFile(target, JSON.stringify(idx, null, 2));
}

function versionPath(ns: Namespace, id: string): string {
  return path.join(NS_CONFIG[ns].baseDir, id + NS_CONFIG[ns].versionExt);
}

// ─── 公开 API ────────────────────────────────────────

/**
 * 读 active 版本的内容(完整文本)。pipeline step 跑批时调这个。
 * 返回 { id, content } —— content 是原始字符串(JSON 还是 md 由 namespace 决定)。
 */
export async function resolve(ns: Namespace): Promise<{
  id: string;
  content: string;
}> {
  const idx = await readIndex(ns);
  const content = await fs.readFile(versionPath(ns, idx.active), "utf8");
  return { id: idx.active, content };
}

/** 抽屉 UI 列版本时调：返回完整 index + 每版本是不是 active */
export async function list(ns: Namespace): Promise<Index> {
  return await readIndex(ns);
}

/** 读指定版本内容(用户在抽屉切版本查看时调) */
export async function read(ns: Namespace, id: string): Promise<string> {
  return await fs.readFile(versionPath(ns, id), "utf8");
}

/** 写指定版本内容(防抖保存) */
export async function write(
  ns: Namespace,
  id: string,
  content: string,
): Promise<void> {
  // 写 JSON 类的版本前做合法性校验，避免坏 JSON 把后续跑批毁了
  if (NS_CONFIG[ns].versionExt === ".json") {
    try {
      JSON.parse(content);
    } catch (e) {
      throw new Error(
        `JSON 格式不合法,未保存: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  // 写版本内容也用 tmp + rename，跟 _index.json 同标准
  await atomicWriteFile(versionPath(ns, id), content);
}

/**
 * 新建版本。fromId 给定时复制其内容作起点，否则空内容。
 * id 必须合法；label / notes 用户填；author 由调用方传入(目前用 "巧克力" 固定)。
 */
export async function publish(
  ns: Namespace,
  args: {
    id: string;
    label: string;
    notes?: string;
    fromId?: string;
    author?: string;
  },
): Promise<void> {
  const idx = await readIndex(ns);
  if (idx.versions.some((v) => v.id === args.id)) {
    throw new Error(`版本 id 已存在: ${args.id}`);
  }
  const meta = VersionMetaSchema.parse({
    id: args.id,
    label: args.label,
    notes: args.notes ?? "",
    createdAt: new Date().toISOString(),
    author: args.author ?? "",
  });

  // 拷贝内容
  let initialContent = "";
  if (args.fromId) {
    initialContent = await fs.readFile(versionPath(ns, args.fromId), "utf8");
  } else if (NS_CONFIG[ns].versionExt === ".json") {
    initialContent = "{}";
  }
  await atomicWriteFile(versionPath(ns, args.id), initialContent);

  idx.versions.push(meta);
  await writeIndex(ns, idx);
}

/** 设为 active */
export async function activate(ns: Namespace, id: string): Promise<void> {
  const idx = await readIndex(ns);
  if (!idx.versions.some((v) => v.id === id)) {
    throw new Error(`未找到版本: ${id}`);
  }
  idx.active = id;
  await writeIndex(ns, idx);
}

/** 删除版本(active 不能删，至少留一个) */
export async function remove(ns: Namespace, id: string): Promise<void> {
  const idx = await readIndex(ns);
  if (idx.active === id) {
    throw new Error("当前 active 版本不能删,请先切到别的版本");
  }
  if (idx.versions.length <= 1) {
    throw new Error("至少保留一个版本");
  }
  idx.versions = idx.versions.filter((v) => v.id !== id);
  await writeIndex(ns, idx);
  // 删文件(失败忽略，数据已经在 index 里看不到了，文件残留无害)
  try {
    await fs.unlink(versionPath(ns, id));
  } catch {
    // ignore
  }
}

/** 更新元信息(label / notes 改名) */
export async function patchMeta(
  ns: Namespace,
  id: string,
  patch: { label?: string; notes?: string },
): Promise<void> {
  const idx = await readIndex(ns);
  const v = idx.versions.find((v) => v.id === id);
  if (!v) throw new Error(`未找到版本: ${id}`);
  if (patch.label !== undefined) v.label = patch.label;
  if (patch.notes !== undefined) v.notes = patch.notes;
  await writeIndex(ns, idx);
}

/** 工具：判断字符串是否在合法 namespace 白名单里(API route 校验用) */
export function isNamespace(ns: string): ns is Namespace {
  return ns in NS_CONFIG;
}
