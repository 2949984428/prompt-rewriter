// prompt-rewriter/lib/atoms-format.ts
//
// Format Lab 专用 atoms。和 atoms.ts 故意分文件:
//   - 主 atoms.ts 是改写实验台的所有状态(query、生图、history、配置等)
//   - 这里是格式实验台 + 当前 lab 切换状态,与改写实验台完全隔离
// 跨 lab 切换时,各自的 atom 互不污染。

import { atom } from "jotai";
import { atomFamily } from "jotai/utils";
import type { FormatRunRecord } from "./schema-format";
import { INITIAL_IMAGE_JOB, type ImageJobState } from "./atoms";

// ─────────── Format Lab 的 N×M 路 image job 状态 ───────────
//
// 多 model 改造后:atomFamily 按"cell key"索引,key = `${format_id}::${image_model}`。
// 同 format_id 不同 model 各自一个 atom,跨 cell 独立。
// 老代码兼容:把 cellKey(formatId, "") 当作"单 model 模式"的入口,跟以前 formatJobAtomFamily(formatId) 等价。
export const formatJobAtomFamily = atomFamily((_cellKey: string) =>
  atom<ImageJobState>(INITIAL_IMAGE_JOB)
);

// (format_id, image_model) → cellKey 串。空 model 表示"用后端默认/单 model 模式"。
export function formatCellKey(formatId: string, imageModel: string): string {
  return `${formatId}::${imageModel}`;
}

// 可选格式池(从 /api/labs/format/skills GET 拉)
export type FormatSkillSummary = {
  id: string;
  label: string;
  notes: string;
};
export const formatSkillsAtom = atom<FormatSkillSummary[]>([]);

// ─────────── Format Lab 的独立抽屉 ───────────
// 与 rewrite lab 的 drawerOpenAtom 完全分开 — top-nav 的设置按钮根据 currentLab
// 决定打开哪个抽屉,互不污染。
export type FormatDrawerTab = "skill" | "history" | "report";
export const formatDrawerOpenAtom = atom<boolean>(false);
export const formatDrawerTabAtom = atom<FormatDrawerTab>("skill");

export type LabId =
  // 测试台分组(顶级 sidebar 可见)
  | "batch"           // "Skill 批量测试台"(原 batch lab,改 label 而已)
  | "format"          // "API 实验台"(原 format lab,改 label)
  | "pipeline-test"   // "Pipeline 测试台"(2026-05-13 新增,Phase 1 占位)
  // 业务工具分组(顶级 sidebar 可见)
  | "pipeline-mgmt"   // "Pipeline 管理"(2026-05-13 新增,列表页)
  | "experiments"
  | "langfuse"
  // 题目分组(顶级 sidebar 可见,subTab 切换)
  | "questions"
  // ─── 隐藏 / 兼容用 LabId(不在 sidebar 显示,代码仍 live)───
  | "pipeline"        // 现 PipelineLab(垂类差异化实验)— 从 pipeline-mgmt 卡片点击进入
  | "rewrite"         // 老垂类实验台,隐藏(暂留代码)
  | "fusion";         // 老融合台,隐藏(暂留代码)

// 当前激活的实验台。刷新页面回到默认 batch(架构重构后,rewrite 已从 sidebar 移除)
export const currentLabAtom = atom<LabId>("batch");

// ─────────── Format Lab 状态 ───────────
//
// query 与改写实验台的 queryAtom 完全独立,切 tab 不会互相覆盖
export const formatQueryAtom = atom<string>("");

// 参考图（base64 data URL）。非空时本 lab 内所有 skill 路都走 image-edit（图生图）。
// 不持久化跨 session（demo 阶段；将来要 retry 跨重启可换 atomWithStorage 但 base64 太大别这么干）。
export const formatReferenceImagesAtom = atom<string[]>([]);

// 选中的格式 id 列表(skills/index.json 里的版本 id)
export const formatSelectedIdsAtom = atom<string[]>([]);

// 选中的"生图模型 name 列表"。空 [] = 单 model 模式(用 imageModelAtom 单选默认值)。
// 非空 = 多 model 笛卡尔积模式(selectedFormats × selectedModels 都跑一遍)。
// 不持久化(切 lab 默认重置)。
export const formatImageModelsAtom = atom<string[]>([]);

// 是否在跑批中(禁用按钮 / 显示骨架)
export const formatRunningAtom = atom<boolean>(false);

// 当前正在展示的跑批结果(N 路并发完后写入)
export const currentFormatRunAtom = atom<FormatRunRecord | null>(null);

// Format Lab 历史(从 /api/labs/format/history GET 拉,评分变化时 PUT 回写)
export const formatHistoryAtom = atom<FormatRunRecord[]>([]);
export const formatHistoryLoadedAtom = atom<boolean>(false);

// ─────────── Format Lab 全局 Lightbox 控制位 ───────────
// 当前正在大图预览的 format_id(也就是 skill_id)。null = 不显示。
// 之所以提到全局 atom:cell 内的 lightbox 状态各自独立,跨 cell 翻页无从下手;
// 提到顶层后,FormatLabLightbox 单例消费 currentFormatRunAtom 拼出图集,
// 任意 cell setActiveId(id) 即可触发预览。
export const formatLightboxFormatIdAtom = atom<string | null>(null);
