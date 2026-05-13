// prompt-rewriter/lib/atoms-pipeline-strategies.ts
//
// Pipeline 抽屉的 4 个 namespace Index atoms。
// 每个 namespace 独立 atom 故意不复用(对齐 CLAUDE.md "每个 lab 一个独立 atoms 文件"原则)。
//
// 后端 schema 参考 BE Agent vfs.md 第 3.2 节 VersionMeta / Index。
// 这里不引入 lib/strategies/registry 的 Zod schema,前端只用结构化的 TS 类型(避免把 server 模块拖进 client bundle)。

import { atom } from "jotai";

export type VersionMeta = {
  id: string;
  label: string;
  notes: string;
  createdAt: string;
  author: string;
};

export type Index = {
  active: string;
  versions: VersionMeta[];
};

const EMPTY_INDEX: Index = { active: "", versions: [] };

// 5 个 namespace 各一个 atom,故意不收编到 Map(每个组件用 useAtom 拿到完整的 [val, set],类型最清晰)
export const verticalIndexAtom = atom<Index>(EMPTY_INDEX);
export const platformIndexAtom = atom<Index>(EMPTY_INDEX);
export const sp1IndexAtom = atom<Index>(EMPTY_INDEX);
export const sp2IndexAtom = atom<Index>(EMPTY_INDEX);
// 2026-05-12 加:CreationPlanner 从 mock 升级真 LLM 推理,SP 单独 namespace
export const plannerIndexAtom = atom<Index>(EMPTY_INDEX);
