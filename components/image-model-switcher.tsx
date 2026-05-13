// prompt-rewriter/components/image-model-switcher.tsx
//
// 跨 lab 共享的"生图模型" dropdown。配置和 LlmModelSwitcher 平行 ——
// 改这里立刻生效,下次跑改写 / 跑批 / 跑横评走选中模型。
//
// 数据源:
//   - /api/image-generators 一次性拉清单(含内部 gpt-image-2 + Lovart 的 image / image-modify)
//   - 选中值持久化到 localStorage(lib/atoms-shared 的 imageModelAtom)
//
// 第一次加载时拉清单写入 imageGeneratorOptionsAtom;后续切 lab 不重拉(都是同一份 client 端 atom)。

"use client";

import { useEffect } from "react";
import { useAtom, useSetAtom } from "jotai";
import { Image as ImageIcon } from "lucide-react";
import {
  imageModelAtom,
  imageGeneratorOptionsAtom,
  imageGeneratorDefaultAtom,
  type ImageGeneratorOption,
} from "@/lib/atoms-shared";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ApiResp = {
  default: string;
  items: ImageGeneratorOption[];
  warn?: string;
};

export function ImageModelSwitcher() {
  const [options, setOptions] = useAtom(imageGeneratorOptionsAtom);
  const [defaultName, setDefaultName] = useAtom(imageGeneratorDefaultAtom);
  const [model, setModel] = useAtom(imageModelAtom);
  const setM = useSetAtom(imageModelAtom);

  useEffect(() => {
    if (options.length > 0) return;
    let aborted = false;
    (async () => {
      try {
        const resp = await fetch("/api/image-generators");
        if (!resp.ok) return;
        const json = (await resp.json()) as ApiResp;
        if (aborted) return;
        setOptions(json.items);
        setDefaultName(json.default);
        if (!model && json.default) {
          setM(""); // 保留 "" 语义 = 用后端默认,不锁死 atom
        }
      } catch {
        // 拉不到清单时 fallback:不渲染
      }
    })();
    return () => {
      aborted = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (options.length === 0) {
    return null;
  }

  const currentName = model || defaultName;
  const current = options.find((o) => o.name === currentName);

  const igw = options.filter((o) => o.provider === "igw");
  const lovartImage = options.filter(
    (o) => o.provider === "lovart" && o.type === "image"
  );
  const lovartModify = options.filter(
    (o) => o.provider === "lovart" && o.type === "image-modify"
  );

  return (
    <div className="flex items-center gap-2">
      <ImageIcon size={14} className="text-stone-gray" />
      <span className="font-mono text-[12px] text-stone-gray">生图模型</span>
      <Select<string>
        value={currentName}
        onValueChange={(v) => {
          if (typeof v === "string") setModel(v);
        }}
      >
        <SelectTrigger className="min-w-[180px] max-w-[260px]">
          <SelectValue placeholder="选模型" />
        </SelectTrigger>
        <SelectContent>
          {igw.length > 0 && (
            <SelectGroup>
              <SelectLabel>内部网关</SelectLabel>
              {igw.map((o) => (
                <SelectItem key={o.name} value={o.name}>
                  {o.display_name}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {lovartImage.length > 0 && (
            <SelectGroup>
              <SelectLabel>Lovart · 文生图</SelectLabel>
              {lovartImage.map((o) => (
                <SelectItem key={o.name} value={o.name}>
                  {o.display_name}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {lovartModify.length > 0 && (
            <SelectGroup>
              <SelectLabel>Lovart · 图生图</SelectLabel>
              {lovartModify.map((o) => (
                <SelectItem key={o.name} value={o.name}>
                  {o.display_name}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
      {current && (
        <span
          title={buildTooltip(current)}
          className="cursor-help font-mono text-[11px] text-stone-gray"
        >
          ⓘ
        </span>
      )}
    </div>
  );
}

function formatBytes(b: number): string {
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(b >= 10 * 1024 * 1024 ? 0 : 1)}MB`;
  if (b >= 1024) return `${Math.round(b / 1024)}KB`;
  return `${b}B`;
}

function buildTooltip(o: ImageGeneratorOption): string {
  const parts: string[] = [];
  if (o.description) parts.push(o.description);
  const c = o.constraints;
  if (c.reference_image) {
    const ri = c.reference_image;
    const seg: string[] = [];
    if (ri.max_count) seg.push(`${ri.max_count} 张`);
    if (ri.max_bytes) seg.push(`≤ ${formatBytes(ri.max_bytes)}/张`);
    if (ri.accepted_formats) seg.push(ri.accepted_formats.map((t) => t.replace("image/", "").toUpperCase()).join("/"));
    if (seg.length) parts.push(`参考图:${seg.join(" · ")}`);
  }
  if (c.output?.aspect_ratios && c.output.aspect_ratios.length) {
    const ars = c.output.aspect_ratios;
    parts.push(`比例:${ars.slice(0, 8).join(" / ")}${ars.length > 8 ? ` ...(共 ${ars.length})` : ""}`);
  }
  if (c.output?.resolutions && c.output.resolutions.length) {
    const rs = c.output.resolutions;
    parts.push(`分辨率:${rs.slice(0, 6).join(" / ")}${rs.length > 6 ? ` ...(共 ${rs.length})` : ""}`);
  }
  if (c.prompt?.max_chars) {
    parts.push(`prompt ≤ ${c.prompt.max_chars} 字符`);
  }
  if (c.source) {
    const tag =
      c.source.kind === "vendor_docs"
        ? "厂商文档"
        : c.source.kind === "lovart_api"
          ? "Lovart API"
          : c.source.kind === "empirical"
            ? "实测兜底"
            : "未核";
    parts.push(`来源:${tag}${c.source.verified_at ? `(${c.source.verified_at})` : ""}`);
  }
  return parts.join("\n");
}
