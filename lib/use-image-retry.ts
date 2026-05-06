// prompt-rewriter/lib/use-image-retry.ts
//
// 客户端生图重试 hook,薄包装 useImageJobPoller。
//
// 用途:rewrite lab 的 ImageCard 和 format lab 的 FormatCell 各自原本写了
// 一份同构的 retry 逻辑(检查 inflight + buildInput + startImageJob)。
// 抽出来:消费方只关心"重试时该打什么 prompt + 参数"。
//
// **不**适用于 batch lab 的"重试这一格" —— 那个是 POST /api/labs/batch/...,
// 走服务端重新跑 LLM + 创图,语义完全不同(整个 cell 重做),不是客户端 retry。

"use client";

import { useCallback } from "react";
import type { PrimitiveAtom } from "jotai";
import {
  startImageJob,
  useImageJobPoller,
  type StartImageJobInput,
} from "@/lib/image-job";
import type { ImageJobState } from "@/lib/atoms";

export function useImageRetry(
  atom: PrimitiveAtom<ImageJobState>,
  // 当前路应该打什么。返回 null 表示"无可重试 input",button 应禁用
  buildInput: () => StartImageJobInput | null
): {
  state: ImageJobState;
  setState: ReturnType<typeof useImageJobPoller>["setState"];
  reset: ReturnType<typeof useImageJobPoller>["reset"];
  canRetry: boolean;
  onRetry: () => void;
} {
  const { state, setState, reset } = useImageJobPoller(atom);
  const isInflight =
    state.status === "creating" || state.status === "polling";
  const canRetry = !isInflight && buildInput() !== null;

  const onRetry = useCallback(() => {
    if (isInflight) return;
    const input = buildInput();
    if (input) void startImageJob(setState, input);
    // buildInput 是消费方每次 render 重新 closure 的函数,故意不进 deps ——
    // 否则 onRetry 引用每次 render 都换,会让消费方传给子组件时频繁重渲染。
    // 反正点击瞬间会用最新闭包,不会 stale。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInflight, setState]);

  return { state, setState, reset, canRetry, onRetry };
}
