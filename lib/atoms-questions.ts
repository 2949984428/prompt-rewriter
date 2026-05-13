// prompt-rewriter/lib/atoms-questions.ts
//
// 题目库 lab 状态。每 lab 独立 atoms 文件(参考 CLAUDE.md "故意不复用")。

import { atom } from "jotai";
import type { QuestionHead } from "./questions/schema";

// 2026-05-13:lab 内二级 tab
//   regular    —— 常规题目列表(原始功能)
//   tags       —— 标签管理(PM 自定义 tag · 统计 + 重命名 + 删除)
//   categories —— 分类视图(xlsx 源数据的 L1/L2 · 只读统计 + 浏览)
export type QuestionsLabTab = "regular" | "tags" | "categories";
export const questionsLabTabAtom = atom<QuestionsLabTab>("regular");

// 列表过滤态
export const questionsFilterL1Atom = atom<string>("");          // 选中的 L1(空 = 全)
export const questionsFilterL2Atom = atom<string>("");
export const questionsFilterQAtom = atom<string>("");           // 关键词
export const questionsFilterHasImagesAtom = atom<"all" | "yes" | "no">("all");

// 列表分页
export const questionsLimitAtom = atom<number>(50);
export const questionsOffsetAtom = atom<number>(0);

// 列表数据
export const questionsListAtom = atom<{
  items: QuestionHead[];
  total: number;
  loading: boolean;
  error: string | null;
}>({ items: [], total: 0, loading: false, error: null });

// L1/L2 全集(从 API 拉,给筛选下拉用)
export const questionsCategoriesAtom = atom<{
  l1: { name: string; count: number }[];
  l2_by_l1: Record<string, { name: string; count: number }[]>;
}>({ l1: [], l2_by_l1: {} });

export const questionsMetaAtom = atom<{
  last_import_at?: string;
  source_filename?: string;
  count?: number;
} | null>(null);

// 当前选中查看的 qid(右侧详情面板,或 modal)
export const questionsSelectedQidAtom = atom<string | null>(null);

// 2026-05-13:两级框架 —— 常规题目 tab 内的 navigation。
//   null   = 显示题目集列表(默认入口)
//   string = 显示该 set_id 的题目集详情
export const currentSetIdAtom = atom<string | null>(null);

// 2026-05-13:全局刷新触发器。
// 导入 xlsx / tag rename / tag delete 等会改 items.json 的操作,完成后 setTick((n)=>n+1),
// 三个 tab 组件(regular / tags / categories)useEffect 都把 tick 放 deps 里,触发自动重拉。
// 这样导入后不用 window.location.reload(),atom 状态不丢、用户停留在原 tab。
export const questionsRefreshTickAtom = atom<number>(0);
