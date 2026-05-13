// prompt-rewriter/lib/image-compress.ts
//
// 服务端用 sharp 把参考图压到目标字节以下,作为前端用户传超大图的兜底。
// 思路:逐步降质量 + 必要时降分辨率,直到 ≤ targetBytes * 0.9(留 10% 余量,避免精确卡线)。
//
// 调用方:`POST /api/compress-reference-image`。前端 ImageUploader 拿到原图后调一次。
//
// **为什么不在 /api/generate-image 里压**:rewrite/format/batch 三个 lab 都把 reference_images 存进
// record(format-runner/batch-runner 跑批时直接读 record 的 base64),如果压缩动作只发生在生图入口,
// record 里就一直留着 7.91MB 的大图,跑 batch 时 N×M cell 反复读 → 内存/IO 都炸。所以入口处压一次,
// 落 record 已经是小图。

import sharp from "sharp";

const MAX_RAW_BYTES = 50 * 1024 * 1024; // 入口卡 50MB,防止用户 OOM server

export interface CompressInput {
  // base64 data URL,带 "data:image/..." 前缀
  dataUrl: string;
  // 目标字节(从 model constraints 来,server 端 caller 决定)
  targetBytes: number;
  // 可选:模型 schema 里的 max_dimension_px(NBP 等是 4096,有就 resize 到 ≤ 该值再开始压)
  maxDimensionPx?: number;
}

export interface CompressResult {
  // 压完的 base64 data URL(可能跟原图 mime 不同,因为我们会统一转 jpeg)
  dataUrl: string;
  originalBytes: number;
  finalBytes: number;
  // 是否真的动了图(原图已经 ≤ target → false)
  compressed: boolean;
  // 输出格式:原图保留 png 的情况会回 "png",压缩走一律 jpeg
  outputFormat: "png" | "jpeg" | "webp";
  // 压缩路径上每一步参数(调试用)
  trace: string[];
}

function parseDataUrl(s: string): { mime: string; buf: Buffer } | null {
  const m = s.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mime: m[1], buf: Buffer.from(m[2], "base64") };
}

function toDataUrl(buf: Buffer, mime: string): string {
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/**
 * 把 dataUrl 压到 ≤ targetBytes * 0.9。返回压缩后的 dataUrl + 元数据。
 * 失败抛错(调用方决定怎么报给前端)。
 */
export async function compressImageIfNeeded(
  input: CompressInput
): Promise<CompressResult> {
  const parsed = parseDataUrl(input.dataUrl);
  if (!parsed) throw new Error("dataUrl 格式非法");
  const { mime, buf: originalBuf } = parsed;

  if (originalBuf.byteLength > MAX_RAW_BYTES) {
    throw new Error(
      `原图 ${(originalBuf.byteLength / 1024 / 1024).toFixed(1)}MB 超过 server 上限 ${MAX_RAW_BYTES / 1024 / 1024}MB`
    );
  }

  const target = Math.floor(input.targetBytes * 0.9);
  const trace: string[] = [];

  // 已经够小,原样返回
  if (originalBuf.byteLength <= target) {
    return {
      dataUrl: input.dataUrl,
      originalBytes: originalBuf.byteLength,
      finalBytes: originalBuf.byteLength,
      compressed: false,
      outputFormat: mime.includes("png")
        ? "png"
        : mime.includes("webp")
          ? "webp"
          : "jpeg",
      trace: [`pass-through(${originalBuf.byteLength}B ≤ ${target}B target)`],
    };
  }

  const meta = await sharp(originalBuf, { failOn: "none" }).metadata();
  const sourceW = meta.width ?? 0;
  const sourceH = meta.height ?? 0;
  trace.push(`source ${sourceW}x${sourceH} ${mime} ${originalBuf.byteLength}B`);

  const baseDim = input.maxDimensionPx ?? 2048;

  // 优先尝试无损 PNG:若 sharp 经 EXIF 修正 + 元数据剥离后 ≤ target,直接返回 PNG。
  // 这是真"贴上沿"的方式 —— jpeg q=98 转换会大幅压扁文件,PNG 不会。
  // 但只对原本就是 PNG 的图有意义(jpeg 重压成 PNG 反而更大)。
  if (mime === "image/png") {
    const pngOut = await sharp(originalBuf, { failOn: "none" })
      .rotate()
      .png({ compressionLevel: 9, effort: 10 })
      .toBuffer();
    trace.push(`png re-encode → ${pngOut.byteLength}B`);
    if (pngOut.byteLength <= target) {
      return {
        dataUrl: toDataUrl(pngOut, "image/png"),
        originalBytes: originalBuf.byteLength,
        finalBytes: pngOut.byteLength,
        compressed: true,
        outputFormat: "png",
        trace,
      };
    }
  }

  // 单次编码:在指定 longEdge + quality 下出 jpeg
  const encode = async (longEdge: number, q: number): Promise<Buffer> => {
    let p = sharp(originalBuf, { failOn: "none" }).rotate(); // rotate() 修正 EXIF
    if (Math.max(sourceW, sourceH) > longEdge) {
      p = p.resize({
        width: longEdge,
        height: longEdge,
        fit: "inside",
        withoutEnlargement: true,
      });
    }
    return p.jpeg({ quality: q, mozjpeg: true, progressive: true }).toBuffer();
  };

  // 找当前 longEdge 下"≤ target 的最大 quality":先试 q=98,若小于 target → 二分 (98,40]
  // 思路:压完后要"贴近 target 上沿"而不是远低于 → 二分搜出最大可接受 q。
  const findBestQAtDim = async (longEdge: number): Promise<Buffer | null> => {
    const top = await encode(longEdge, 98);
    trace.push(`  dim≤${longEdge} q=98 → ${top.byteLength}B`);
    if (top.byteLength <= target) {
      // q=98 都没超 target,说明原图很小或 dim 缩很狠;直接用,不二分
      return top;
    }
    // 二分:在 (40, 98) 找最大 q 使 size ≤ target
    let lo = 40,
      hi = 97;
    let best: Buffer | null = null;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const out = await encode(longEdge, mid);
      trace.push(`  dim≤${longEdge} q=${mid} → ${out.byteLength}B`);
      if (out.byteLength <= target) {
        best = out;
        lo = mid + 1; // 尝试更高质量
      } else {
        hi = mid - 1;
      }
    }
    return best;
  };

  // 先在原始 baseDim 试;不行就缩 longEdge 重来。最多缩 3 次(81% → 64% → 51%)。
  let dimScale = 1.0;
  for (let i = 0; i < 4; i++) {
    const longEdge = Math.floor(baseDim * dimScale);
    const best = await findBestQAtDim(longEdge);
    if (best) {
      trace.push(`✓ pick dim≤${longEdge} → ${best.byteLength}B (≤ ${target}B)`);
      return {
        dataUrl: toDataUrl(best, "image/jpeg"),
        originalBytes: originalBuf.byteLength,
        finalBytes: best.byteLength,
        compressed: true,
        outputFormat: "jpeg",
        trace,
      };
    }
    dimScale *= 0.8;
  }

  throw new Error(
    `压缩失败:已尝试 quality 40 + 长边 ${Math.floor(baseDim * dimScale)}px 仍 > ${target}B`
  );
}
