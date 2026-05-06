// prompt-rewriter/lib/export/build-blind-zip.ts
//
// 盲评 ZIP:index.html(匿名) + images/(匿名文件名) + README.md。
// **不**含 raw.json,**不**含任何 mapping 文件 —— 接收方能拿到的所有信息
// 都不能反推出策略。作者侧反向导入时用 buildAnonMapping 重新算。

import archiver from "archiver";
import { buildBlindHtml } from "./build-blind-html";
import { buildAnonMapping } from "./anon-mapping";
import {
  resolveLocalImage,
  readImageBytes,
  type LocalImageHit,
} from "./image-loader";
import type { BatchRunRecord, BatchCell } from "@/lib/schema";

// 匿名文件名:images/q01_p1.png
function imagePathInZip(
  queryIdx: number,
  position: number,
  hit: LocalImageHit
): string {
  const qi = String(queryIdx + 1).padStart(2, "0");
  return `images/q${qi}_p${position}.${hit.ext}`;
}

export async function buildBlindZip(
  record: BatchRunRecord
): Promise<Buffer> {
  const mapping = buildAnonMapping(record);

  // 准备 cell → zip 内路径映射
  type ZipImg = { hit: LocalImageHit; zipPath: string; cell: BatchCell };
  const cellToZip = new Map<string, ZipImg>();
  for (const queryList of mapping.byQuery) {
    for (const a of queryList) {
      const cell = record.cells.find(
        (c) => c.query_idx === a.query_idx && c.skill_id === a.skill_id
      );
      if (!cell) continue;
      const hit = resolveLocalImage(cell.image_urls?.[0]);
      if (!hit) continue;
      cellToZip.set(`${a.query_idx}::${a.skill_id}`, {
        hit,
        zipPath: imagePathInZip(a.query_idx, a.position, hit),
        cell,
      });
    }
  }

  // HTML 用同一份 zipPath
  const html = await buildBlindHtml(record, mapping, {
    resolveImageSrc: async (cell) => {
      const m = cellToZip.get(`${cell.query_idx}::${cell.skill_id}`);
      return m ? m.zipPath : null;
    },
  });

  // 打 zip
  const archive = archiver("zip", { store: true });
  const chunks: Buffer[] = [];
  archive.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve, reject) => {
    archive.on("end", resolve);
    archive.on("error", reject);
    archive.on("warning", (e) => {
      if (e.code === "ENOENT") {
        console.warn("[blind-zip] missing file:", e);
      } else {
        reject(e);
      }
    });
  });

  archive.append(html, { name: "index.html" });
  archive.append(buildReadme(record), { name: "README.md" });

  for (const { hit, zipPath } of cellToZip.values()) {
    const buf = await readImageBytes(hit);
    if (!buf) continue;
    archive.append(buf, { name: zipPath });
  }

  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

function buildReadme(record: BatchRunRecord): string {
  return `# ${record.name || "(未命名跑批)"} — 盲评包

## 怎么评
1. 双击 \`index.html\`,浏览器里打开
2. 顶部填评审人姓名(可空)
3. 每个 Q 下面有几张候选图,**点你认为最好的那张**(再点切换 / 取消)
4. 顶部进度条会显示完成度,本地浏览器自动暂存,关掉再开继续
5. 全部评完 → 顶部 "导出选择 .json" → 把生成的文件发回作者

## 注意
- 这是**盲评模式**:看不到任何策略名 / prompt 原文 / 测试目的,只看图本身
- 同一组候选图的展示顺序是固定的(deterministic),不是随机
- 一组只能选一张,不打分,不分维度

文件清单:
- \`index.html\`:评分页,自包含 CSS + JS,无外部依赖
- \`images/\`:候选图(文件名匿名,看不出策略身份)
`;
}
