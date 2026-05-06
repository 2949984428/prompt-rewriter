// prompt-rewriter/lib/persist-history.ts
//
// 客户端 history 持久化:debounce 把 historyAtom 的最新状态 PUT 到 /api/history。
//
// 之所以放在客户端 fire-and-forget:
//   - 服务端不知道"哪些是用户手动删除"vs"哪些是 partial state",由前端聚合后整体 PUT 最简单。
//   - debounce 300ms 合并连续写(改写完一次 + baseline 完成 + optimized 完成 = 短时间 3 次写)。
//   - 失败只 console.warn 不阻塞 UI —— history 是辅助分析,不影响主流程。

"use client";

import type { HistoryItem } from "./schema";

let timer: ReturnType<typeof setTimeout> | null = null;

export function persistHistory(items: HistoryItem[], delay = 300) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      const resp = await fetch("/api/history", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(items),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.warn("[history] persist non-200", resp.status, text);
      }
    } catch (e) {
      console.warn("[history] persist failed", e);
    }
  }, delay);
}

// djb2 字符串 hash。SHA-256 太重(crypto.subtle 异步),用 djb2 同步算 8 位十六进制即可。
// 用途:配置快照里记录 skill.md / model_profile.md 的版本,而非全文。
export function djb2Hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  // toString(16) 可能带负号,转成无符号 8 位
  return (h >>> 0).toString(16).padStart(8, "0");
}
