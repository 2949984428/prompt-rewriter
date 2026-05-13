// prompt-rewriter/lib/questions/schema.ts
//
// 2026-05-13 重构:两级数据模型
//   - QuestionSet:题目集(一份 xlsx 导入 = 一个题目集)
//   - Question:题目本身,挂在 set 下
//
// 文件结构:
//   data/labs/questions/sets/<set_id>.json   ← 单个题目集详情(完整 Question[])
//   data/labs/questions/_index.json          ← 题目集瘦索引(列表用)
//
// input_content 是混合多模态:数组里每个 block 是 text 或 image。

import { z } from "zod";

export const ContentBlockSchema = z.object({
  content: z.string(),
  type: z.enum(["text", "image"]),
});
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

// Question:挂在 set 下,字段精简(imported_at/source_filename 挪到 set 上)
export const QuestionSchema = z.object({
  qid: z.string().min(1),
  input_content: z.array(ContentBlockSchema).default([]),
  categories: z.array(z.string()).default([]),
  input_data: z.record(z.string(), z.unknown()).default({}),
  tags: z.array(z.string()).default([]),          // PM 自定义
  note: z.string().default(""),                    // PM 自定义
});
export type Question = z.infer<typeof QuestionSchema>;

// Question 列表瘦视图
export const QuestionHeadSchema = z.object({
  qid: z.string(),
  text_preview: z.string(),
  has_images: z.boolean(),
  image_count: z.number(),
  categories: z.array(z.string()),
  tags: z.array(z.string()),
});
export type QuestionHead = z.infer<typeof QuestionHeadSchema>;

// QuestionSet:完整结构(写盘内容)
export const QuestionSetSchema = z.object({
  set_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  source_filename: z.string().default(""),
  created_at: z.string(),                  // ISO,首次创建时间
  updated_at: z.string(),                  // ISO,最后修改(PATCH/题目变动)
  questions: z.array(QuestionSchema).default([]),
});
export type QuestionSet = z.infer<typeof QuestionSetSchema>;

// QuestionSetHead:索引文件里的瘦字段(列表用,不含 questions[])
export const QuestionSetHeadSchema = z.object({
  set_id: z.string(),
  name: z.string(),
  description: z.string().default(""),
  source_filename: z.string().default(""),
  created_at: z.string(),
  updated_at: z.string(),
  count: z.number(),                       // 题数
});
export type QuestionSetHead = z.infer<typeof QuestionSetHeadSchema>;

// _index.json 结构
export const QuestionsIndexSchema = z.object({
  sets: z.array(QuestionSetHeadSchema).default([]),
});
export type QuestionsIndex = z.infer<typeof QuestionsIndexSchema>;

// 从 Question 摘 QuestionHead
export function toHead(q: Question): QuestionHead {
  const firstText = q.input_content.find((b) => b.type === "text")?.content ?? "";
  const images = q.input_content.filter((b) => b.type === "image");
  return {
    qid: q.qid,
    text_preview:
      firstText.length > 120 ? firstText.slice(0, 120) + "…" : firstText,
    has_images: images.length > 0,
    image_count: images.length,
    categories: q.categories,
    tags: q.tags,
  };
}

// 从 QuestionSet 摘 QuestionSetHead
export function toSetHead(s: QuestionSet): QuestionSetHead {
  return {
    set_id: s.set_id,
    name: s.name,
    description: s.description,
    source_filename: s.source_filename,
    created_at: s.created_at,
    updated_at: s.updated_at,
    count: s.questions.length,
  };
}
