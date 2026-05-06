// prompt-rewriter/components/labs/format/format-lightbox.tsx
//
// 格式实验台的全屏大图预览。挂在 lab.tsx 顶层一份(单例),
// 接管所有 FormatCell 的"点图预览"动作。
//
// 工作方式:
//   - FormatCell 点图 → setActiveLightbox(format_id)
//   - 本组件订阅 currentFormatRunAtom + formatLightboxFormatIdAtom
//   - 用 format_runs 里"有 image url 的子集"作为图集
//   - 左右键 / 左右按钮在子集内循环切换;ESC 关闭
//
// 为什么要提到顶层:之前 lightbox 在 cell 内,每个 cell 的 useState
// 各自独立,跨 cell 切换无从下手。提到全局 atom + 单例渲染就解决了。

"use client";

import { useAtom, useAtomValue } from "jotai";
import {
  currentFormatRunAtom,
  formatLightboxFormatIdAtom,
} from "@/lib/atoms-format";
import { ImageLightbox } from "@/components/ui/image-lightbox";

export function FormatLabLightbox() {
  const [activeId, setActiveId] = useAtom(formatLightboxFormatIdAtom);
  const run = useAtomValue(currentFormatRunAtom);

  // 有图的子集(没图的格被跳过,不进入翻页序列)
  const items = (run?.format_runs ?? [])
    .map((r) => ({
      id: r.format_id,
      label: r.format_label,
      url: r.image_job?.urls?.[0],
    }))
    .filter((x): x is { id: string; label: string; url: string } => !!x.url);

  const close = () => setActiveId(null);

  // 没在预览,或者预览的格被清空了 → 渲染 src=null 让 lightbox 自闭合
  if (!activeId || items.length === 0) {
    return <ImageLightbox src={null} onClose={close} />;
  }

  const idx = items.findIndex((x) => x.id === activeId);
  if (idx < 0) {
    // active 已无图(比如刚跑了新一批,但 atom 还指向旧 id),关掉
    return <ImageLightbox src={null} onClose={close} />;
  }

  const cur = items[idx];

  // 翻页 / 角标 / 标题 等扩展能力暂未在 ImageLightbox 中实现 —
  // 等需要时再给 ImageLightbox 增 caption/onPrev/onNext/position props。
  // 当前只透传它已支持的 src/alt/onClose,保证 build 通过。
  return <ImageLightbox src={cur.url} alt={cur.label} onClose={close} />;
}
