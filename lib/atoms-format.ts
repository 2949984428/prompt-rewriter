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

// ─────────── Format Lab 的 N 路 image job 状态 ───────────
//
// atomFamily 按 format_id (= skill_id) 索引 — 每个格式自动拥有自己的 ImageJobState atom。
// FormatCell 组件用 useImageJobPoller(formatJobAtomFamily(format_id)) 各自挂轮询。
// 跨 format_id 状态独立,不互相影响。
export const formatJobAtomFamily = atomFamily((_formatId: string) =>
  atom<ImageJobState>(INITIAL_IMAGE_JOB)
);

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

export type LabId = "rewrite" | "format" | "batch" | "fusion";

// 当前激活的实验台。刷新页面回到默认 rewrite(不持久化,demo 阶段够用)
export const currentLabAtom = atom<LabId>("rewrite");

// ─────────── Format Lab 状态 ───────────
//
// query 与改写实验台的 queryAtom 完全独立,切 tab 不会互相覆盖
export const formatQueryAtom = atom<string>("");

// 选中的格式 id 列表(skills/index.json 里的版本 id)
export const formatSelectedIdsAtom = atom<string[]>([]);

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
