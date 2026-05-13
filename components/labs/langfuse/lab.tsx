// prompt-rewriter/components/labs/langfuse/lab.tsx
//
// 工具型 tab:粘贴 Langfuse trace 文本 → 自动抽取图片链接 → 缩略图预览 + 元数据。
//
// 支持两种格式(同时抽,后者作为兜底):
//   1. 结构化:`image_url: <URL>, image_name: <name>, width: <n>, height: <n>` —— Langfuse 通常这种
//   2. 裸 URL:任何 https?://... 以 .png/.jpg/.jpeg/.webp/.gif 结尾的 URL
//
// 抽取结果累积持久化(localStorage):多次粘贴新文本会**追加**新图(按 url 去重),
// 不覆盖旧图;刷新页面也不丢。用户要清理 → 显式按"清空"按钮。

"use client";

import { useEffect, useRef, useState } from "react";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { Image as ImageIcon, Copy, Check, Maximize2, Loader2, AlertTriangle, Trash2, X } from "lucide-react";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { copyImageToClipboard } from "@/lib/copy-image";

type Extracted = {
  url: string;
  name?: string;
  width?: number;
  height?: number;
  // 抽取时刻 ms,用于按时间倒序展示(最新粘的排前)。可选字段,老数据兜底为 0。
  added_at?: number;
};

// 持久化:抽取结果累积在 localStorage。刷新 / 切 tab / 关浏览器再开都保留。
const langfuseExtractedAtom = atomWithStorage<Extracted[]>(
  "langfuse.extracted",
  []
);
// textarea 内容也持久化(刷新后能看到上次粘的什么文本)
const langfuseTextAtom = atomWithStorage<string>("langfuse.text", "");

// 结构化抽取:成对的 image_url / image_name / width / height(就近匹配)。
// Langfuse 里这种段经常在一个 line 内,容错跨行用 [\s\S] flag。
function extractStructured(text: string): Extracted[] {
  const out: Extracted[] = [];
  // 锚 image_url:其后允许任意空格、单/双引号、然后一个 https URL
  // 同段(同 ~300 字符窗口内)可选 image_name / width / height
  // name 用 greedy `[^,\n\]\}"']+`,在第一个 `,` / 换行 / `}` / `]` 处停,完整保留中文。
  const re =
    /image_url\s*[:=]\s*["']?(https?:\/\/[^\s,"'<>}\]]+)["']?(?:[\s\S]{0,300}?image_name\s*[:=]\s*["']?([^,\n\]\}"']+))?(?:[\s\S]{0,300}?width\s*[:=]\s*(\d+))?(?:[\s\S]{0,300}?height\s*[:=]\s*(\d+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({
      url: m[1],
      name: m[2]?.trim() || undefined,
      width: m[3] ? Number(m[3]) : undefined,
      height: m[4] ? Number(m[4]) : undefined,
    });
  }
  return out;
}

// 兜底:扫所有 https?://...(png|jpg|jpeg|webp|gif) 直链
function extractBareUrls(text: string): string[] {
  const re = /https?:\/\/[^\s"'<>,()\[\]{}]+\.(?:png|jpe?g|webp|gif|svg)(?:\?[^\s"'<>,()\[\]{}]*)?/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[0]);
  }
  return out;
}

function parse(text: string): Extracted[] {
  if (!text.trim()) return [];
  const structured = extractStructured(text);
  const seen = new Set(structured.map((x) => x.url));
  for (const url of extractBareUrls(text)) {
    if (!seen.has(url)) {
      structured.push({ url });
      seen.add(url);
    }
  }
  return structured;
}

export function LangfuseLab() {
  const [text, setText] = useAtom(langfuseTextAtom);
  const [items, setItems] = useAtom(langfuseExtractedAtom);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<number>(0);

  // 解析 + 累积合并:每次 text 变化,debounce 300ms 再解析,新 url merge 到旧 items 头部,
  // 已存在的 url 用新数据覆盖元信息(name / width / height 可能后补)。
  // 第一帧加载(atom 从 storage 还原)不跑,避免空 text 触发空解析。
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => {
      const fresh = parse(text);
      if (fresh.length === 0) return;
      setItems((prev) => {
        const map = new Map<string, Extracted>();
        for (const old of prev) map.set(old.url, old);
        let added = 0;
        const now = Date.now();
        for (const f of fresh) {
          if (map.has(f.url)) {
            // 已存在 → 合并元数据(只覆盖非空字段),不动 added_at
            const old = map.get(f.url)!;
            map.set(f.url, {
              ...old,
              name: f.name ?? old.name,
              width: f.width ?? old.width,
              height: f.height ?? old.height,
            });
          } else {
            map.set(f.url, { ...f, added_at: now });
            added++;
          }
        }
        setJustAdded(added);
        if (added > 0) setTimeout(() => setJustAdded(0), 2000);
        // 排序:新加的(添加时间倒序)在前;无 added_at 的老数据在末
        return Array.from(map.values()).sort(
          (a, b) => (b.added_at ?? 0) - (a.added_at ?? 0)
        );
      });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const clearAll = () => {
    if (!window.confirm(`确认清空所有 ${items.length} 条抽取结果?(textarea 内容也一并清空)`)) return;
    setItems([]);
    setText("");
  };

  const removeOne = (url: string) => {
    setItems((prev) => prev.filter((x) => x.url !== url));
  };

  return (
    <div className="min-w-0 flex-1 space-y-8 py-2">
      <header>
        <h1 className="font-serif text-[32px] font-medium leading-[1.2] text-near-black">
          Langfuse 信息查看
        </h1>
        <p className="mt-3 max-w-[680px] text-[16px] leading-[1.6] text-olive-gray">
          从 Langfuse trace 里复制一段对话粘进来,自动抽取所有图像链接、显示元数据、缩略图预览。
          支持结构化(<code className="font-mono text-[14px] text-near-black">image_url: ..., image_name: ..., width: ..., height: ...</code>)
          和裸 URL 两种格式。
          <span className="ml-1 text-stone-gray">
            · 抽取结果**累积保留**(刷新 / 粘新文本不覆盖,显式清空才清)
          </span>
        </p>
      </header>

      <section>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`粘贴 Langfuse trace 文本,例:\nImage ready: image_url: https://a.lovart.ai/artifacts/agent/xxx.png, image_name: 胡夫金字塔, width: 2752, height: 1536`}
          className="block min-h-[200px] w-full resize-y rounded-lg border border-border-cream bg-ivory p-4 font-mono text-[13px] leading-[1.6] text-near-black placeholder:text-stone-gray focus:border-coral focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between font-mono text-[12px] text-stone-gray">
          <span>{text.length} 字符</span>
          <span className="flex items-center gap-3">
            {justAdded > 0 && (
              <span className="font-medium text-terracotta">
                + 新增 {justAdded} 张
              </span>
            )}
            <span>
              累积 <span className="font-medium text-near-black">{items.length}</span> 张图
            </span>
          </span>
        </div>
      </section>

      {items.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-sans text-[14px] font-medium text-olive-gray">
              抽取结果 · {items.length} 张
            </h2>
            <button
              type="button"
              onClick={clearAll}
              className="flex h-7 items-center gap-1.5 rounded-sm border border-border-warm bg-ivory px-2.5 font-mono text-[11.5px] text-olive-gray transition hover:border-error-crimson hover:text-error-crimson"
            >
              <Trash2 size={12} />
              清空全部
            </button>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((it) => (
              <ImageCard
                key={it.url}
                item={it}
                onOpen={() => setLightboxUrl(it.url)}
                onRemove={() => removeOne(it.url)}
              />
            ))}
          </div>
        </section>
      )}

      {items.length === 0 && text.trim().length > 0 && (
        <section className="rounded-lg border border-dashed border-border-warm bg-ivory p-12 text-center">
          <ImageIcon className="mx-auto text-stone-gray" size={28} />
          <p className="mt-3 font-mono text-[13px] text-stone-gray">
            没在文本里找到图片链接。支持的格式见上方提示。
          </p>
        </section>
      )}

      <ImageLightbox src={lightboxUrl} onClose={() => setLightboxUrl(null)} />
    </div>
  );
}

function ImageCard({
  item,
  onOpen,
  onRemove,
}: {
  item: Extracted;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const [copyState, setCopyState] = useState<
    "idle" | "copying" | "copied" | "error"
  >("idle");
  const [copyErr, setCopyErr] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);

  // 复制图:直接下载图片字节写到剪贴板(可粘贴到 Finder / 微信 / Slack)。
  // 跨域 fetch 走 lib/copy-image.ts 的 server-side proxy 路径,Safari 也支持。
  const onCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (copyState === "copying") return;
    setCopyState("copying");
    setCopyErr(null);
    try {
      await copyImageToClipboard(item.url);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1600);
    } catch (err) {
      setCopyState("error");
      setCopyErr(err instanceof Error ? err.message : String(err));
      setTimeout(() => setCopyState("idle"), 2400);
    }
  };

  // 备用:复制 URL(纯文本,Cmd 点击或 alt 点)
  const onCopyUrl = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(item.url);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1200);
    } catch {
      /* silent */
    }
  };

  return (
    <div className="group/card relative flex flex-col overflow-hidden rounded-md border border-border-cream bg-ivory">
      {/* 单卡移除按钮:hover 时显示在右上角 */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        title="从抽取结果中移除这张"
        className="absolute right-1 top-1 z-[2] flex h-6 w-6 items-center justify-center rounded-full bg-near-black/60 text-ivory opacity-0 transition hover:bg-error-crimson group-hover/card:opacity-100"
      >
        <X size={12} />
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="group relative aspect-square w-full overflow-hidden bg-parchment/40"
      >
        {imgError ? (
          <div className="flex h-full w-full items-center justify-center text-[11.5px] text-stone-gray">
            图片加载失败
          </div>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.url}
              alt={item.name ?? "image"}
              loading="lazy"
              onError={() => setImgError(true)}
              className="h-full w-full object-contain transition group-hover:scale-[1.02]"
            />
            <span className="absolute right-2 top-2 flex items-center gap-1 rounded-sm bg-near-black/60 px-1.5 py-0.5 font-mono text-[10px] text-ivory opacity-0 transition group-hover:opacity-100">
              <Maximize2 size={10} />
              查看大图
            </span>
          </>
        )}
      </button>
      <div className="space-y-1.5 px-3 py-2.5">
        {item.name && (
          <p className="truncate font-sans text-[13px] font-medium text-near-black" title={item.name}>
            {item.name}
          </p>
        )}
        <div className="flex items-center gap-2 font-mono text-[11px] text-stone-gray">
          {item.width && item.height && (
            <span>
              {item.width} × {item.height}
            </span>
          )}
          {item.width && item.height && <span>·</span>}
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="truncate text-coral hover:text-terracotta"
            title={item.url}
          >
            {new URL(item.url).hostname}
          </a>
        </div>
        <div className="flex items-center justify-between gap-2">
          <code
            className="truncate font-mono text-[10.5px] text-stone-gray"
            title={item.url}
          >
            {item.url.length > 50 ? `${item.url.slice(0, 25)}…${item.url.slice(-20)}` : item.url}
          </code>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onCopyUrl}
              title="复制 URL 文本"
              className="flex h-6 shrink-0 items-center rounded-sm bg-warm-sand/40 px-1.5 font-mono text-[10.5px] text-charcoal-warm transition hover:bg-warm-sand/70"
            >
              URL
            </button>
            <button
              type="button"
              onClick={onCopy}
              disabled={copyState === "copying"}
              title={copyErr ?? "复制图片(可粘贴到 Finder / 微信)"}
              className={`flex h-6 shrink-0 items-center gap-1 rounded-sm px-2 font-mono text-[10.5px] transition disabled:cursor-wait ${
                copyState === "error"
                  ? "bg-error-crimson/15 text-error-crimson"
                  : copyState === "copied"
                    ? "bg-coral-soft-bg text-terracotta"
                    : "bg-warm-sand/70 text-charcoal-warm hover:bg-warm-sand"
              }`}
            >
              {copyState === "copying" ? (
                <Loader2 size={11} className="animate-spin" />
              ) : copyState === "copied" ? (
                <Check size={11} />
              ) : copyState === "error" ? (
                <AlertTriangle size={11} />
              ) : (
                <Copy size={11} />
              )}
              {copyState === "copying"
                ? "下载中"
                : copyState === "copied"
                  ? "已复制"
                  : copyState === "error"
                    ? "失败"
                    : "复制图"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
