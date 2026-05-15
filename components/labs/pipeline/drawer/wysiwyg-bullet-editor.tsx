// prompt-rewriter/components/labs/pipeline/drawer/wysiwyg-bullet-editor.tsx
//
// 轻量 WYSIWYG bullet 编辑器,服务垂类策略库 / 平台调性的简单场景:
//   - 数据形态:一行一条 plain text,行内可以有 **加粗** / *斜体*
//   - 渲染形态:bullet list(LLM 注入时一一对应 `- ${line}`)
//   - 用户体验:双击 list 区域直接进 contentEditable 模式,改完失焦自动保存
//
// 故意不引入 @tiptap / @lexical 之类富文本框架:这个场景就是 bullet + bold/em,
// 用 contentEditable + 自写 htmlToMd 50 行代码搞定,无新依赖。
//
// 限制(可接受):
//   - 不支持嵌套 bullet
//   - 不支持表格 / 代码块 / 链接(原数据里就没有)
//   - 浏览器默认 contentEditable 行为差异:Enter 通常会产生 <div>,我们 fallback 当作新行处理

"use client";

import { useEffect, useRef, useState } from "react";

export function WysiwygBulletEditor({
  value,
  onChange,
  placeholder = "双击进入编辑",
}: {
  value: string; // 每行一条 plain text(可含 **/* 标记)
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState(false);
  // initialHtml 只在 editing 切换时 setInnerHTML,不在 editing=true 时被 react 重渲覆盖(否则光标位置丢失)
  const [htmlSeed, setHtmlSeed] = useState<string>(() => mdToHtml(value));

  // value 在父级变化(切版本 / 切 vertical)时 → 重新 seed html。但编辑中(editing=true)不要打断
  useEffect(() => {
    if (!editing) {
      setHtmlSeed(mdToHtml(value));
    }
  }, [value, editing]);

  const startEdit = () => {
    if (editing) return;
    setEditing(true);
    // 等下一帧 contentEditable 生效后聚焦
    setTimeout(() => {
      ref.current?.focus();
    }, 0);
  };

  const commit = () => {
    if (!ref.current) return;
    const html = ref.current.innerHTML;
    const md = htmlToMd(html);
    if (md !== value) onChange(md);
    setEditing(false);
  };

  return (
    <div
      ref={ref}
      contentEditable={editing}
      suppressContentEditableWarning
      onDoubleClick={startEdit}
      onBlur={commit}
      title={editing ? "编辑中,失焦自动保存" : "双击进入编辑"}
      // dangerouslySetInnerHTML 只在 editing=false 时受 htmlSeed 控制;editing=true 后不让 react 控制
      dangerouslySetInnerHTML={{
        __html: htmlSeed.length > 0 ? htmlSeed : `<p class="text-stone-gray">${placeholder}</p>`,
      }}
      className={`prose prose-warm max-w-none rounded-md border px-4 py-3 text-[13px] focus:outline-none ${
        editing
          ? "border-terracotta bg-ivory"
          : "cursor-pointer border-border-cream bg-parchment/40 hover:border-border-warm"
      }`}
    />
  );
}

// ─────────── md ↔ html 简单转换 ───────────

// 一行一条 plain text(可含 **/* 标记) → 一个 <ul><li>...</li></ul> HTML
export function mdToHtml(text: string): string {
  const lines = text
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (lines.length === 0) return "";
  const items = lines.map((line) => `<li>${inlineMdToHtml(line)}</li>`);
  return `<ul>${items.join("")}</ul>`;
}

function inlineMdToHtml(line: string): string {
  return escapeHtml(line)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// contentEditable innerHTML → 一行一条 plain text(回到 markdown 形态)
export function htmlToMd(html: string): string {
  if (typeof window === "undefined") return "";
  const root = document.createElement("div");
  root.innerHTML = html;
  // 候选行容器:<li> 优先(用户对着 ul 编辑);没 li 时 fallback 用 <p> / <div> / 顶层文本行
  const liNodes = root.querySelectorAll("li");
  const collectFromNodes = (nodes: NodeListOf<Element> | Element[]) => {
    const out: string[] = [];
    nodes.forEach((node) => {
      const line = nodeToMd(node).trim();
      if (line) out.push(line);
    });
    return out;
  };
  if (liNodes.length > 0) {
    return collectFromNodes(liNodes).join("\n");
  }
  // 没 li:看顶层 <p> / <div>
  const blockNodes = root.querySelectorAll("p, div");
  if (blockNodes.length > 0) {
    return collectFromNodes(blockNodes).join("\n");
  }
  // 兜底:整个 innerHTML 按 <br> 分行
  return nodeToMd(root)
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join("\n");
}

// 一个 element → markdown 字符串(只处理 strong/em/b/i/br + 文本)
function nodeToMd(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (tag === "br") return "\n";
  const inner = Array.from(el.childNodes).map(nodeToMd).join("");
  if (tag === "strong" || tag === "b") return `**${inner}**`;
  if (tag === "em" || tag === "i") return `*${inner}*`;
  return inner;
}
