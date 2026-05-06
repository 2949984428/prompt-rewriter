// prompt-rewriter/lib/copy-image.ts
//
// 把远程图片像素复制到系统剪贴板,可直接在 Finder / Preview / 微信 / Slack 等粘贴。
//
// 关键约束:
//   - 浏览器 Clipboard API 只稳定支持 image/png 类型的 ClipboardItem
//   - 我们生成的图通常是 JPEG / WebP → 必须先用 canvas 转码到 PNG 才能放剪贴板
//   - 仅在 secure context(https / localhost)下可用
//
// 用法:
//   import { copyImageToClipboard } from "@/lib/copy-image";
//   await copyImageToClipboard(url);

export async function copyImageToClipboard(url: string): Promise<void> {
  if (!navigator.clipboard || typeof window.ClipboardItem === "undefined") {
    throw new Error("此浏览器不支持复制图片到剪贴板");
  }

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`图片加载失败: HTTP ${resp.status}`);
  }
  let blob = await resp.blob();

  // 非 png → 用 canvas 转码到 png(浏览器 ClipboardItem 对 jpeg/webp 兼容性差)
  if (blob.type !== "image/png") {
    blob = await blobToPng(blob);
  }

  await navigator.clipboard.write([
    new ClipboardItem({ "image/png": blob }),
  ]);
}

function blobToPng(blob: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.crossOrigin = "anonymous"; // 同源 / 本地 proxy 路径不需要,但 cdn 跨域时帮忙
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          reject(new Error("无法创建 2D 画布"));
          return;
        }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((out) => {
          URL.revokeObjectURL(objectUrl);
          if (out) resolve(out);
          else reject(new Error("canvas.toBlob 返回空"));
        }, "image/png");
      } catch (e) {
        URL.revokeObjectURL(objectUrl);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("解码图片失败(可能是跨域)"));
    };
    img.src = objectUrl;
  });
}
