// prompt-rewriter/lib/persist-format-history.ts
//
// Format Lab 的 history 落盘工具:debounce PUT 全量列表到 /api/labs/format/history。
//
// 调用频次:跑批后写一次 + 每次 PM 评分/改备注 都要写。
// 用 300ms debounce 合并连续输入(评分滑动 / 备注打字)。

"use client";

import type { FormatRunRecord } from "./schema-format";

let timer: ReturnType<typeof setTimeout> | null = null;

export function persistFormatHistory(items: FormatRunRecord[], delay = 300) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      const resp = await fetch("/api/labs/format/history", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(items),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.warn("[format-history] persist non-200", resp.status, text);
      }
    } catch (e) {
      console.warn("[format-history] persist failed", e);
    }
  }, delay);
}
