// prompt-rewriter/components/drawer/md-preview.tsx
"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function splitFrontmatter(src: string): { fm: string | null; body: string } {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: null, body: src };
  return { fm: m[1], body: src.slice(m[0].length) };
}

/**
 * Drawer 里用的 Markdown 预览组件。
 * - 支持 GFM(表格/任务列表/删除线)
 * - 自动识别并单独展示 frontmatter
 * - 样式走 @tailwindcss/typography 的 `prose`,叠加 `prose-warm` 暖色覆写
 */
export function MdPreview({
  source,
  className = "",
}: {
  source: string;
  className?: string;
}) {
  const { fm, body } = splitFrontmatter(source);
  const trimmed = body.trim();
  return (
    <div className={`prose prose-sm prose-warm max-w-none ${className}`}>
      {fm && (
        <div className="not-prose mb-5 border-l-2 border-warm-silver pl-3 font-mono text-[11px] leading-[1.7] whitespace-pre-wrap text-olive-gray">
          {fm}
        </div>
      )}
      {trimmed ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{trimmed}</ReactMarkdown>
      ) : (
        <p className="text-[13px] italic text-stone-gray">（内容为空）</p>
      )}
    </div>
  );
}

/**
 * 右对齐的 "编辑 | 预览" 切换按钮(分段控制器)。
 * 未激活态用 parchment 底 + 深字色,保证在 ivory 面板上清晰可见。
 */
export function MdViewSwitcher({
  view,
  onChange,
}: {
  view: "edit" | "preview";
  onChange: (v: "edit" | "preview") => void;
}) {
  return (
    <div
      role="tablist"
      className="inline-flex shrink-0 overflow-hidden rounded-md bg-parchment text-[12px] font-medium shadow-ring divide-x divide-border-warm"
    >
      {(["edit", "preview"] as const).map((v) => {
        const active = v === view;
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(v)}
            className={`px-3 py-1.5 transition ${
              active
                ? "bg-terracotta text-ivory"
                : "text-charcoal-warm hover:bg-warm-tea-deeper"
            }`}
          >
            {v === "edit" ? "编辑" : "预览"}
          </button>
        );
      })}
    </div>
  );
}
