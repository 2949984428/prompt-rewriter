// prompt-rewriter/lib/export/build-zip.ts
//
// 把一个 BatchRunRecord 打成 ZIP buffer:
//   index.html       ← buildHtml() 渲染,图片走相对路径
//   images/q01_F4-block-formula.png  ← 拷贝自 data/images/.../...
//   raw.json         ← 完整 BatchRunRecord(给工程同事二次加工)
//   README.md        ← 一句话说明怎么看
//
// 用 archiver 流式打,内存峰值低(每张图边读边写)。
// 不开 deflate(image 已是压缩格式,再压意义不大,反而 CPU 飙)。

import archiver from "archiver";
import { Readable } from "stream";
import { buildHtml } from "./build-html";
import {
  resolveLocalImage,
  readImageBytes,
  type LocalImageHit,
} from "./image-loader";
import type { BatchRunRecord, BatchCell } from "@/lib/schema";

export type BuildZipOptions = {
  includeExcluded?: boolean;
  includeRaw?: boolean; // 默认 true
  // 同 BuildHtmlOptions,id → display name 映射;不传则在 HTML 里只显示 id
  skillLabels?: Record<string, string>;
  modelLabels?: Record<string, string>;
};

// zip 内的图片相对路径:images/q{XX}_{skill_id}[__{model}].{ext}
// 多 model 模式下必须把 image_model 加到文件名,否则同 (q, skill) 不同 model 的图会重名覆盖。
// 单 model 模式(cell.image_model === "")退化成老命名 q{XX}_{skill}.{ext}。
function imagePathInZip(cell: BatchCell, hit: LocalImageHit): string {
  const qi = String(cell.query_idx + 1).padStart(2, "0");
  const modelTag = cell.image_model
    ? `__${cell.image_model.replace(/[^\w.-]+/g, "_")}`
    : "";
  return `images/q${qi}_${cell.skill_id}${modelTag}.${hit.ext}`;
}

// (query_idx, skill_id, image_model) 三元组的 cellToZipPath map key
function cellKey(cell: BatchCell): string {
  return `${cell.query_idx}::${cell.skill_id}::${cell.image_model ?? ""}`;
}

export async function buildZip(
  record: BatchRunRecord,
  opts: BuildZipOptions = {}
): Promise<Buffer> {
  const {
    includeExcluded = false,
    includeRaw = true,
    skillLabels,
    modelLabels,
  } = opts;

  // 第一步:扫一遍要打进 zip 的图,建立 cell -> zip 内路径 的映射。
  // 这个映射要交给 buildHtml 让 <img src=> 用同样的相对路径。
  const visibleCells = record.cells.filter(
    (c) => includeExcluded || c.status !== "excluded"
  );
  const cellToZipPath = new Map<string, { hit: LocalImageHit; zipPath: string }>();
  for (const c of visibleCells) {
    const url = c.image_urls?.[0];
    const hit = resolveLocalImage(url);
    if (!hit) continue;
    const zipPath = imagePathInZip(c, hit);
    cellToZipPath.set(cellKey(c), { hit, zipPath });
  }

  // 第二步:渲染 HTML(图片 src 用相对路径)
  const html = await buildHtml(record, {
    includeExcluded,
    skillLabels,
    modelLabels,
    resolveImageSrc: async (cell) => {
      const m = cellToZipPath.get(cellKey(cell));
      return m ? m.zipPath : null;
    },
  });

  // 第三步:打 zip
  const archive = archiver("zip", { store: true }); // store mode: 不压缩(image 本身已压)
  const chunks: Buffer[] = [];
  archive.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve, reject) => {
    archive.on("end", resolve);
    archive.on("error", reject);
    archive.on("warning", (e) => {
      if (e.code === "ENOENT") {
        // 单图丢失只警告(README 里也记一笔),不让整个 zip 失败
        console.warn("[build-zip] missing file:", e);
      } else {
        reject(e);
      }
    });
  });

  archive.append(html, { name: "index.html" });

  if (includeRaw) {
    archive.append(JSON.stringify(record, null, 2), { name: "raw.json" });
  }

  archive.append(buildReadme(record), { name: "README.md" });

  // 图片:边读边塞。读失败的(文件丢了)跳过 —— index.html 那边会显示占位
  for (const { hit, zipPath } of cellToZipPath.values()) {
    const buf = await readImageBytes(hit);
    if (!buf) continue;
    archive.append(buf, { name: zipPath });
  }

  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

function buildReadme(record: BatchRunRecord): string {
  return `# ${record.name || "(未命名跑批)"}

批量测试导出包,${new Date().toLocaleString("zh-CN")}。

## 怎么看
**双击 \`index.html\`**,浏览器里会打开一份完整的横评报告。
图都在 \`images/\` 目录,index.html 用相对路径引用,所以解压后整个文件夹一起移动才能正常显示。

## 文件清单
- \`index.html\`:HTML 报告,自包含 CSS,无外部依赖
- \`images/\`:本次跑批的产物图,文件名 \`q{N}_{skill_id}[__{model}].{ext}\`(多 model 模式下带 model 后缀)
- \`raw.json\`:完整原始数据(BatchRunRecord schema),供脚本分析

## 元信息
- 跑批 ID:${record.id}
- 创建时间:${record.created_at}
- 规模:${record.queries.length} query × ${record.skill_ids.length} skill${
    record.image_model_ids && record.image_model_ids.length > 1
      ? ` × ${record.image_model_ids.length} model`
      : ""
  } = ${record.cells.length} cell
- 改写模型:${record.rewrite_llm || "(默认)"}
- 状态:${record.status}
`;
}

// 流式版本:大 record 不要全载入内存,直接 pipe 到 Response body。
// 当前实现用 Buffer 起步,够用即可;如果 record 涨到 GB 级再切流式。
export function bufferToStream(buf: Buffer): Readable {
  return Readable.from(buf);
}
