// prompt-rewriter/lib/atoms-history-index.ts
//
// 跨实验台的全局索引 atoms。
//   - 启动期 Bootstrap 拉一次 /api/history-index 填进 atom
//   - 顶栏「🕘 历史」按钮打开 modal 直接消费这个 atom
// 详情按需懒加载,这里只装索引(轻量)。

"use client";

import { atom } from "jotai";
import type { HistoryIndexEntry } from "./schema-history-index";

export const historyIndexAtom = atom<HistoryIndexEntry[]>([]);
export const historyIndexLoadedAtom = atom<boolean>(false);

// 全局历史 modal 开关 + 当前筛选(all / rewrite / format / batch / fusion)
export type GlobalHistoryFilter =
  | "all"
  | "rewrite"
  | "format"
  | "batch"
  | "fusion";
export const globalHistoryOpenAtom = atom<boolean>(false);
export const globalHistoryFilterAtom = atom<GlobalHistoryFilter>("all");
