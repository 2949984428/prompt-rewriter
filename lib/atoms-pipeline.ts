// prompt-rewriter/lib/atoms-pipeline.ts
//
// Pipeline lab 抽屉与配置态。
// 与 atoms.ts / atoms-format.ts 故意不复用,避免跨 lab 污染。

import { atom } from "jotai";

// 抽屉一级 tab:SP1 / SP2 两个
export type PipelineDrawerMainTab = "sp1" | "sp2";

// SP2 下的二级 tab:改写 SP / 策略库 / Creation Planner
// (策略库走 master/detail 交互:vertical chip 驱动,折叠展开,跨 vertical_standard + platform_tone 两个 namespace 一体编辑)
// (Creation Planner 2026-05-12 加:从 mock 升级真 LLM 推理,SP 单独 namespace 管 size 启发式)
export type PipelineSp2SubTab = "rewrite" | "strategy" | "planner";

export const pipelineDrawerOpenAtom = atom<boolean>(false);
export const pipelineDrawerMainTabAtom = atom<PipelineDrawerMainTab>("sp1");
export const pipelineSp2SubTabAtom = atom<PipelineSp2SubTab>("rewrite");

// Pipeline 两步各自的 LLM 模型选择 ──
//   - SP1 默认 Gemini 3 Flash:意图分类对成本敏感、低延迟 + 含 reasoning 模式
//   - SP2 默认 Doubao Seed 2.0 Pro:中文母语 + thinking 模式,改写质量稳
//   - 空字符串 = 回退到全局 llmModelAtom 默认(picker 下拉的「默认」选项)
export const pipelineSearchModelAtom = atom<string>("gemini/gemini-3-flash-preview");
export const pipelineReviewModelAtom = atom<string>("doubao/seed-2-0-pro-260215");

// Step 3 生图模型 ── 空字符串 = 后端默认 "gpt-image-2"
// 通过 /api/image-generators 拉到的清单里选,既支持内部网关也支持 Lovart 的 image / image-modify
export const pipelineImageModelAtom = atom<string>("");

// 编辑器内容 atom(从 /api/labs/pipeline GET 拉)
export const pipelineSpClassificationAtom = atom<string>("");
export const pipelineSpRewriteAtom = atom<string>("");
export const pipelineVerticalStandardAtom = atom<string>("");  // JSON 文本
export const pipelinePlatformToneAtom = atom<string>("");      // JSON 文本

// 保存状态(同一时刻只有一个 tab 在保存,共用)
export type PipelineSaveStatus = "idle" | "saving" | "saved" | "error";
export const pipelineSaveStatusAtom = atom<PipelineSaveStatus>("idle");

// bootstrap 加载完毕标志(避免首屏空字符串触发保存覆盖)
export const pipelineConfigLoadedAtom = atom<boolean>(false);

// ─── Step 3 单格手动重试 mailbox ───
// GenerationCard 触发重试时,本地 fetch /retry-image 拿到 NDJSON 流,把每条 phase 事件
// 写到这个 atom;PipelineLab 用 useEffect 订阅,转交给同一份 handleStreamPhase reducer。
// _seq 单调自增,确保即使消息内容一样也能触发重新处理。
export type PipelineStreamMsg = {
  phase: string;
  data: unknown;
  _seq: number;
};
export const pipelineStreamMailboxAtom = atom<PipelineStreamMsg | null>(null);
