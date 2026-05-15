// prompt-rewriter/components/image-uploader.tsx
//
// 共用的图生图参考图上传组件。
// - 走 client-side FileReader → base64 data URL，不依赖 upload endpoint（demo 阶段简化）
// - 字节 / 张数 / 格式三项约束**全部由当前选中模型决定**（model-constraints.json + /api/image-generators 合并出的 constraints）
// - 不再硬编码 1.5MB / 4 张 / png-jpg-webp 这种;但传入了 max prop 可单 lab 强制收紧(比如 batch 怕 record 膨胀)
//
// 用法：
//   const [refs, setRefs] = useState<string[]>([]);
//   <ImageUploader value={refs} onChange={setRefs} />
//   // 也可以 prop 收紧:<ImageUploader value={refs} onChange={setRefs} max={2} />

"use client";

import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { Upload, X, Image as ImageIcon, Loader2 } from "lucide-react";
import {
  currentImageConstraintsAtom,
  imageModelAtom,
} from "@/lib/atoms-shared";

// 客户端只兜两条:格式 + 巨大文件(防止 OOM)。字节限制由 server 端压缩兜底。
const HARD_MAX_BYTES = 50 * 1024 * 1024; // 跟 lib/image-compress.ts MAX_RAW_BYTES 对齐
const FALLBACK_MAX_COUNT = 4;
const FALLBACK_FORMATS = ["image/png", "image/jpeg", "image/webp"];

interface ImageUploaderProps {
  value: string[];
  onChange: (next: string[]) => void;
  // 该 lab 自己想强制收紧字段(覆盖 model constraints)。不传则全部走 constraints。
  max?: number;
  maxBytes?: number;
  acceptedFormats?: string[];
  className?: string;
  label?: string;
  hint?: string;
  // 2026-05-13:跳过 server 压缩端点,客户端拿到 base64 直接 push 进 value。
  // Pipeline lab 用这个 — 它后端会把 base64 上传到 R2 拿 URL,压缩对它无意义
  skipCompression?: boolean;
  // 2026-05-13:启用后,客户端读到 base64 立即调 /api/upload-r2 拿 R2 公网 URL,
  // value 里存的是 https://... 而非 base64。失败立即弹错;成功跑批时 POST 直接
  // 传 URL,server 端 uploadDataUrlToR2 看非 data: 开头会 pass-through
  useR2Upload?: boolean;
  // busy 状态透传给父组件,父级可以根据这个 disable 跑批按钮
  onBusyChange?: (busy: boolean) => void;
  // 2026-05-13:启用后多一行 URL 输入条,粘贴 http(s):// URL 直接入 value 不上传
  enableUrlInput?: boolean;
  // 2026-05-15:启用后监听 document paste,Cmd+V 粘贴图片直接入 value(走 onPick 全套链路)
  enablePaste?: boolean;
}

function formatBytes(b: number): string {
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(b >= 10 * 1024 * 1024 ? 0 : 1)}MB`;
  if (b >= 1024) return `${Math.round(b / 1024)}KB`;
  return `${b}B`;
}

type CompressNotice = { name: string; from: number; to: number };

export function ImageUploader({
  value,
  onChange,
  max,
  maxBytes,
  acceptedFormats,
  className = "",
  label = "参考图（图生图）",
  hint,
  skipCompression = false,
  useR2Upload = false,
  onBusyChange,
  enableUrlInput = false,
  enablePaste = false,
}: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // busy 状态透传给父组件(可选)。useEffect 而非 setState callback 触发,避免在
  // render 阶段调用 setState 引发警告
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  const [notices, setNotices] = useState<CompressNotice[]>([]);
  const c = useAtomValue(currentImageConstraintsAtom);
  const model = useAtomValue(imageModelAtom);

  // 张数 + 格式仍由前端兜;字节限制由 server 端压缩兜底
  const effMax = max ?? c?.reference_image?.max_count ?? FALLBACK_MAX_COUNT;
  const effFormats =
    acceptedFormats ??
    c?.reference_image?.accepted_formats ??
    FALLBACK_FORMATS;
  // 目标字节:有就传给 server(优先 prop > model > _);server 自己也有兜底,这里给 0 也行
  const targetBytes = maxBytes ?? c?.reference_image?.max_bytes ?? 0;

  const remaining = effMax - value.length;

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setNotices([]);
    setBusy(true);
    const next: string[] = [...value];
    const newNotices: CompressNotice[] = [];
    try {
      // R2 路径:文件预处理后并发上传(N 张同时 PUT R2,而不是串行)。多图场景显著加速
      const arr = Array.from(files);
      const eligible: { f: File; dataUrl: string }[] = [];
      for (const f of arr) {
        if (next.length + eligible.length >= effMax) {
          setError(`最多 ${effMax} 张`);
          break;
        }
        if (!effFormats.includes(f.type)) {
          setError(
            `仅支持 ${effFormats.map((t) => t.replace("image/", "").toUpperCase()).join("/")}（${f.name} 是 ${f.type || "未知"}）`,
          );
          continue;
        }
        if (f.size > HARD_MAX_BYTES) {
          setError(
            `单张 ≤ ${formatBytes(HARD_MAX_BYTES)}（${f.name} 是 ${formatBytes(f.size)}）`,
          );
          continue;
        }
        try {
          const dataUrl = await readAsDataUrl(f);
          eligible.push({ f, dataUrl });
        } catch {
          setError(`读取失败：${f.name}`);
        }
      }

      if (useR2Upload) {
        // 并发上传(同时跑 N 个 R2 PUT)
        const results = await Promise.all(
          eligible.map(async ({ f, dataUrl }) => {
            try {
              const resp = await fetch("/api/upload-r2", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ dataUrl, prefix: "pipeline-ref" }),
              });
              const j = await resp.json();
              if (!resp.ok || !j.ok) {
                return {
                  ok: false as const,
                  error: j.error ?? `R2 上传失败 HTTP ${resp.status}`,
                  name: f.name,
                };
              }
              return { ok: true as const, url: j.url as string };
            } catch (e) {
              return { ok: false as const, error: String(e), name: f.name };
            }
          }),
        );
        for (const r of results) {
          if (r.ok) next.push(r.url);
          else setError(`${r.name}: ${r.error}`);
        }
        // 其他分支不走,直接落到 onChange
        onChange(next);
        setNotices(newNotices);
        return;
      }

      // 非 R2 路径:维持原串行逻辑(其他 lab 行为不变)
      for (const { f, dataUrl } of eligible) {
        if (skipCompression) {
          // Pipeline lab 等场景:后端会把 base64 上传 R2 拿 URL,server 压缩端点跳过,
          // 客户端 base64 直接 push 进 value(节省一次 server round-trip)
          next.push(dataUrl);
        } else {
          // 走 server 端压缩(超目标才会真压;原图已小于 target 直接 pass-through)
          try {
            const resp = await fetch("/api/compress-reference-image", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ dataUrl, model: model || undefined }),
            });
            const j = await resp.json();
            if (!resp.ok || !j.ok) {
              setError(j.error ?? `压缩失败 HTTP ${resp.status}`);
              continue;
            }
            next.push(j.dataUrl);
            if (j.compressed) {
              newNotices.push({
                name: f.name,
                from: j.originalBytes,
                to: j.finalBytes,
              });
            }
          } catch (e) {
            setError(`压缩请求失败：${String(e)}`);
          }
        }
      }
      onChange(next);
      setNotices(newNotices);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onRemove = (i: number) => {
    onChange(value.filter((_, idx) => idx !== i));
  };

  // 2026-05-15:document-level 粘贴监听(Cmd+V 直接粘贴图片到 uploader)
  // 仅在 enablePaste=true 时挂;同页面多个启用 paste 的 uploader 时只第一个生效
  // (paste 触发 capture phase,先 listen 的先消费)。Pipeline lab 只有一个,不冲突
  useEffect(() => {
    if (!enablePaste) return;
    const handler = (e: ClipboardEvent) => {
      // 用户在 textarea / input 里粘贴文本不抢:只处理 clipboardData.items 含 image 时
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind !== "file") continue;
        if (!it.type.startsWith("image/")) continue;
        const f = it.getAsFile();
        if (f) files.push(f);
      }
      if (files.length === 0) return;
      e.preventDefault();
      // 构造 FileList(DataTransfer 是唯一合法构造方式)
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      void onPick(dt.files);
    };
    document.addEventListener("paste", handler);
    return () => {
      document.removeEventListener("paste", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enablePaste, value.length, effMax]);

  // URL 输入(enableUrlInput 模式):粘贴 http(s):// URL,直接入 value(不走 R2)
  const [urlInput, setUrlInput] = useState("");
  const onAddUrl = () => {
    const u = urlInput.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) {
      setError("URL 必须 http:// 或 https:// 开头");
      return;
    }
    if (value.length >= effMax) {
      setError(`最多 ${effMax} 张`);
      return;
    }
    setError(null);
    onChange([...value, u]);
    setUrlInput("");
  };

  // 自动 hint:超 server target 时会自动压,所以不再吓唬用户"≤ 1.5MB"
  const autoHint =
    hint ??
    `${targetBytes > 0 ? `目标 ≤ ${formatBytes(targetBytes)}/张(超出自动压)` : "自动压缩"} · ${effFormats.map((t) => t.replace("image/", "")).join("/").toUpperCase()}`;

  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="font-sans text-[12.5px] font-medium text-near-black">
          <ImageIcon size={12} className="mr-1 inline-block" />
          {label}
        </span>
        <span className="font-mono text-[11px] text-stone-gray">
          {value.length} / {effMax}
          {autoHint && ` · ${autoHint}`}
        </span>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        {value.map((src, i) => (
          <div
            key={i}
            className="group relative h-16 w-16 overflow-hidden rounded-md border border-border-cream bg-ivory"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={`reference-${i}`}
              className="h-full w-full object-cover"
            />
            {/* 左上序号 chip:图一/图二/...,跟 prompt 里 [@image:#N:...] 引用对齐 */}
            <span
              className="absolute left-0.5 top-0.5 rounded-sm bg-near-black/75 px-1 py-px font-mono text-[10px] font-medium text-ivory"
              title={`第 ${i + 1} 张参考图 (在 prompt 里用 #${i + 1} 引用)`}
            >
              #{i + 1}
            </span>
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-near-black/70 text-ivory opacity-0 transition group-hover:opacity-100"
              aria-label="删除"
            >
              <X size={10} />
            </button>
          </div>
        ))}
        {remaining > 0 && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border-warm bg-ivory text-stone-gray transition hover:border-terracotta hover:text-terracotta disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span className="font-mono text-[10px]">处理中</span>
              </>
            ) : (
              <>
                <Upload size={14} />
                <span className="font-mono text-[10px]">+ 图</span>
              </>
            )}
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={effFormats.join(",")}
          multiple={remaining > 1}
          className="hidden"
          onChange={(e) => onPick(e.target.files)}
        />
      </div>
      {/* URL 输入条:enableUrlInput 模式 */}
      {enableUrlInput && remaining > 0 && (
        <div className="mt-2 flex gap-1.5">
          <input
            type="url"
            placeholder="或粘贴图片 URL(http/https)"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onAddUrl();
              }
            }}
            className="flex-1 rounded-md border border-border-cream bg-ivory px-3 py-1.5 font-mono text-[12px] text-near-black placeholder:text-stone-gray focus:border-terracotta focus:outline-none"
          />
          <button
            type="button"
            onClick={onAddUrl}
            disabled={!urlInput.trim()}
            className="rounded-md border border-border-warm bg-ivory px-3 py-1.5 text-[12px] text-near-black transition hover:border-terracotta hover:bg-warm-sand/40 disabled:cursor-not-allowed disabled:opacity-40"
            title="把 URL 加进参考图列表(不上传 R2,直接透传给生图 gateway)"
          >
            添加 URL
          </button>
        </div>
      )}
      {error && (
        <p className="mt-1 font-mono text-[11px] text-coral">{error}</p>
      )}
      {notices.length > 0 && (
        <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-stone-gray">
          {notices.map((n, i) => (
            <li key={i}>
              已压缩 <span className="text-near-black">{n.name}</span>:{" "}
              {formatBytes(n.from)} → {formatBytes(n.to)}
            </li>
          ))}
        </ul>
      )}
      {value.length === 0 && !error && notices.length === 0 && (
        <p className="mt-1 font-mono text-[11px] text-stone-gray">
          上传后跑生图自动走 image-edit（图生图）；不传走 text-to-image（文生图）
        </p>
      )}
    </div>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      if (typeof r.result === "string") resolve(r.result);
      else reject(new Error("not a string"));
    };
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });
}
