// prompt-rewriter/lib/use-copy-image-state.ts
//
// 复制图到剪贴板的状态机 hook,4 个 lab 之前各写了一份(lightbox /
// format-cell / batch score-drawer / image-card 的 lightbox 入口)。
//
// 状态:idle → copying → copied|error → (auto-reset) → idle
// 设计:
//   - copying 中重复点击会被忽略(避免触发多次写剪贴板)
//   - reset 用 useRef 持有 timer,重复点击或组件卸载时清掉,无 stale state set
//   - 默认 reset 时长贴近原 lightbox/format-cell(1600/2400),
//     原 score-drawer 用的 1500/2000 略快,需要时显式传

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { copyImageToClipboard } from "@/lib/copy-image";
import {
  COPY_SUCCESS_RESET_MS,
  COPY_ERROR_RESET_MS,
} from "@/lib/constants";

export type CopyImageState = "idle" | "copying" | "copied" | "error";

export type UseCopyImageStateOptions = {
  successResetMs?: number;
  errorResetMs?: number;
};

export function useCopyImageState(opts: UseCopyImageStateOptions = {}) {
  const {
    successResetMs = COPY_SUCCESS_RESET_MS,
    errorResetMs = COPY_ERROR_RESET_MS,
  } = opts;
  const [state, setState] = useState<CopyImageState>("idle");
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 卸载时清 timer,避免 setState on unmounted
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const scheduleReset = (ms: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setState("idle");
      setError(null);
      timerRef.current = null;
    }, ms);
  };

  const copy = useCallback(
    async (url: string | null | undefined) => {
      if (!url || state === "copying") return;
      setState("copying");
      setError(null);
      try {
        await copyImageToClipboard(url);
        setState("copied");
        scheduleReset(successResetMs);
      } catch (e) {
        setState("error");
        setError(e instanceof Error ? e.message : String(e));
        scheduleReset(errorResetMs);
      }
    },
    // state 进 deps 是为了"copying 中忽略点击"的正确性,但这会导致函数引用
    // 每次 state 变都换新;消费方一般不把 copy 传到 memo 里所以问题不大
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, successResetMs, errorResetMs]
  );

  // 显式 reset:消费方在某个外部信号(如 lightbox 切到下一张图)出现时
  // 立刻清状态,避免上一次成功提示误导用户以为是新图复制成功
  const reset = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setState("idle");
    setError(null);
  }, []);

  return { state, error, copy, reset };
}
