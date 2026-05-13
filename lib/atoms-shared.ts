// prompt-rewriter/lib/atoms-shared.ts
//
// 跨 lab 共享的偏好 atom。两个原则：
// 1. 只放"哪几个 lab 都要用、且是用户偏好"的设置（不是 lab 独有的运行参数）
// 2. atomWithStorage 持久化到 localStorage，重启浏览器也保留
//
// 现有 lab 各自的 state（query / skill 选择 / 评分维度）继续放各自的 atoms-<lab>.ts，不要往这里塞。

import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { ModelConstraints } from "./model-constraints";

// "在每条 skill 前注入通用规则 (_universal.md)" 的全局默认值。
// format / batch 两个 lab 的创建表单初始值从这个 atom 读；用户在表单里改动会同步回这个 atom，
// 下次打开（任一 lab）默认都跟着走。
//
// per-run 的真实值仍然 per-lab 落到 record / 提交 body，prefill 历史不受影响。
export const includeUniversalDefaultAtom = atomWithStorage<boolean>(
  "lab.includeUniversal.default",
  true
);

// ─────────── 生图模型(跨 lab 共享) ───────────
//
// 当前选中的图像模型 name(路由用):
//   - "gpt-image-2" 走内部 image gateway
//   - "vertex/anon-bob" / "kling/kling-v2-6" 等含 "/" 的走 Lovart Agent
// 默认空串 = 后端按 env IMAGE_MODEL 兜底(目前 gpt-image-2)。
// 选中后通过 fetch body 的 model 字段传给 /api/generate-image,由 lib/image-router 分发。
export const imageModelAtom = atomWithStorage<string>(
  "lab.imageModel",
  "" // "" = 后端默认
);

// /api/image-generators 拉来的清单缓存。组件挂载时拉一次,刷页面才重新拉。
// 用普通 atom 不持久化(清单可能版本迭代,本地缓存反而误导)。
export type ImageGeneratorOption = {
  name: string;
  display_name: string;
  icon: string;
  description: string;
  type: string; // image / image-modify
  provider: "igw" | "lovart";
  // 后端合并好的有效约束(default + provider + per-model overlay)。
  // 前端 ImageUploader 等组件按 model 查这里,不再硬编码字节/张数/格式。
  constraints: ModelConstraints;
};
export const imageGeneratorOptionsAtom = atom<ImageGeneratorOption[]>([]);
export const imageGeneratorDefaultAtom = atom<string>("");

// 派生:从当前选中 model 推它的有效约束(空表 / model 不在表里时返回 null,组件自己兜默认)
export const currentImageConstraintsAtom = atom<ModelConstraints | null>((get) => {
  const opts = get(imageGeneratorOptionsAtom);
  if (opts.length === 0) return null;
  const sel = get(imageModelAtom) || get(imageGeneratorDefaultAtom);
  const hit = opts.find((o) => o.name === sel);
  return hit?.constraints ?? null;
});
