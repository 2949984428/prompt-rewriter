// prompt-rewriter/lib/image-job.ts
//
// A/B 并行出图的共享状态机。
//
// 拆成两块:
//   - startImageJob(setState, input): 纯函数,发起一路任务;不挂轮询。
//     输入场景是任何地方都可能调 (input-bar 点"开始改写"、image-card 点"重试"),
//     所以写成纯函数 + 显式 setter,不依赖组件挂载位置。
//   - useImageJobPoller(atom): 订阅 atom,当 status==="polling" 时起间歇轮询,
//     每 2s 去 /api/image-status/<task>,完成/失败写回 state。
//     必须在组件树的"唯一一处"调用一次 —— 否则会重复轮询。
//     目前由 image-card.tsx 里的 JobColumn 负责每路各挂一次。

"use client";

import { useEffect, useRef } from "react";
import { useAtom } from "jotai";
import type { PrimitiveAtom, SetStateAction } from "jotai";
import {
  INITIAL_IMAGE_JOB,
  type ImageJobParams,
  type ImageJobState,
} from "./atoms";

import {
  IMAGE_POLL_INTERVAL_CLIENT_MS as POLL_INTERVAL_MS,
  IMAGE_POLL_TIMEOUT_MS as MAX_POLL_MS,
} from "./constants";

export type StartImageJobInput = {
  prompt: string;
  size?: string;
  quality?: string;
  n?: number;
  output_format?: string;
};

type JobSetter = (update: SetStateAction<ImageJobState>) => void;
type Artifact = { type?: string; content: string };

/**
 * 发起一路生图任务:清状态 → POST /api/generate-image → 写回 task_id 等 polling 开始。
 * 不挂轮询。返回 void。
 */
export async function startImageJob(
  setState: JobSetter,
  input: StartImageJobInput
): Promise<void> {
  const { prompt } = input;
  if (!prompt?.trim()) return;

  const params: ImageJobParams = {
    size: input.size,
    quality: input.quality,
    n: input.n,
    output_format: input.output_format,
  };
  setState({
    ...INITIAL_IMAGE_JOB,
    status: "creating",
    startedAt: Date.now(),
    prompt,
    params,
  });

  try {
    const resp = await fetch("/api/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await resp.json();
    if (!resp.ok) {
      setState((prev) => ({
        ...prev,
        status: "failed",
        error: data.error ?? `HTTP ${resp.status}`,
        finishedAt: Date.now(),
      }));
      return;
    }
    setState((prev) => ({
      ...prev,
      status: "polling",
      taskId: data.task_id,
      size: data.resolved_params?.size ?? prev.size,
      params: { ...prev.params, ...(data.resolved_params ?? {}) },
    }));
  } catch (e) {
    setState((prev) => ({
      ...prev,
      status: "failed",
      error: String(e),
      finishedAt: Date.now(),
    }));
  }
}

/**
 * 轮询 hook:订阅一个 ImageJobState atom。status==="polling" 期间每 2s 拉一次状态,
 * completed / failed 自动停。必须保证"全树只调用一次" —— 否则会重复打 API。
 * 返回当前 state + 一个 reset() 方便调用方清屏。
 */
export function useImageJobPoller(atom: PrimitiveAtom<ImageJobState>) {
  const [state, setState] = useAtom(atom);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (state.status !== "polling" || !state.taskId) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }
    if (pollingRef.current) clearInterval(pollingRef.current);

    const startTs = Date.now();
    const taskId = state.taskId;

    const tick = async () => {
      if (Date.now() - startTs > MAX_POLL_MS) {
        setState((prev) => ({
          ...prev,
          status: "failed",
          error: `轮询超过 ${MAX_POLL_MS / 1000}s 未出结果`,
          finishedAt: Date.now(),
        }));
        return;
      }
      try {
        const resp = await fetch(
          `/api/image-status/${encodeURIComponent(taskId)}`,
          { cache: "no-store" }
        );
        const data = await resp.json();
        if (!resp.ok) {
          setState((prev) => ({
            ...prev,
            status: "failed",
            error: data.error ?? `HTTP ${resp.status}`,
            finishedAt: Date.now(),
          }));
          return;
        }
        if (data.status === "completed") {
          const gatewayUrls: string[] = ((data.artifacts ?? []) as Artifact[])
            .filter((a) => a.type === "image")
            .map((a) => a.content);
          // 服务端 image-status 路由会把 gateway 临时 url 下载落盘,返回 local_paths。
          // 优先用 local(永久可访问、防 gateway 过期);只有数量对齐时才替换,
          // 否则退回 gateway url 避免某张落盘失败导致顺序错乱。
          const rawLocal = (data as { local_paths?: unknown }).local_paths;
          const localPaths: string[] = Array.isArray(rawLocal)
            ? rawLocal.filter(
                (p: unknown): p is string => typeof p === "string" && p.length > 0
              )
            : [];
          const finalUrls =
            localPaths.length === gatewayUrls.length ? localPaths : gatewayUrls;
          setState((prev) => ({
            ...prev,
            urls: finalUrls,
            cost: typeof data.cost === "number" ? data.cost : null,
            status: "completed",
            finishedAt: Date.now(),
          }));
        } else if (data.status === "failed") {
          setState((prev) => ({
            ...prev,
            status: "failed",
            error:
              typeof data.error_details === "string"
                ? data.error_details
                : JSON.stringify(data.error_details ?? {}),
            finishedAt: Date.now(),
          }));
        }
        // submitted / running 继续等下一 tick
      } catch (e) {
        setState((prev) => ({
          ...prev,
          status: "failed",
          error: String(e),
          finishedAt: Date.now(),
        }));
      }
    };

    tick();
    pollingRef.current = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [state.status, state.taskId, setState]);

  const reset = () => setState(INITIAL_IMAGE_JOB);
  return { state, setState, reset };
}
