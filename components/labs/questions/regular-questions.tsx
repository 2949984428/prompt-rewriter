// prompt-rewriter/components/labs/questions/regular-questions.tsx
//
// 「常规题目」tab 的 shell:根据 currentSetIdAtom 切换显示
//   null   → 题目集列表(SetList)
//   string → 该题目集详情(SetDetail)

"use client";

import { useAtomValue } from "jotai";
import { currentSetIdAtom } from "@/lib/atoms-questions";
import { SetList } from "./set-list";
import { SetDetail } from "./set-detail";

export function RegularQuestions() {
  const currentSetId = useAtomValue(currentSetIdAtom);
  return currentSetId ? <SetDetail setId={currentSetId} /> : <SetList />;
}
