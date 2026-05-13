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

import { useRef, useState } from "react";
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
}: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
      for (const f of Array.from(files)) {
        if (next.length >= effMax) {
          setError(`最多 ${effMax} 张`);
          break;
        }
        if (!effFormats.includes(f.type)) {
          setError(
            `仅支持 ${effFormats.map((t) => t.replace("image/", "").toUpperCase()).join("/")}（${f.name} 是 ${f.type || "未知"}）`
          );
          continue;
        }
        if (f.size > HARD_MAX_BYTES) {
          setError(
            `单张 ≤ ${formatBytes(HARD_MAX_BYTES)}（${f.name} 是 ${formatBytes(f.size)}）`
          );
          continue;
        }
        let dataUrl: string;
        try {
          dataUrl = await readAsDataUrl(f);
        } catch {
          setError(`读取失败：${f.name}`);
          continue;
        }
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
                <span className="font-mono text-[10px]">压缩中</span>
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
