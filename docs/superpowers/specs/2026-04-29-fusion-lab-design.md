# 融合台 (Fusion Lab) — 设计 Spec

**日期**:2026-04-29
**项目负责人**:巧克力(PM)
**状态**:Spec ready,等 plan 评审

---

## 一、需求概述

prompt-rewriter 的第 4 个实验台,**把任意"线上 production prompt"和任意"实验台已验证规则"融合成一个新 prompt**。融合策略由 LLM 推荐 + PM 可换;改动 + 冲突可视化标记;支持 hint 重试 + 历史持久化。

## 二、需求背景

PM 在批测台跑出 winner skill / 单条规则后,想把这条规则**应用到线上正在用的 prompt** 上。当前路径:
1. PM 手动复制规则文 → 在编辑器里粘到线上 prompt 里 → 自己判断"放哪、怎么放"
2. 经常**判错位置**(放错段落),或**没识别冲突**(新规则跟老规则矛盾,上线后炸)
3. PM 不熟悉的规则(如 F15 的 Direction over specification)很难自己判断"该插哪、改哪"

→ 需要一个 **LLM 辅助的融合工具**,把"位置判断 + 冲突识别 + 措辞嵌合"自动化。

## 三、需求目标

| 目标 | 验收 |
|---|---|
| **降低 PM 应用实验规则的门槛** | 从"手动判位 + 复制粘贴"变成"选规则 + 一键融合 + 审 diff" |
| **冲突可见、可控** | 融合后的 prompt 里所有冲突点 100% 标红,PM 能逐处决策 |
| **跟实验台数据闭环** | 实验台所有 skill / section / 单条原则可直接选作融合源 |
| **MVP 单一职责** | 不做现场验证(走 batch lab 现有路径),只做"融合 + 复制 / 下载 + 历史" |

## 四、12 个核心决策(brainstorm 后锁定)

| # | 决策点 | 选择 |
|---|---|---|
| 1 | 入口 | 独立第 4 个实验台「融合台」 |
| 2 | 规则来源 | 双轨(实验台下拉 + 自由 paste) |
| 3 | 融合策略决定权 | LLM 推荐 + PM 可下拉换 |
| 4 | 冲突处理 | 先融合 + 标红 + PM 后审 |
| 5 | 实验台规则粒度 | 三级下钻(skill → section → 单条原则) |
| 6 | 结果呈现 | 单栏融合后 + 改动标记 + 点击展开解释 |
| 7 | 不满意时迭代 | 给 hint 重试为主 + 换策略快捷为辅 |
| 8 | 持久化 | 自动落历史 + 复制 / 下载 |
| 9 | LLM 模型 | 默认 Claude 4.6 + 前端可切 |
| 10 | 现场验证 | 不做(MVP),走 batch lab |
| 11 | 冲突点交互 | 默认接受 + 单按钮"回退该处"(走 hint 重试) |
| 12 | 长 prompt 处理 | 软提醒(token 估算 + 阶梯警示),不堵 |

## 五、需求详情

### 5.1 6 种融合策略(LLM 必选其一)

| 策略 ID | 中文 | 何时用 | 例 |
|---|---|---|---|
| `append` | 追加在末尾 | 规则跟现有 prompt 没语义重叠,纯追加 | "另:输出前自检 5 项..." 加在文末 |
| `insert_nearby` | 就近插入 | prompt 里有语义相近的 section,在其后插 | 规则讲"verbatim 文字",插到现有"文字处理"段后 |
| `replace_section` | 替换冲突段 | 老 prompt 有跟新规则矛盾的段落,直接 swap | 老 prompt 说"全英文输出",新规则说"verbatim 中文保留",swap 整段 |
| `wrap_reference` | 包裹引用 | 规则太长,在 prompt 头加一句"另遵守 X 规则,定义见末尾" + 末尾 append 全文 | 长 skill 全文融合 |
| `rewrite_embed` | 改写嵌入 | 现有段落里隐含跟新规则相关的内容,改写成体现新规则 | 老 prompt"用清晰描述",改写成"留权:'exact ... is yours'" |
| `few_shot` | 加 few-shot | 规则适合用示例展示,在 prompt 末加 1-2 个示例 | F15 的"Direction over specification"加示例对照 |

LLM 默认自选,PM 可下拉强制指定。

### 5.2 规则粒度(决策 5 三级下钻)

PM 下拉选实验台规则时:
1. **第 1 级** - 选 skill(F1-F16 / universal)→ 取整个 .md 文件作为规则
2. **第 2 级** - 选 skill 后再选 section(skill 的二级标题,如 F15 的 "Language strategy")→ 取该 section 文本
3. **第 3 级** - 选 section 后再选单条原则(section 内的具体编号项,如 "Direction over specification")→ 取该原则文本 + 1 个 few-shot

跨级允许:PM 可以选完 skill 直接点"用整个 skill",不必下钻;也可以下钻到原则级。

### 5.3 数据 Schema(放 `lib/schema.ts`)

```typescript
export const FusionMergeStrategySchema = z.enum([
  "append", "insert_nearby", "replace_section",
  "wrap_reference", "rewrite_embed", "few_shot",
]);

export const FusionRuleSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("lab"),
    skill_id: z.string(),
    granularity: z.enum(["skill", "section", "principle"]),
    section_anchor: z.string().optional(),  // section 标题 or 原则 id
    extracted_text: z.string(),             // 实际抽出来的规则文本(冗余存便于复盘)
  }),
  z.object({
    kind: z.literal("custom"),
    text: z.string(),                       // PM 自由 paste
  }),
]);

export const FusionConflictSchema = z.object({
  id: z.string(),
  region_start: z.number(),                 // char offset in merged_prompt
  region_end: z.number(),
  original_text: z.string(),                // 原 prompt 对应段
  new_rule_text: z.string(),                // 新规则相关内容
  resolution: z.enum(["new", "old"]).default("new"),  // PM 默认接受 new,可点回退切 old
});

export const FusionChangeMarkerSchema = z.object({
  id: z.string(),
  type: z.enum(["addition", "modification", "replacement"]),
  region_start: z.number(),
  region_end: z.number(),
  strategy: FusionMergeStrategySchema,
  reason: z.string(),                       // LLM 给的"为什么这么改"
  original_text: z.string().optional(),     // type ≠ addition 时,被替换的原文
});

export const FusionMergeResultSchema = z.object({
  merged_prompt: z.string(),
  strategy: FusionMergeStrategySchema,
  changes: z.array(FusionChangeMarkerSchema),
  conflicts: z.array(FusionConflictSchema),
  llm_explanation: z.string(),              // 自然语言总结
  ms: z.number(),
  raw: z.string(),                          // 原始 LLM 输出(调试用)
});

export const FusionAttemptSchema = z.object({
  timestamp: z.string(),
  strategy_request: FusionMergeStrategySchema.optional(),  // PM 强制 / null = LLM 自选
  hint: z.string().default(""),                            // PM 重试时给的 hint
  result: FusionMergeResultSchema.nullable(),              // null = LLM 调用失败
  error: z.string().nullable().default(null),
});

export const FusionRunRecordSchema = z.object({
  id: z.string().min(1),
  created_at: z.string(),
  name: z.string().default(""),
  source_prompt: z.string(),
  rule: FusionRuleSourceSchema,
  rewrite_llm: z.string().default(""),
  attempts: z.array(FusionAttemptSchema),                  // 历次融合,最新一次 = attempts.at(-1)
  status: z.enum(["draft", "merging", "ready", "discarded"]),
});
```

### 5.4 LLM 输出协议(工具调用)

工具名:`emit_fusion_result`

```typescript
{
  merged_prompt: string,                    // 融合后的 prompt 全文
  strategy: enum,                           // 6 种之一
  changes: [{ id, type, region_start, region_end, strategy, reason, original_text? }],
  conflicts: [{ id, region_start, region_end, original_text, new_rule_text }],
  llm_explanation: string                   // 1-3 段 PM 看的总结
}
```

system prompt 教 LLM:
1. 如果 STRATEGY_REQUEST 非空,必须用该策略;否则自选
2. 如果 HINT 非空,先满足 HINT 的要求
3. 区分 changes 和 conflicts:
   - **changes** = 所有改动(普通插入 / 替换 / 改写都算)
   - **conflicts** = 改动中**新规则跟老规则语义矛盾**的子集(同一个 region 也会出现在 changes 里;通过 region 重叠识别)
4. region_start / end 用 char offset(基于 merged_prompt 文本),不是行号

### 5.5 持久化路径

```
data/labs/fusion/runs/<id>.json     ← 一 run 一文件,含完整 attempts 历史
data/history-index.json             ← 中央索引(已有,加 fusion 类型 ref)
```

每次 LLM 融合(初始 + 重试)都 append 一条 attempt 到 attempts 数组,**不覆盖**。这样 PM 可以回退到任何一次历史融合。

### 5.6 状态机

```
FusionRunRecord.status:
  draft → merging → ready → (PM 可手动 → discarded)

attempt-level:
  null result(LLM 失败)→ error 字段记录,不阻塞下一次重试
```

### 5.7 UI 线框(单页面 3 区)

```
┌──────────────────────────────────────────────────────────────┐
│ 融合台 [返回列表]              LLM: [Claude 4.6 ▼]            │
├──────────────────────────────────────────────────────────────┤
│ 输入区(创建时显示;ready 后折叠)                               │
│                                                              │
│ ◉ 线上 prompt (paste)                                         │
│ [textarea 大框,占 50% 高;右下角:估算 6420 tokens 🟡]        │
│                                                              │
│ ◉ 要融合的规则                                                │
│ [Tab 1: 从实验台选] [Tab 2: 自由 paste]                       │
│   Tab 1: skill [F15 ▼] section [Language strategy ▼]         │
│          原则 [Input-language layer ▼]  「不选下钻则用上一级」  │
│          预览框: 显示抽出的规则文本                            │
│   Tab 2: [textarea 中等框]                                    │
│                                                              │
│ ◉ 融合策略 (可选)                                              │
│ [○ 让 LLM 自己选] [○ append] [○ insert_nearby] ...           │
│                                                              │
│              [开始融合]                                       │
├──────────────────────────────────────────────────────────────┤
│ 结果区(ready 后显示)                                          │
│                                                              │
│ LLM 选择: insert_nearby                                       │
│ 总结: 这次融合在第 3 段后插入了规则文本,因为该段原本讨论...    │
│                                                              │
│ ┌─ 融合后 prompt(可点击展开改动)─────────────────────────┐    │
│ │ You are a helpful assistant...                       │    │
│ │ ...                                                   │    │
│ │ [+ insert_nearby] Here is an additional rule: ...    │  ← 点击展开 panel:
│ │   ...                                                 │     · 用了什么策略
│ │ [⚠ conflict] The system shall always output English  │     · 原文是什么(若 type ≠ addition)
│ │   ...                                                 │     · 为什么这么改
│ │                                                       │     · [回退该处] 按钮(仅 conflict 显示)
│ │                                                       │
│ └────────────────────────────────────────────────────┘    │
│                                                              │
│ [复制] [下载 .md] [给 hint 重试 ▼] [换策略 ▼] [丢弃]          │
└──────────────────────────────────────────────────────────────┘
```

改动标记的视觉规则:
- 蓝色边框 `[+ <strategy>]` = addition 类型
- 黄色边框 `[~ <strategy>]` = modification 类型
- 紫色边框 `[⇄ <strategy>]` = replacement 类型
- **红色边框 `[⚠ conflict]`** = 出现在 conflicts 数组中(优先级最高,即使同时是某种 change 类型,也用红色)

### 5.8 长 prompt 警示阶梯(决策 12)

| Token 估算 | 视觉 | 行为 |
|---|---|---|
| ≤ 8000 | 灰色文字"~XXXX tokens" | 正常 |
| 8000 - 16000 | 黄色 + ⚠ "较长,可能影响融合质量,建议精简" | 仍可提交 |
| 16000 - 32000 | 红色 + ⚠ "接近 LLM 上限,融合可能失败" | 仍可提交,但提示风险 |
| > 32000 | 红色 + 🚫 "超过安全阈,LLM 大概率失败" | 仍可提交(决策 12 不堵),但红色强警 |

Token 估算公式(简单版):中文 char × 1 + ASCII char × 0.25(粗略对齐 Claude tokenizer)。

### 5.9 失败处理

| 场景 | 行为 |
|---|---|
| LLM 调用失败 / 超时 | attempt.error 记录,attempt.result=null;UI 显示"融合失败:<原信>",PM 可重试 |
| LLM 输出 JSON 不合规 | 同上,attempt.error="LLM 返回 schema 不合法" + raw 保留供调试 |
| LLM 给的 region offsets 越界 | 前端宽容:超出 merged_prompt 长度的 marker 直接跳过(不渲染),不阻塞展示 |

## 六、不做的事(MVP 范围外)

| 不做 | 为什么 / 何时做 |
|---|---|
| 现场跑测试验证 | 决策 10:走 batch lab 现有路径,v2 再考虑加"一键转 batch" |
| 多 LLM 投票融合 | 决策 9 排除;v2 评估 |
| side-by-side diff 视图 | 决策 6 走 D 单栏;有 PM 反馈再加 |
| 局部 cherry-pick 编辑 | 决策 11 走 E 单按钮回退;手动编辑走外部编辑器 |
| 长 prompt 自动分段 | 决策 12 排除;真有需求 v2 用 RAG |

## 七、竞品分析

| 工具 | 策略 | 我方差异 |
|---|---|---|
| GitHub Copilot 的 "merge suggestion" | 代码 merge,LLM 辅助 | 我方做的是 prompt 融合,domain 不同;但 UX 思想类似(LLM 给方案 + 人审) |
| LangSmith Hub Prompt Editor | 版本管理 + diff | 没有 LLM 辅助融合;我方核心增量在"LLM 推荐策略 + 冲突识别" |
| ChatGPT Custom Instructions 的"重写" | LLM 改写整个 prompt | 黑盒,看不到改了哪里;我方有结构化 changes / conflicts 标注 |

## 八、未来规划

- **v1**(本期):本 spec 全部范围
- **v1.5**:从 batch lab 排行榜一键跳转融合台,预填规则(决策 1 提到的 deferred 入口)
- **v2**:一键转 batch lab 测试融合后的 prompt(决策 10 的 deferred 验证)
- **v2.5**:支持"批量融合"——把同一条规则融合到 N 个 prompt 上(运营场景:全公司 prompt 库的统一升级)

## 九、配套交付物

- **代码**:`prompt-rewriter/` 内 schema / store / runner / API / components 全套(详见 plan)
- **本 spec**:`docs/superpowers/specs/2026-04-29-fusion-lab-design.md`(本文件) + obsidian 镜像 `Lovart 需求设计/需求/Prompt 改写器 Demo/融合台.md`
- **实施 plan**:`docs/superpowers/plans/2026-04-29-fusion-lab.md`
