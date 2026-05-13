# 融合台 (Fusion Lab) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 prompt-rewriter 项目里加第 4 个实验台「融合台」,把任意线上 prompt 和实验台规则用 LLM 融合,产出标注 changes / conflicts 的新 prompt,自动落历史。

**Architecture:** 复用现有三个 lab 的"独立 atoms 文件 + 独立 components 目录 + 独立 API 路由 + 中央 history-index"模式。LLM 调用走现有 `lib/llm.ts`(OpenAI-compat 工具协议)。规则提取做一个独立 `lib/skill-rule-index.ts`(扫 `data/labs/format/skills/*.md` 抽 section/principle 树)。

**Tech Stack:** Next.js 16.2 App Router · React 19 · Jotai 2 · Zod v4 · base-ui 4.5(shadcn 4.5)· Tailwind v4 · Claude Sonnet 4.6(默认)

**对应 spec:** `docs/superpowers/specs/2026-04-29-fusion-lab-design.md`(12 个决策的最终来源)

---

### Task 1: Schema 定义

**Files:**
- Modify: `lib/schema.ts`

- [ ] **Step 1: 加 6 个新 schema(FusionMergeStrategy / RuleSource / Conflict / ChangeMarker / MergeResult / Attempt / RunRecord)**

```typescript
// 在 lib/schema.ts 末尾追加(BatchRunRecord 之后):

// ───────────── 融合台 (Fusion Lab) ─────────────
//
// 把"任意 production prompt + 实验台规则"融合成新 prompt。
// 复用 batch lab 的"一 run 一 file + per-id mutex"持久化模式,但 schema 独立。
//
// 关键点:
// - attempts 是数组(每次 LLM 重试都 append),便于 PM 回看每一版尝试
// - changes 跟 conflicts 都用 char offset 标位置(不是行号),前端渲染时基于 merged_prompt 切片高亮
// - rule 用 discriminated union 区分"实验台来源"和"自由 paste"
export const FusionMergeStrategySchema = z.enum([
  "append",          // 追加在末尾
  "insert_nearby",   // 就近插入(LLM 找语义相近段)
  "replace_section", // 替换冲突段(老规则 swap 成新规则)
  "wrap_reference",  // 包裹引用(prompt 头加引用 + 末尾 append 全文)
  "rewrite_embed",   // 改写嵌入(把现有段改写成体现新规则)
  "few_shot",        // 加 few-shot 示例
]);
export type FusionMergeStrategy = z.infer<typeof FusionMergeStrategySchema>;

export const FusionRuleSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("lab"),
    skill_id: z.string(),
    granularity: z.enum(["skill", "section", "principle"]),
    section_anchor: z.string().optional(),
    extracted_text: z.string(),  // 实际抽出的规则原文(冗余存,便于复盘)
  }),
  z.object({
    kind: z.literal("custom"),
    text: z.string(),
  }),
]);
export type FusionRuleSource = z.infer<typeof FusionRuleSourceSchema>;

export const FusionConflictSchema = z.object({
  id: z.string(),
  region_start: z.number(),
  region_end: z.number(),
  original_text: z.string(),
  new_rule_text: z.string(),
  resolution: z.enum(["new", "old"]).default("new"),
});
export type FusionConflict = z.infer<typeof FusionConflictSchema>;

export const FusionChangeMarkerSchema = z.object({
  id: z.string(),
  type: z.enum(["addition", "modification", "replacement"]),
  region_start: z.number(),
  region_end: z.number(),
  strategy: FusionMergeStrategySchema,
  reason: z.string(),
  original_text: z.string().optional(),
});
export type FusionChangeMarker = z.infer<typeof FusionChangeMarkerSchema>;

export const FusionMergeResultSchema = z.object({
  merged_prompt: z.string(),
  strategy: FusionMergeStrategySchema,
  changes: z.array(FusionChangeMarkerSchema),
  conflicts: z.array(FusionConflictSchema),
  llm_explanation: z.string(),
  ms: z.number(),
  raw: z.string(),
});
export type FusionMergeResult = z.infer<typeof FusionMergeResultSchema>;

export const FusionAttemptSchema = z.object({
  timestamp: z.string(),
  strategy_request: FusionMergeStrategySchema.optional(),
  hint: z.string().default(""),
  result: FusionMergeResultSchema.nullable(),
  error: z.string().nullable().default(null),
});
export type FusionAttempt = z.infer<typeof FusionAttemptSchema>;

export const FusionRunStatusSchema = z.enum([
  "draft",     // 创建未跑融合
  "merging",   // LLM 跑中
  "ready",     // 至少有一次成功融合
  "discarded", // PM 主动丢弃
]);
export type FusionRunStatus = z.infer<typeof FusionRunStatusSchema>;

export const FusionRunRecordSchema = z.object({
  id: z.string().min(1),
  created_at: z.string(),
  name: z.string().default(""),
  source_prompt: z.string(),
  rule: FusionRuleSourceSchema,
  rewrite_llm: z.string().default(""),
  attempts: z.array(FusionAttemptSchema),
  status: FusionRunStatusSchema.default("draft"),
});
export type FusionRunRecord = z.infer<typeof FusionRunRecordSchema>;

// 列表页瘦索引(避免读全文)
export const FusionRunSummarySchema = z.object({
  id: z.string(),
  created_at: z.string(),
  name: z.string(),
  status: FusionRunStatusSchema,
  rule_kind: z.enum(["lab", "custom"]),
  rule_label: z.string(),  // "F15 / Language strategy" 或 "自定义规则"
  source_prompt_preview: z.string(),  // 前 60 字
  attempt_count: z.number().int(),
});
export type FusionRunSummary = z.infer<typeof FusionRunSummarySchema>;
```

- [ ] **Step 2: 跑 tsc 确认无错**

Run: `node ./node_modules/.bin/tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: 提交**

```bash
git add lib/schema.ts
git commit -m "feat(fusion): add Fusion Lab schemas (rule source, change marker, conflict, attempt, run record)"
```

---

### Task 2: 持久化层 + per-id mutex

**Files:**
- Create: `lib/fusion-store.ts`

- [ ] **Step 1: 写 fusion-store.ts(参考 batch-store.ts 模式)**

```typescript
// prompt-rewriter/lib/fusion-store.ts
//
// 融合台持久化层。模式跟 batch-store.ts 一致:
//   data/labs/fusion/runs/<id>.json     一 run 一文件
//   per-id mutex 串行写盘(防 lost update)
//   原子 rename(写 .tmp + rename)

import { promises as fs } from "fs";
import path from "path";
import {
  FusionRunRecordSchema,
  type FusionRunRecord,
  type FusionAttempt,
  type FusionRunSummary,
} from "@/lib/schema";

export const FUSION_DIR = path.join(
  process.cwd(),
  "data",
  "labs",
  "fusion",
  "runs"
);

async function ensureDir() {
  await fs.mkdir(FUSION_DIR, { recursive: true });
}

function runFile(id: string): string {
  const safe = path.basename(id);
  return path.join(FUSION_DIR, `${safe}.json`);
}

type Mutex = { tail: Promise<void> };
type GlobalState = { mutexes: Map<string, Mutex> };
function getState(): GlobalState {
  const g = globalThis as unknown as { __fusionStoreState?: GlobalState };
  if (!g.__fusionStoreState) g.__fusionStoreState = { mutexes: new Map() };
  return g.__fusionStoreState;
}

async function withMutex<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const state = getState();
  let m = state.mutexes.get(id);
  if (!m) {
    m = { tail: Promise.resolve() };
    state.mutexes.set(id, m);
  }
  const prev = m.tail;
  let release: () => void = () => {};
  m.tail = new Promise<void>((res) => { release = res; });
  try {
    await prev;
    return await fn();
  } finally {
    release();
  }
}

export async function readRun(id: string): Promise<FusionRunRecord | null> {
  await ensureDir();
  try {
    const text = await fs.readFile(runFile(id), "utf-8");
    return FusionRunRecordSchema.parse(JSON.parse(text));
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    throw e;
  }
}

export async function writeRun(record: FusionRunRecord): Promise<void> {
  await ensureDir();
  const valid = FusionRunRecordSchema.parse(record);
  await withMutex(record.id, async () => {
    const tmp = runFile(record.id) + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(valid, null, 2), "utf-8");
    await fs.rename(tmp, runFile(record.id));
  });
}

// 追加一次 attempt(初始 + 重试都用这个)
export async function appendAttempt(
  id: string,
  attempt: FusionAttempt
): Promise<FusionRunRecord | null> {
  await ensureDir();
  return withMutex(id, async () => {
    const text = await fs
      .readFile(runFile(id), "utf-8")
      .catch((e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
    if (text === null) return null;
    const record = FusionRunRecordSchema.parse(JSON.parse(text));
    record.attempts.push(attempt);
    record.status = attempt.result ? "ready" : "merging";
    const valid = FusionRunRecordSchema.parse(record);
    const tmp = runFile(id) + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(valid, null, 2), "utf-8");
    await fs.rename(tmp, runFile(id));
    return valid;
  });
}

// 改 status / name(局部更新)
export async function patchRecord(
  id: string,
  patch: Partial<Pick<FusionRunRecord, "name" | "status">>
): Promise<FusionRunRecord | null> {
  await ensureDir();
  return withMutex(id, async () => {
    const text = await fs
      .readFile(runFile(id), "utf-8")
      .catch((e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
    if (text === null) return null;
    const record = FusionRunRecordSchema.parse(JSON.parse(text));
    const merged = { ...record, ...patch };
    const valid = FusionRunRecordSchema.parse(merged);
    const tmp = runFile(id) + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(valid, null, 2), "utf-8");
    await fs.rename(tmp, runFile(id));
    return valid;
  });
}

// 列表(扫目录,每个文件抠 summary)
export async function listSummaries(): Promise<FusionRunSummary[]> {
  await ensureDir();
  const files = await fs.readdir(FUSION_DIR);
  const out: FusionRunSummary[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const text = await fs.readFile(path.join(FUSION_DIR, f), "utf-8");
      const r = FusionRunRecordSchema.parse(JSON.parse(text));
      const ruleLabel =
        r.rule.kind === "lab"
          ? `${r.rule.skill_id} / ${r.rule.granularity}${r.rule.section_anchor ? ` / ${r.rule.section_anchor}` : ""}`
          : "自定义规则";
      out.push({
        id: r.id,
        created_at: r.created_at,
        name: r.name,
        status: r.status,
        rule_kind: r.rule.kind,
        rule_label: ruleLabel,
        source_prompt_preview: r.source_prompt.slice(0, 60),
        attempt_count: r.attempts.length,
      });
    } catch {
      // 跳过坏文件
    }
  }
  out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return out;
}
```

- [ ] **Step 2: tsc 验证 0 错误,提交**

```bash
node ./node_modules/.bin/tsc --noEmit
git add lib/fusion-store.ts
git commit -m "feat(fusion): add fusion-store with per-id mutex + append-only attempts"
```

---

### Task 3: 规则索引(skill / section / principle 三级抽取)

**Files:**
- Create: `lib/skill-rule-index.ts`

- [ ] **Step 1: 写 skill 抽取工具**

```typescript
// prompt-rewriter/lib/skill-rule-index.ts
//
// 把 data/labs/format/skills/*.md 扫出来,按"三级粒度"产出 rule index。
// 给融合台前端的下拉菜单消费。
//
// 抽取规则:
//   - level 1 (skill):整个 .md 文件
//   - level 2 (section):H1 / H2 标题 + 标题下到下一个同级标题前的所有内容
//   - level 3 (principle):section 内 numbered list / bullet 项(粗略匹配 ^[\d-*] )
//     单条原则 + 其后续 1-2 行解释作为 extracted_text

import { promises as fs } from "fs";
import path from "path";

const SKILLS_DIR = path.join(process.cwd(), "data", "labs", "format", "skills");

export type SkillRuleNode = {
  skill_id: string;
  skill_label: string;
  sections: SectionNode[];
};

export type SectionNode = {
  anchor: string;       // section 标题(原文)
  text: string;         // section 全文
  principles: PrincipleNode[];
};

export type PrincipleNode = {
  id: string;           // 原则的简短 id(从首句生成)
  text: string;         // 原则原文 + 上下文
};

export async function buildSkillRuleIndex(): Promise<SkillRuleNode[]> {
  const files = await fs.readdir(SKILLS_DIR);
  const out: SkillRuleNode[] = [];
  for (const f of files) {
    if (!f.endsWith(".md")) continue;
    if (f.startsWith("_")) continue;  // 跳过 _universal.md(单独处理)
    const content = await fs.readFile(path.join(SKILLS_DIR, f), "utf-8");
    const skill_id = f.replace(/\.md$/, "");
    out.push({
      skill_id,
      skill_label: extractSkillLabel(content) ?? skill_id,
      sections: extractSections(content),
    });
  }
  // universal 单独 push
  try {
    const u = await fs.readFile(path.join(SKILLS_DIR, "_universal.md"), "utf-8");
    out.unshift({
      skill_id: "_universal",
      skill_label: "通用规则 (universal)",
      sections: extractSections(u),
    });
  } catch {
    // _universal.md 缺失则跳过
  }
  return out;
}

function extractSkillLabel(md: string): string | null {
  // frontmatter 里找 label
  const m = md.match(/^---[\s\S]*?label:\s*(.+?)\n[\s\S]*?---/);
  return m ? m[1].trim() : null;
}

function extractSections(md: string): SectionNode[] {
  // 按 # 或 ## 切分 section
  const lines = md.split("\n");
  const sections: SectionNode[] = [];
  let current: { anchor: string; lines: string[] } | null = null;
  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,2})\s+(.+)/);
    if (headerMatch) {
      if (current) {
        sections.push({
          anchor: current.anchor,
          text: current.lines.join("\n"),
          principles: extractPrinciples(current.lines.join("\n")),
        });
      }
      current = { anchor: headerMatch[2].trim(), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) {
    sections.push({
      anchor: current.anchor,
      text: current.lines.join("\n"),
      principles: extractPrinciples(current.lines.join("\n")),
    });
  }
  return sections;
}

function extractPrinciples(sectionText: string): PrincipleNode[] {
  // 简单启发:**bold** 开头的 bullet 项 = 一条原则
  // 例如 "- **Conservation** — every explicit element..."
  const lines = sectionText.split("\n");
  const principles: PrincipleNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^[-*\d.+]+\s*\*\*([^*]+)\*\*/);
    if (m) {
      // 取该行 + 后续 2 行作为上下文
      const text = lines.slice(i, i + 3).join("\n").trim();
      principles.push({
        id: m[1].trim().toLowerCase().replace(/\s+/g, "-").slice(0, 60),
        text,
      });
    }
  }
  return principles;
}
```

- [ ] **Step 2: 写测试用例,手动验证抽取结果**

Run:
```bash
cd prompt-rewriter && node -e "
require('@swc/register');
const { buildSkillRuleIndex } = require('./lib/skill-rule-index.ts');
buildSkillRuleIndex().then(r => console.log(JSON.stringify(r, null, 2).slice(0, 4000)));
"
```
Expected: 输出 16 个 skill 的 nested 结构,每个含若干 sections,F15 / F16 等带 principles。

- [ ] **Step 3: tsc 验证 + 提交**

```bash
node ./node_modules/.bin/tsc --noEmit
git add lib/skill-rule-index.ts
git commit -m "feat(fusion): add skill-rule-index for 3-level (skill/section/principle) rule extraction"
```

---

### Task 4: LLM 融合 runner(核心算法)

**Files:**
- Create: `lib/fusion-runner.ts`

- [ ] **Step 1: 写 LLM 调用 + 工具协议**

```typescript
// prompt-rewriter/lib/fusion-runner.ts
//
// 核心:把 source_prompt + rule + (optional strategy/hint) 喂给 LLM,
// LLM 通过工具协议返回结构化融合结果。
//
// 不在这里做的事:
//   - 不写盘(由 API 路由调 fusion-store 写)
//   - 不做规则抽取(由 skill-rule-index 提前算好,API 路由透传)

import { callLLMToolStream, LLMError } from "@/lib/llm";
import {
  FusionMergeResultSchema,
  type FusionMergeResult,
  type FusionRuleSource,
  type FusionMergeStrategy,
} from "@/lib/schema";

const FUSION_SYSTEM = `
You are a Prompt Fusion Assistant. Your job: take a user's production prompt (SOURCE_PROMPT) and a rule (RULE), and merge the rule into the prompt while preserving the prompt's intent and structure.

# Strategies (you MUST pick exactly one)
1. append            — pure tail-append (rule has no semantic overlap with existing prompt)
2. insert_nearby     — find semantically related section, insert rule after it
3. replace_section   — old prompt has content that contradicts the rule, swap that section
4. wrap_reference    — rule is too long; add a brief "also follow X (defined below)" reference at top + full rule at end
5. rewrite_embed     — old prompt has a paragraph that should be rewritten to embody the rule
6. few_shot          — rule is best demonstrated by examples; append 1-2 few-shot demonstrations

If a STRATEGY_REQUEST is given, you MUST use that strategy. Otherwise pick the best fit.

# Hint
If a HINT is given (PM's feedback from a previous attempt), incorporate it. Common hints: "don't use X strategy", "rule should appear before section Y", "this paragraph shouldn't be touched".

# Conflict detection
A "conflict" = a region in the merged_prompt where the new rule's content directly contradicts what the source prompt previously stated. Examples:
  - Source says "always output English"; rule says "preserve Chinese characters verbatim"
  - Source says "be concise"; rule says "expand with detailed examples"

For each conflict, emit a conflict entry. The default resolution is "new" (rule wins). Conflicts should ALSO appear as a change marker (region overlap is fine).

# Output (via emit_fusion_result tool)
{
  merged_prompt: string,
  strategy: enum,
  changes: [{ id, type, region_start, region_end, strategy, reason, original_text? }],
    type:
      "addition"     — new content inserted (no original)
      "modification" — existing content reworded
      "replacement"  — existing content swapped wholesale
    region_start/end: char offsets in merged_prompt
  conflicts: [{ id, region_start, region_end, original_text, new_rule_text }],
  llm_explanation: string  // 1-3 sentences summary for PM
}

# Rules
- Preserve source prompt's overall structure and voice; only change what's necessary
- Don't summarize the rule unless absolutely needed; preserve verbatim where possible
- All change ids and conflict ids should be short stable strings (e.g. "c1", "c2", ...)
- region_start/end MUST refer to char offsets in the FINAL merged_prompt (not source)
`.trim();

export const fusionTool = {
  type: "function" as const,
  function: {
    name: "emit_fusion_result",
    description: "Emit the structured fusion result.",
    parameters: {
      type: "object",
      properties: {
        merged_prompt: { type: "string" },
        strategy: {
          type: "string",
          enum: ["append", "insert_nearby", "replace_section", "wrap_reference", "rewrite_embed", "few_shot"],
        },
        changes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              type: { type: "string", enum: ["addition", "modification", "replacement"] },
              region_start: { type: "number" },
              region_end: { type: "number" },
              strategy: {
                type: "string",
                enum: ["append", "insert_nearby", "replace_section", "wrap_reference", "rewrite_embed", "few_shot"],
              },
              reason: { type: "string" },
              original_text: { type: "string" },
            },
            required: ["id", "type", "region_start", "region_end", "strategy", "reason"],
          },
        },
        conflicts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              region_start: { type: "number" },
              region_end: { type: "number" },
              original_text: { type: "string" },
              new_rule_text: { type: "string" },
            },
            required: ["id", "region_start", "region_end", "original_text", "new_rule_text"],
          },
        },
        llm_explanation: { type: "string" },
      },
      required: ["merged_prompt", "strategy", "changes", "conflicts", "llm_explanation"],
    },
  },
};

function ruleToText(rule: FusionRuleSource): string {
  return rule.kind === "lab" ? rule.extracted_text : rule.text;
}

export type FusionRunInput = {
  source_prompt: string;
  rule: FusionRuleSource;
  strategy_request?: FusionMergeStrategy;
  hint?: string;
  llm_model?: string;
};

export type FusionRunOutput = {
  result: FusionMergeResult | null;
  error: string | null;
};

export async function runFusion(input: FusionRunInput): Promise<FusionRunOutput> {
  const startedAt = Date.now();
  const userMsg = [
    `<SOURCE_PROMPT>\n${input.source_prompt}\n</SOURCE_PROMPT>`,
    `<RULE>\n${ruleToText(input.rule)}\n</RULE>`,
    input.strategy_request ? `<STRATEGY_REQUEST>${input.strategy_request}</STRATEGY_REQUEST>` : "",
    input.hint ? `<HINT>${input.hint}</HINT>` : "",
    "Call emit_fusion_result with the structured fusion output.",
  ].filter(Boolean).join("\n\n");

  let raw = "";
  try {
    for await (const delta of callLLMToolStream(
      [
        { role: "system", content: FUSION_SYSTEM },
        { role: "user", content: userMsg },
      ],
      fusionTool,
      input.llm_model
    )) {
      raw += delta;
    }
    if (!raw.trim()) throw new LLMError("LLM 未通过工具返回任何参数");
    const parsed = JSON.parse(raw);
    const validated = FusionMergeResultSchema.parse({
      ...parsed,
      ms: Date.now() - startedAt,
      raw,
    });
    return { result: validated, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { result: null, error: msg };
  }
}
```

- [ ] **Step 2: tsc + 提交**

```bash
node ./node_modules/.bin/tsc --noEmit
git add lib/fusion-runner.ts
git commit -m "feat(fusion): add LLM fusion runner with structured tool protocol"
```

---

### Task 5: API 路由

**Files:**
- Create: `app/api/labs/fusion/runs/route.ts`(POST = create + first merge / GET = list)
- Create: `app/api/labs/fusion/runs/[id]/route.ts`(GET = detail / DELETE = discard)
- Create: `app/api/labs/fusion/runs/[id]/merge/route.ts`(POST = re-merge with hint / strategy)
- Create: `app/api/labs/fusion/skill-rules/route.ts`(GET = skill rule index for 下拉)

- [ ] **Step 1: POST /api/labs/fusion/runs(创建 + 立刻跑首次融合)**

```typescript
// app/api/labs/fusion/runs/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { writeRun, listSummaries } from "@/lib/fusion-store";
import { runFusion } from "@/lib/fusion-runner";
import {
  FusionRuleSourceSchema,
  FusionMergeStrategySchema,
  type FusionRunRecord,
} from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  name: z.string().default(""),
  source_prompt: z.string().min(1),
  rule: FusionRuleSourceSchema,
  strategy_request: FusionMergeStrategySchema.optional(),
  rewrite_llm: z.string().default(""),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const { name, source_prompt, rule, strategy_request, rewrite_llm } = parsed.data;

  // 立刻跑首次融合
  const fusion = await runFusion({
    source_prompt,
    rule,
    strategy_request,
    llm_model: rewrite_llm || undefined,
  });

  const id = crypto.randomUUID();
  const record: FusionRunRecord = {
    id,
    created_at: new Date().toISOString(),
    name,
    source_prompt,
    rule,
    rewrite_llm,
    attempts: [{
      timestamp: new Date().toISOString(),
      strategy_request,
      hint: "",
      result: fusion.result,
      error: fusion.error,
    }],
    status: fusion.result ? "ready" : "draft",
  };
  await writeRun(record);
  return NextResponse.json({ ok: true, id, record }, { status: 201 });
}

export async function GET() {
  const runs = await listSummaries();
  return NextResponse.json({ runs });
}
```

- [ ] **Step 2: GET / DELETE /api/labs/fusion/runs/[id]**

```typescript
// app/api/labs/fusion/runs/[id]/route.ts
import { NextResponse } from "next/server";
import { readRun, patchRecord } from "@/lib/fusion-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await readRun(id);
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ record: r });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await patchRecord(id, { status: "discarded" });
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: POST /api/labs/fusion/runs/[id]/merge(重试)**

```typescript
// app/api/labs/fusion/runs/[id]/merge/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { readRun, appendAttempt } from "@/lib/fusion-store";
import { runFusion } from "@/lib/fusion-runner";
import { FusionMergeStrategySchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RetrySchema = z.object({
  hint: z.string().default(""),
  strategy_request: FusionMergeStrategySchema.optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const parsed = RetrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  const record = await readRun(id);
  if (!record) return NextResponse.json({ error: "not found" }, { status: 404 });

  const fusion = await runFusion({
    source_prompt: record.source_prompt,
    rule: record.rule,
    strategy_request: parsed.data.strategy_request,
    hint: parsed.data.hint,
    llm_model: record.rewrite_llm || undefined,
  });

  const updated = await appendAttempt(id, {
    timestamp: new Date().toISOString(),
    strategy_request: parsed.data.strategy_request,
    hint: parsed.data.hint,
    result: fusion.result,
    error: fusion.error,
  });
  return NextResponse.json({ ok: true, record: updated });
}
```

- [ ] **Step 4: GET /api/labs/fusion/skill-rules**

```typescript
// app/api/labs/fusion/skill-rules/route.ts
import { NextResponse } from "next/server";
import { buildSkillRuleIndex } from "@/lib/skill-rule-index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const index = await buildSkillRuleIndex();
  return NextResponse.json({ index });
}
```

- [ ] **Step 5: tsc + 手动 curl 验证 + 提交**

Run:
```bash
node ./node_modules/.bin/tsc --noEmit
npm run dev
# 在另一个终端:
curl -s http://localhost:3000/api/labs/fusion/skill-rules | head -100
curl -s -X POST http://localhost:3000/api/labs/fusion/runs \
  -H 'Content-Type: application/json' \
  -d '{"name":"test","source_prompt":"You are a helpful assistant.","rule":{"kind":"custom","text":"Always respond in Chinese."}}'
```
Expected:验证返回 200 / 201 + 合法 JSON。

```bash
git add app/api/labs/fusion/
git commit -m "feat(fusion): add API routes (create/list/detail/merge/discard + skill-rules index)"
```

---

### Task 6: Atoms

**Files:**
- Create: `lib/atoms-fusion.ts`

- [ ] **Step 1: 写 fusion atoms**

```typescript
// prompt-rewriter/lib/atoms-fusion.ts
//
// 融合台状态。view 状态机:list / create / detail。
// 不上路由(整 demo 是 SPA),不污染其他 lab atoms。

import { atom } from "jotai";
import type { FusionRunRecord, FusionRunSummary } from "./schema";
import type { SkillRuleNode } from "./skill-rule-index";

export type FusionView =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "detail"; id: string };

export const fusionViewAtom = atom<FusionView>({ kind: "list" });
export const fusionSummariesAtom = atom<FusionRunSummary[]>([]);
export const fusionSummariesLoadedAtom = atom<boolean>(false);
export const currentFusionRunAtom = atom<FusionRunRecord | null>(null);

// 实验台规则下拉数据(从 /api/labs/fusion/skill-rules 拉,启动时 once)
export const skillRuleIndexAtom = atom<SkillRuleNode[]>([]);
export const skillRuleIndexLoadedAtom = atom<boolean>(false);
```

- [ ] **Step 2: tsc + 提交**

```bash
node ./node_modules/.bin/tsc --noEmit
git add lib/atoms-fusion.ts
git commit -m "feat(fusion): add jotai atoms for fusion lab state"
```

---

### Task 7: 主 nav 集成 + lab-root 入口

**Files:**
- Modify: `components/lab-side-tab.tsx`(或主导航文件,需查看现状)
- Create: `components/labs/fusion/lab-root.tsx`

- [ ] **Step 1: 查找主 nav 文件**

Run: `grep -rn "rewrite\|format\|batch" components/ | grep -i "tab\|nav\|side" | head`

- [ ] **Step 2: 在主 nav 加"融合台"项,wire 到 lab-root**

具体改动看实际文件结构;关键是新增第 4 个 tab,选中时渲染 `FusionLabRoot`。

- [ ] **Step 3: lab-root.tsx — 根据 view atom 切换 list / create / detail**

```typescript
// components/labs/fusion/lab-root.tsx
"use client";
import { useAtom } from "jotai";
import { fusionViewAtom } from "@/lib/atoms-fusion";
import { FusionListView } from "./list-view";
import { FusionCreateForm } from "./create-form";
import { FusionDetailView } from "./detail-view";

export function FusionLabRoot() {
  const [view] = useAtom(fusionViewAtom);
  if (view.kind === "create") return <FusionCreateForm />;
  if (view.kind === "detail") return <FusionDetailView id={view.id} />;
  return <FusionListView />;
}
```

- [ ] **Step 4: 提交**

```bash
git add components/labs/fusion/lab-root.tsx components/<navfile>
git commit -m "feat(fusion): wire Fusion Lab into main nav as 4th lab"
```

---

### Task 8: 列表页

**Files:**
- Create: `components/labs/fusion/list-view.tsx`

- [ ] **Step 1: 写 list-view(参考 batch list-view 模式)**

显示项:name(默认 = 创建时 timestamp)/ rule_label / source_prompt_preview(前 60 字)/ status badge / attempt_count / 创建时间。
顶部"+ 新建融合"按钮 → 切到 create view。
点击列表项 → 切到 detail view 并预填 currentFusionRunAtom。

具体代码参考 `components/labs/batch/list-view.tsx` 的 STATUS_LABEL / STATUS_BADGE / 表格渲染模式。

- [ ] **Step 2: tsc + 跑 dev server 视觉验证 + 提交**

---

### Task 9: 创建表单(双轨规则选择 + token 估算)

**Files:**
- Create: `components/labs/fusion/create-form.tsx`
- Create: `components/labs/fusion/rule-picker.tsx`(规则选择子组件)
- Create: `lib/token-estimate.ts`(token 估算工具)

- [ ] **Step 1: token-estimate.ts**

```typescript
// prompt-rewriter/lib/token-estimate.ts
//
// 粗略 token 估算(对齐 Claude tokenizer)。
// 中文 char × 1 + ASCII char × 0.25,误差 ±20%。
// 用于融合台输入侧的软提醒,不强求精确。

export function estimateTokens(text: string): number {
  let t = 0;
  for (const c of text) {
    const code = c.charCodeAt(0);
    // CJK 范围(粗略)
    if (code >= 0x4e00 && code <= 0x9fff) t += 1;
    else if (code >= 0x3040 && code <= 0x309f) t += 1; // 平假名
    else if (code >= 0x30a0 && code <= 0x30ff) t += 1; // 片假名
    else if (code >= 0xac00 && code <= 0xd7af) t += 1; // 韩文
    else t += 0.25;
  }
  return Math.round(t);
}

export type TokenWarnLevel = "ok" | "yellow" | "red" | "danger";

export function tokenWarnLevel(estimated: number): TokenWarnLevel {
  if (estimated > 32000) return "danger";
  if (estimated > 16000) return "red";
  if (estimated > 8000) return "yellow";
  return "ok";
}
```

- [ ] **Step 2: rule-picker.tsx(双 tab,实验台下拉 + 自由 paste)**

需求:
- Tab 1:三级下拉(skill / section / principle),底部预览框显示 `extracted_text`
- Tab 2:textarea,PM 自由 paste

返回 `FusionRuleSource` 给父组件。

skill rule index 启动时从 `/api/labs/fusion/skill-rules` 拉一次,缓存到 `skillRuleIndexAtom`。

- [ ] **Step 3: create-form.tsx 集成**

```
[输入 source_prompt textarea] -- 显示 token 估算 + 警示色
[RulePicker] -- 双轨选择
[融合策略下拉:LLM 自选 / 6 种策略]
[LlmModelSwitcher 复用]
[提交按钮]
```

提交时 POST `/api/labs/fusion/runs`,成功后切到 detail view 用 returned record 填 currentFusionRunAtom。

- [ ] **Step 4: tsc + 视觉验证 + 提交**

---

### Task 10: 详情页 + 改动渲染 + 冲突回退

**Files:**
- Create: `components/labs/fusion/detail-view.tsx`
- Create: `components/labs/fusion/diff-renderer.tsx`(单栏融合 prompt + 改动标记)
- Create: `components/labs/fusion/conflict-card.tsx`(冲突展开 panel)
- Create: `components/labs/fusion/retry-bar.tsx`(hint textarea + 换策略 + 重试按钮)

- [ ] **Step 1: diff-renderer.tsx**

输入:`merged_prompt + changes + conflicts`
输出:富文本(单栏),每个 change region 加颜色边框 + 数字标号;点击 region 弹小 panel(`change.reason / change.original_text / change.strategy / 回退按钮`);conflicts 用红色边框 override。

实现关键:把 changes + conflicts 按 region_start 排序,逐个切片渲染 `merged_prompt`(切片之间是普通文本,切片内是带边框的 span)。

- [ ] **Step 2: conflict-card.tsx**

冲突 panel 展开时显示:
- 原文(`original_text`)
- 新规则要求(`new_rule_text`)
- LLM 解释(对应的 change.reason)
- 单按钮"回退该处保留原文"(点击 → POST `/merge` 带 hint=`第 N 处冲突保留原文`)

- [ ] **Step 3: retry-bar.tsx**

- textarea("hint:告诉 LLM 上次哪里不对")
- 下拉:"用同策略" / 6 种策略选一(对应决策 7 的 B 辅助路径)
- 按钮"重新融合"

- [ ] **Step 4: detail-view.tsx 整合 + 复制 / 下载按钮**

```
顶部:返回列表 / 删除(discard)/ 复制 merged_prompt / 下载 .md
中间:LLM 选的策略 + llm_explanation 总结(取 attempts.at(-1).result)
主体:DiffRenderer
底部:RetryBar
```

attempts 历史:用一个折叠 panel 展示("展开历史 N 条 attempts") — 点开看每次 attempts 的 strategy / hint / 时间。

- [ ] **Step 5: tsc + 完整 dev server 视觉验证 + 提交**

---

### Task 11: 端到端手动测试

- [ ] **Step 1: 启动 dev server,完整跑 4 个场景**

1. **从实验台选 skill 全文融合**:Tab 1 选 F15 skill 整个,source_prompt 用一段简单 system prompt,验证 LLM 选了某种策略 + 输出合理
2. **从实验台选单条原则融合**:三级下钻到 F15 / Language strategy / Verbatim,验证抽取的文本正确
3. **自由 paste 自定义规则**:Tab 2,paste 任意规则,验证融合结果
4. **冲突场景**:source_prompt 故意写"始终输出英文",rule 选 F15 verbatim 中文保留,验证 conflicts 被 LLM 检测到 + 红色边框 + 回退按钮工作

- [ ] **Step 2: hint 重试场景**

跑完一个融合后,在 retry bar 里写 hint("用 wrap_reference 策略"),验证新 attempt 跑出来策略变化。

- [ ] **Step 3: 长 prompt 警示场景**

source_prompt 粘 12000 token 的文本,验证黄色警示出现,但仍允许提交。

- [ ] **Step 4: 列表页 + 详情页 + 历史 attempt 切换全验证**

- [ ] **Step 5: 提交收尾**

```bash
git add -A
git commit -m "feat(fusion): manual E2E verification passed"
```

---

## Done criteria

- [ ] 4 个手动场景全部跑通
- [ ] tsc 0 errors
- [ ] dev server 启动无 console error
- [ ] PM(巧克力)亲自上手验收 1-2 个融合场景
