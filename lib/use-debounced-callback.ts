// prompt-rewriter/lib/use-debounced-callback.ts
//
// 防抖回调 hook。返回一个稳定函数引用,每次调用 reset 内部 timer,
// 等 delay ms 后真正执行 fn(...lastArgs)。
//
// 设计:
//   - 不绑定参数到闭包:每次都用最新的 args 触发(常见 debounce 语义)
//   - latestFn ref:fn 可以在 render 间变,debounce 永远跑当前最新版本,
//     不会跑陈旧版本(避免 stale closure)
//   - flush() / cancel() 显式 API,需要立即落盘 / 取消时用
//   - 卸载时自动 cancel,避免 setState on unmounted

"use client";

import { useCallback, useEffect, useRef } from "react";

export function useDebouncedCallback<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void | Promise<void>,
  delay: number
): {
  call: (...args: TArgs) => void;
  flush: () => void;
  cancel: () => void;
} {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const argsRef = useRef<TArgs | null>(null);
  const fnRef = useRef(fn);
  // 每次 render 同步最新 fn,避免 timer 触发时跑陈旧版本
  fnRef.current = fn;

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    argsRef.current = null;
  }, []);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (argsRef.current) {
      const args = argsRef.current;
      argsRef.current = null;
      void fnRef.current(...args);
    }
  }, []);

  const call = useCallback(
    (...args: TArgs) => {
      argsRef.current = args;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const a = argsRef.current;
        argsRef.current = null;
        if (a) void fnRef.current(...a);
      }, delay);
    },
    [delay]
  );

  // 卸载时取消 pending 调用,防止 setState on unmounted
  useEffect(() => cancel, [cancel]);

  return { call, flush, cancel };
}
