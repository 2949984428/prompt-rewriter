// prompt-rewriter/lib/skills.ts
// skill.md 的版本化管理层。
//
// 背景:
//   - skill.md 是给改写 AI 看的"总说明书",决定 7 步流程的思考方式。
//   - 迭代它是一件需要"A/B 对照"的事(v1 并列 5 seed vs v2 设计师独白 5 stage),
//     所以不能只保留一份,必须支持多版本并存 + 切换 active。
//
// 文件布局:
//   data/skills/
//     index.json                 { active: string, versions: [{id, label, notes, createdAt}] }
//     <id>.md                    每个版本的完整 markdown
//
// 设计原则:
//   - 任意时刻只有一个 active 版本,rewrite 链路永远消费 active(不感知版本)。
//   - 外部的 /api/skill GET/PUT 保持向后兼容:GET 返回 active 内容,PUT 写 active 文件。
//   - 版本管理(list / create / activate / delete / rename)通过 /api/skills 新端点做。

import { promises as fs } from "fs";
import path from "path";
import {
  SkillsIndexSchema,
  type SkillsIndex,
  type SkillVersionMeta,
} from "./schema";

const DATA = path.join(process.cwd(), "data");
const SKILLS_DIR = path.join(DATA, "skills");
const INDEX_FILE = path.join(SKILLS_DIR, "index.json");

// id 安全字符:字母/数字/点/下划线/连字符,防路径穿越
const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/i;
export function isSafeSkillId(id: string): boolean {
  return SAFE_ID.test(id) && !id.includes("..") && id.length <= 64;
}

function versionFilePath(id: string): string {
  if (!isSafeSkillId(id)) {
    throw new Error(`invalid skill id: ${id}`);
  }
  return path.join(SKILLS_DIR, `${id}.md`);
}

// ─────────────── 内部:读写 index.json ───────────────

async function readIndex(): Promise<SkillsIndex> {
  const text = await fs.readFile(INDEX_FILE, "utf-8");
  return SkillsIndexSchema.parse(JSON.parse(text));
}

async function writeIndex(index: SkillsIndex): Promise<void> {
  const parsed = SkillsIndexSchema.parse(index);
  // 额外一致性校验:active 必须在 versions 列表里
  if (!parsed.versions.some((v) => v.id === parsed.active)) {
    throw new Error(
      `active "${parsed.active}" not in versions [${parsed.versions.map((v) => v.id).join(",")}]`
    );
  }
  await fs.mkdir(SKILLS_DIR, { recursive: true });
  await fs.writeFile(INDEX_FILE, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
}

// ─────────────── 公开 API ───────────────

export async function loadSkillsIndex(): Promise<SkillsIndex> {
  return readIndex();
}

export async function listSkills(): Promise<SkillVersionMeta[]> {
  return (await readIndex()).versions;
}

export async function loadSkillById(id: string): Promise<string> {
  return fs.readFile(versionFilePath(id), "utf-8");
}

/**
 * 读取当前 active 版本的内容(rewrite 链路用)。
 * index 损坏时抛错,让上层感知——不做静默降级,避免用户以为换了版本但其实没生效。
 */
export async function loadActiveSkill(): Promise<{
  id: string;
  md: string;
}> {
  const idx = await readIndex();
  const md = await loadSkillById(idx.active);
  return { id: idx.active, md };
}

/**
 * 写 active 版本的内容(保持 /api/skill PUT 的向后兼容)。
 */
export async function saveActiveSkill(md: string): Promise<{ id: string }> {
  if (!md || md.length > 200_000) {
    throw new Error("skill content empty or too large");
  }
  const idx = await readIndex();
  await fs.writeFile(versionFilePath(idx.active), md, "utf-8");
  return { id: idx.active };
}

/**
 * 写指定版本的内容。
 */
export async function saveSkillById(id: string, md: string): Promise<void> {
  if (!md || md.length > 200_000) {
    throw new Error("skill content empty or too large");
  }
  // 先确认 id 在 index 里
  const idx = await readIndex();
  if (!idx.versions.some((v) => v.id === id)) {
    throw new Error(`skill version "${id}" not found`);
  }
  await fs.writeFile(versionFilePath(id), md, "utf-8");
}

/**
 * 创建新版本。
 *   - 如果 fromId 存在,复制该版本内容作为起点;否则以空白模板开始
 *   - 自动检查 id 唯一性
 *   - 不自动 activate(用户自己决定何时切)
 */
export async function createSkill(input: {
  id: string;
  label: string;
  notes?: string;
  fromId?: string; // 从哪个版本 fork
}): Promise<SkillVersionMeta> {
  if (!isSafeSkillId(input.id)) {
    throw new Error(`invalid skill id: ${input.id}`);
  }
  if (!input.label.trim()) {
    throw new Error("label is required");
  }
  const idx = await readIndex();
  if (idx.versions.some((v) => v.id === input.id)) {
    throw new Error(`skill id "${input.id}" already exists`);
  }

  // 初始内容:从 fromId 复制,或者用一个温和的占位文本
  let content = "";
  if (input.fromId) {
    if (!idx.versions.some((v) => v.id === input.fromId)) {
      throw new Error(`fromId "${input.fromId}" not found`);
    }
    content = await loadSkillById(input.fromId);
  } else {
    content = `---\nname: prompt_rewriter\nversion: draft\nlabel: ${input.label}\n---\n\n# 这里写改写 AI 的"总说明书"\n\n(新版本,尚未填写内容)\n`;
  }

  await fs.mkdir(SKILLS_DIR, { recursive: true });
  await fs.writeFile(versionFilePath(input.id), content, "utf-8");

  const meta: SkillVersionMeta = {
    id: input.id,
    label: input.label.trim(),
    notes: (input.notes ?? "").trim(),
    createdAt: new Date().toISOString(),
  };
  const next: SkillsIndex = {
    active: idx.active,
    versions: [...idx.versions, meta],
  };
  await writeIndex(next);
  return meta;
}

/**
 * 切换 active 版本。
 */
export async function activateSkill(id: string): Promise<void> {
  const idx = await readIndex();
  if (!idx.versions.some((v) => v.id === id)) {
    throw new Error(`skill version "${id}" not found`);
  }
  if (idx.active === id) return;
  await writeIndex({ ...idx, active: id });
}

/**
 * 删除版本。
 *   - active 版本不能删(防止误伤改写链路)
 *   - 最后一个版本不能删(保证至少留一份兜底)
 *   - 文件删失败不阻塞索引更新(允许"index 已清理,但磁盘文件还在"的宽松状态)
 */
export async function deleteSkill(id: string): Promise<void> {
  const idx = await readIndex();
  if (idx.active === id) {
    throw new Error(`cannot delete active version "${id}"`);
  }
  if (idx.versions.length <= 1) {
    throw new Error("cannot delete the last remaining version");
  }
  const next: SkillsIndex = {
    active: idx.active,
    versions: idx.versions.filter((v) => v.id !== id),
  };
  await writeIndex(next);
  await fs.unlink(versionFilePath(id)).catch(() => {});
}

/**
 * 修改 label / notes(不改内容)。
 */
export async function updateSkillMeta(
  id: string,
  patch: { label?: string; notes?: string }
): Promise<SkillVersionMeta> {
  const idx = await readIndex();
  const i = idx.versions.findIndex((v) => v.id === id);
  if (i < 0) {
    throw new Error(`skill version "${id}" not found`);
  }
  const next = { ...idx.versions[i] };
  if (patch.label !== undefined) {
    if (!patch.label.trim()) throw new Error("label cannot be empty");
    next.label = patch.label.trim();
  }
  if (patch.notes !== undefined) {
    next.notes = patch.notes.trim();
  }
  const versions = [...idx.versions];
  versions[i] = next;
  await writeIndex({ active: idx.active, versions });
  return next;
}
