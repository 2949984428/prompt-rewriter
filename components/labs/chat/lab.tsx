// prompt-rewriter/components/labs/chat/lab.tsx
//
// 业务工具 · 对话 lab。多模态对话,UX 参考 Claude:
//   - 消息列表上方,流式打字
//   - 底部 textarea 输入(Cmd+Enter / Enter 发送,Shift+Enter 换行)
//   - 图片上传(文件按钮 + Cmd+V 粘贴 + 拖拽,走 R2 拿 URL)
//   - 顶部模型选择器(复用 LlmModelSwitcher)+ 新会话按钮
//   - 不持久化(刷新清空 messages),demo 阶段简化

"use client";

import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { Send, Trash2, User, Sparkles } from "lucide-react";
import { llmModelAtom } from "@/lib/atoms";
import { LlmModelSwitcher } from "@/components/llm-model-switcher";
import { ImageUploader } from "@/components/image-uploader";
import { MdPreview } from "@/components/drawer/md-preview";

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };
type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string; streaming?: boolean; error?: string };

export function ChatLab() {
  const llmModel = useAtomValue(llmModelAtom);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [refImages, setRefImages] = useState<string[]>([]); // R2 URL[]
  const [refUploading, setRefUploading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 自适应高度 + 滚到底
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [input]);
  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const canSend = (input.trim().length > 0 || refImages.length > 0) && !running && !refUploading;

  const reset = () => {
    setMessages([]);
    setInput("");
    setRefImages([]);
    setError(null);
  };

  const send = async () => {
    if (!canSend) return;
    setError(null);
    // 拼用户消息:有图 → content parts,无图 → string
    const userContent: ChatMessage["content"] =
      refImages.length > 0
        ? [
            ...(input.trim() ? [{ type: "text" as const, text: input.trim() }] : []),
            ...refImages.map((url) => ({
              type: "image_url" as const,
              image_url: { url },
            })),
          ]
        : input.trim();
    const newUserMsg: ChatMessage = { role: "user", content: userContent };
    const placeholderAsst: ChatMessage = { role: "assistant", content: "", streaming: true };
    const nextMessages = [...messages, newUserMsg];
    setMessages([...nextMessages, placeholderAsst]);
    setInput("");
    setRefImages([]);
    setRunning(true);

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          llm_model: llmModel || undefined,
        }),
      });
      if (!resp.ok || !resp.body) {
        const text = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}: ${text || "no body"}`);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let accumulated = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let msg: { phase: string; data: Record<string, unknown> };
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (msg.phase === "delta") {
            accumulated += String(msg.data.content ?? "");
            // 增量更新最后一条 assistant 消息
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                next[next.length - 1] = { ...last, content: accumulated };
              }
              return next;
            });
          } else if (msg.phase === "done") {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                next[next.length - 1] = { ...last, streaming: false };
              }
              return next;
            });
          } else if (msg.phase === "error") {
            const err = String(msg.data.error ?? "未知错误");
            setError(err);
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                next[next.length - 1] = { ...last, streaming: false, error: err };
              }
              return next;
            });
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant") {
          next[next.length - 1] = { ...last, streaming: false, error: msg };
        }
        return next;
      });
    } finally {
      setRunning(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 发送(Shift+Enter 换行)
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-180px)] flex-col">
      {/* 顶栏 */}
      <header className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-[28px] font-medium text-near-black">对话</h1>
          <p className="mt-1 text-[13px] text-stone-gray">
            多模态对话:支持文本 + 图像。Enter 发送,Shift+Enter 换行,Cmd+V 粘贴图片
          </p>
        </div>
        <div className="flex items-center gap-3">
          <LlmModelSwitcher />
          <button
            onClick={reset}
            disabled={messages.length === 0}
            className="flex h-9 items-center gap-1.5 rounded-md border border-border-cream bg-ivory px-3 text-[13px] text-olive-gray transition hover:border-stone-gray hover:text-near-black disabled:cursor-not-allowed disabled:opacity-40"
            title="清空当前对话"
          >
            <Trash2 size={14} />
            新会话
          </button>
        </div>
      </header>

      {/* 消息列表 */}
      <div
        ref={scrollerRef}
        className="flex-1 space-y-5 overflow-y-auto rounded-lg border border-border-cream bg-ivory px-6 py-6"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-stone-gray">
            <Sparkles size={28} className="opacity-40" />
            <p className="text-[14px]">开始一段对话 — 输入文本或粘贴图片</p>
          </div>
        ) : (
          messages.map((m, i) => <MessageBlock key={i} m={m} />)
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
          ⚠ {error}
        </div>
      )}

      {/* 输入区 */}
      <div className="mt-4 rounded-lg border border-border-cream bg-ivory p-3">
        {/* 图片上传 + 已传缩略图 */}
        <ImageUploader
          value={refImages}
          onChange={setRefImages}
          label=""
          hint="附图后,LLM 会基于图内容回答(模型需支持多模态)"
          useR2Upload
          enableUrlInput
          enablePaste
          onBusyChange={setRefUploading}
        />
        {/* textarea + 发送 */}
        <div className="mt-2 flex items-end gap-2">
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              refUploading
                ? "图片上传中..."
                : "输入消息(Enter 发送,Shift+Enter 换行)"
            }
            rows={1}
            className="min-h-[40px] flex-1 resize-none rounded-md border border-border-cream bg-parchment/40 px-3 py-2 font-sans text-[14px] leading-[1.6] text-near-black placeholder:text-stone-gray focus:border-terracotta focus:bg-ivory focus:outline-none"
          />
          <button
            onClick={send}
            disabled={!canSend}
            className="flex h-10 items-center gap-1.5 rounded-md bg-terracotta px-4 text-[13.5px] font-medium text-ivory transition hover:bg-terracotta/90 disabled:cursor-not-allowed disabled:opacity-40"
            title={running ? "回复中..." : !canSend ? "输入内容后发送" : "发送(Enter)"}
          >
            <Send size={14} />
            {running ? "回复中" : "发送"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBlock({ m }: { m: ChatMessage }) {
  if (m.role === "system") return null;
  const isUser = m.role === "user";
  // user content 可能是 string 或 parts[]
  const text =
    typeof m.content === "string"
      ? m.content
      : (m.content.find((p) => p.type === "text")?.text ?? "");
  const imageUrls =
    typeof m.content === "string"
      ? []
      : m.content.filter((p) => p.type === "image_url").map((p) => p.image_url.url);
  return (
    <div className={`flex gap-3 ${isUser ? "" : ""}`}>
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          isUser
            ? "bg-warm-sand text-charcoal-warm"
            : "bg-terracotta text-ivory"
        }`}
      >
        {isUser ? <User size={13} /> : <Sparkles size={13} />}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={`mb-1 text-[11px] font-medium uppercase tracking-wider ${
            isUser ? "text-stone-gray" : "text-terracotta"
          }`}
        >
          {isUser ? "你" : "助手"}
          {m.role === "assistant" && m.streaming && (
            <span className="ml-2 inline-block animate-pulse">●●●</span>
          )}
        </div>
        {imageUrls.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {imageUrls.map((url, i) => (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="block h-24 w-24 overflow-hidden rounded-md border border-border-cream"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-full w-full object-cover" />
              </a>
            ))}
          </div>
        )}
        {text && (
          <div
            className={`rounded-md px-3 py-2.5 text-[14px] leading-[1.65] ${
              isUser
                ? "bg-parchment/50 font-mono text-near-black"
                : "bg-warm-sand/30 text-near-black"
            }`}
          >
            {isUser ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-[13.5px]">
                {text}
              </pre>
            ) : (
              <MdPreview source={text} />
            )}
          </div>
        )}
        {m.role === "assistant" && m.error && (
          <div className="mt-1 text-[11.5px] text-red-700">⚠ {m.error}</div>
        )}
      </div>
    </div>
  );
}
