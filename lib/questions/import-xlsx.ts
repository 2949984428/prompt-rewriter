// prompt-rewriter/lib/questions/import-xlsx.ts
//
// xlsx → Question[] 解析。共享给 API route(server-side upload)和 CLI script。
//
// 期望 sheet 列(4 列,顺序无关,按 header 名匹配):
//   qid              · string,题目唯一 id
//   input_content    · JSON 字符串,数组 [{content, type}]
//   categories       · JSON 字符串,数组 [L1, L2, ...]
//   input_data       · JSON 字符串,object(大多 {})
//
// 解析容错:
//   - JSON 字符串解析失败 → 该字段填默认值,该题不会被丢弃
//   - 缺 qid 的行直接跳过(no qid no item)
//   - 重复 qid 后到的覆盖前到的(xlsx 内自身有重复时)

import ExcelJS from "exceljs";
import {
  QuestionSchema,
  type ContentBlock,
  type Question,
} from "./schema";

export interface ParseResult {
  questions: Question[];
  total_rows: number;          // sheet 实际数据行数(不含 header)
  skipped: number;             // 缺 qid 跳过的行数
  duplicates: number;          // 重复 qid 被覆盖的行数
  errors: { row: number; reason: string }[]; // 单行 schema 校验失败(也会跳过)
}

function safeJSON<T>(s: unknown, fallback: T): T {
  if (s === null || s === undefined) return fallback;
  const text = String(s).trim();
  if (!text || text === "{}" || text === "[]") {
    // 空对象 / 空数组按字面 parse,跟 fallback 类型对得上才返
    try {
      return JSON.parse(text) as T;
    } catch {
      return fallback;
    }
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** 从 buffer 解析 xlsx,返回 Question[](源文件名仅用于 metadata) */
export async function parseQuestionsXlsx(
  buffer: ArrayBuffer | Buffer,
  filename: string,
): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  // exceljs 的 xlsx.load 签名旧版标 Buffer,实际运行时也接受 ArrayBuffer + Uint8Array。
  // 不同 Node TS lib 版本下 Buffer / ArrayBuffer / SharedArrayBuffer 类型互不兼容,
  // 这里统一 cast 成 unknown 再喂进去,避免上层调用方还要自己做类型适配。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buffer as any);

  const ws = wb.worksheets[0];
  if (!ws) {
    return {
      questions: [],
      total_rows: 0,
      skipped: 0,
      duplicates: 0,
      errors: [{ row: 0, reason: "xlsx 没有 worksheet" }],
    };
  }

  // 找 header 行(假设第 1 行是 header)
  const header = ws.getRow(1);
  const colIdx: Record<string, number> = {};
  header.eachCell((cell, col) => {
    const name = String(cell.value ?? "").trim();
    if (name) colIdx[name] = col;
  });

  const need = ["qid", "input_content", "categories", "input_data"];
  const missing = need.filter((k) => !(k in colIdx));
  if (missing.length > 0) {
    return {
      questions: [],
      total_rows: 0,
      skipped: 0,
      duplicates: 0,
      errors: [
        {
          row: 1,
          reason: `header 缺少必需列: ${missing.join(", ")} (找到 ${Object.keys(colIdx).join(", ")})`,
        },
      ],
    };
  }

  const byId = new Map<string, Question>();
  let totalRows = 0;
  let skipped = 0;
  let duplicates = 0;
  const errors: ParseResult["errors"] = [];

  for (let rowNum = 2; rowNum <= ws.rowCount; rowNum++) {
    const row = ws.getRow(rowNum);
    const qidRaw = row.getCell(colIdx["qid"]).value;
    const qid = qidRaw == null ? "" : String(qidRaw).trim();
    if (!qid) {
      // 行可能整行空,跳过但不计 skipped
      const allEmpty = need.every((k) => {
        const v = row.getCell(colIdx[k]).value;
        return v == null || String(v).trim() === "";
      });
      if (allEmpty) continue;
      skipped++;
      continue;
    }
    totalRows++;

    const inputContent = safeJSON<ContentBlock[]>(
      row.getCell(colIdx["input_content"]).value,
      [],
    );
    const categories = safeJSON<string[]>(
      row.getCell(colIdx["categories"]).value,
      [],
    );
    const inputData = safeJSON<Record<string, unknown>>(
      row.getCell(colIdx["input_data"]).value,
      {},
    );

    const candidate: Question = {
      qid,
      input_content: Array.isArray(inputContent) ? inputContent : [],
      categories: Array.isArray(categories) ? categories : [],
      input_data:
        typeof inputData === "object" && inputData !== null ? inputData : {},
      tags: [],
      note: "",
    };

    const parsed = QuestionSchema.safeParse(candidate);
    if (!parsed.success) {
      errors.push({
        row: rowNum,
        reason: parsed.error.issues
          .slice(0, 2)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
      continue;
    }

    if (byId.has(qid)) duplicates++;
    byId.set(qid, parsed.data);
  }

  return {
    questions: Array.from(byId.values()),
    total_rows: totalRows,
    skipped,
    duplicates,
    errors,
  };
}
