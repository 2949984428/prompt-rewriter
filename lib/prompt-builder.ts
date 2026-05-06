// prompt-rewriter/lib/prompt-builder.ts
//
// 两阶段 prompt 构造:
//   阶段 1 buildAnalysisSystem / buildAnalysisUser → 做 5 步分析
//   阶段 2 buildComposeSystem   / buildComposeUser   → 按 model profile 合 final_prompt
//
// 拆分动机:单次 tool call 要让 LLM 先想完 5 步再合 prompt,产出 token 多、耗时长,
// 且 final_prompt 永远卡在 schema 最后才开始流。拆开后:
//   - 第 1 阶段只产分析,system 里强调"不要直接产 final_prompt";
//   - 第 2 阶段把分析结果作为上下文注入 user,system 聚焦 model profile 的 prompt
//     写法规则,LLM 注意力只在合成上。
//
// skill.md / hard_rules / hints 只在第 1 阶段参与;model profile 两阶段都要,但
// 第 2 阶段作为"主规范"、第 1 阶段作为"终点预告"。

import type { AnalysisResult, HardRule, VerticalHint } from "./schema";
import { ANALYSIS_TOOL_NAME, FINAL_PROMPT_TOOL_NAME } from "./tool-schema";

// ── 阶段 1:分析 ────────────────────────────────────────────
export function buildAnalysisSystem(args: {
  skillMd: string;
  modelProfileMd: string;
  targetModel: string;
  enabledRules: HardRule[];
  hints: VerticalHint[];
}) {
  const { skillMd, modelProfileMd, targetModel, enabledRules, hints } = args;

  const rulesBlock = enabledRules.length
    ? enabledRules
        .map(
          (r) =>
            `- [${r.id}] ${r.title}\n  触发：${r.trigger_hint || r.trigger_keywords.join(" / ") || "见关键字"}\n  规则：${r.rule}`
        )
        .join("\n")
    : "（当前无启用的硬约束）";

  const hintsBlock = hints.length
    ? hints.map((h) => `- [${h.id}] match=${h.match}\n  hint=${h.hint}`).join("\n")
    : "（当前无垂类 hint，请完全靠 meta_seeds + 训练知识发挥）";

  // 第 1 阶段给 model profile "预览":让 LLM 知道最终要产的是哪种模型的 prompt,
  // 这样分析的 domain_thinking / buffers 才有方向。但明确告诉它"本次不要产 final_prompt"。
  const modelProfilePreview = modelProfileMd.trim()
    ? modelProfileMd
    : `(未找到 target_model="${targetModel}" 的 profile)`;

  return `${skillMd}

# 目标模型 profile 预览（target_model=${targetModel}，供本阶段 domain_thinking / buffers 判断方向；本阶段不要产 final_prompt）
${modelProfilePreview}

# 当前已启用的硬约束（apply_hard_rules 阶段必须逐条检查命中并显式注入说明）
${rulesBlock}

# 可选垂类 hints（如果你的分类与某条 match 描述吻合，请在 domain_thinking 中以 trigger="vertical_hint:<id>" 显式响应）
${hintsBlock}

# 输出方式
直接调用工具 \`${ANALYSIS_TOOL_NAME}\` 一次,把前 5 步(classify / extract / domain_thinking / applied_hard_rules / buffers)作为结构化参数提交。
**本阶段禁止产出 final_prompt**,那是下一阶段的工作。
工具的参数 schema 已在接口层强约束,你不需要(也不应该)再输出任何自然语言文本或 JSON。

# 填参注意(严格遵守,避免结构错误)
❌ 严禁把数组字段写成一段 JSON 字符串,例如:
   { "extract": "[{\\"field\\": \\"n\\", ...}]" }            ← 错,这是字符串
   { "applied_hard_rules": "[{\\"rule_id\\": ...}]" }        ← 错,这是字符串
✅ 必须填真正的 JSON array:
   { "extract": [ { "field": "n", "value": "4", "from": "user_query" }, ... ] }
   { "applied_hard_rules": [ { "rule_id": "...", "hit": true, ... }, ... ] }

classify 必须是 object,extract / domain_thinking / applied_hard_rules / buffers 必须是 array。`;
}

export function buildAnalysisUser(query: string) {
  return `用户原始 query:

"""
${query}
"""

请按上面的工作流产出前 5 步(不含 final_prompt),通过调用 \`${ANALYSIS_TOOL_NAME}\` 工具一次性提交。`;
}

// ── 阶段 2:合成 final_prompt ───────────────────────────────
export function buildComposeSystem(args: {
  modelProfileMd: string;
  targetModel: string;
}) {
  const { modelProfileMd, targetModel } = args;

  const profileBlock = modelProfileMd.trim()
    ? modelProfileMd
    : `(未找到 target_model="${targetModel}" 的 profile,请按通用最佳实践合成)`;

  return `你是一位专精 **${targetModel}** 的 prompt 合成专家。

# 职责
根据上一阶段已完成的分析(分类 / 抽取参数 / 域思考 / 命中的硬约束 / 选中的 buffer),
按照下面的目标模型 prompt 写法规范,合成**直接可调用 ${targetModel} 生图 API 的一组参数**。

# 目标模型 profile（final_prompt 的**生成规范**,严格遵守）
${profileBlock}

# 合成原则
- **不要机械拼接**上一阶段的产物。prompt 字段必须是完整、自然、可执行的一段文本,
  字段顺序 / 语气 / 结构严格按上面的 profile 规范组织。
- **extract 里的每一条** user_query / ai_inferred / gap 都应体现在 prompt 中,
  不能静默丢失(即便精简表达也要保留语义)。
- **applied_hard_rules.hit=true 的注入**必须原样出现在 injection_location 指定的位置。
- **buffers.picked=true 的 phrases** 自然融入,不要堆砌或机械罗列。
- picked=false 的 buffer / hit=false 的 rule **禁止使用**。

# final_prompt 结构:直接对齐 gpt-image-2 原生请求体

你产出的 final_prompt 对象会被**原样展开**塞进 gpt-image-2 的 text-to-image 接口 body,
所以字段名、取值范围严格按下面来,不要发明字段:

1. **prompt** (string, 必填)
   完整一段自然语言 prompt,一整段,不拆结构、不换行编号(除非是描述画面本身需要)。
   这就是真正要发给模型的文本,推导链路不用再重复标注(analysis 阶段已经展示)。

2. **size** (enum, 必填)
   gpt-image-2 合法像素(全部 16 倍数,3:1~1:3 区间内,≤ 8.3MP):
   - \`1024x1024\` → 1:1 默认正方形
   - \`2048x2048\` → 1:1 高清(用户说"高清/主视觉/2K/精修")
   - \`1536x1024\` → 3:2 横(标准横构图 / 编辑大片)
   - \`1024x1536\` → 2:3 竖(海报 / 小红书)
   - \`1792x1008\` → 16:9 横(视频封面 / 桌面壁纸)
   - \`1008x1792\` → 9:16 竖(手机壁纸 / Stories / Reels / 抖音)
   - \`1536x1152\` → 4:3 横
   - \`1152x1536\` → 3:4 竖(Pinterest / 杂志页)
   - \`auto\` → 模型自选(不确定时兜底)
   从 extract / 用户原文中判断画面比例,然后映射到上面这九个值之一。
   优先精确比例匹配(16:9 → \`1792x1008\`),其次方向兜底(横 → \`1536x1024\`,竖 → \`1024x1536\`)。

3. **quality** (enum, 必填)
   - \`low\` / \`medium\` / \`high\` / \`auto\`。默认 \`medium\`。
   - 用户说"超清 / 高质量 / 极致细节" → \`high\`。
   - 用户说"快速出个稿 / 草图" → \`low\`。

4. **n** (number, 必填)
   生图张数。用户说"给我 N 张 / N 格九宫格"就填 N,未说就填 1。

5. **output_format** (enum, 必填)
   - \`png\` (默认,支持透明) / \`jpeg\` / \`webp\`。
   - 用户要透明背景 → \`png\`。

# 输出方式
直接调用工具 \`${FINAL_PROMPT_TOOL_NAME}\` 一次提交,参数 schema 已经约束好。不要输出任何自然语言解释。

# 填参注意(严格遵守,避免结构错误)
❌ 严禁把 final_prompt 整个对象写成一段 JSON 字符串:
   { "final_prompt": "{\\"prompt\\": \\"...\\", \\"size\\": \\"...\\"}" }  ← 错
✅ 必须按 schema 填结构化对象:
   { "final_prompt": { "prompt": "...", "size": "1024x1536", "quality": "high", "n": 1, "output_format": "png" } }

prompt 字段内部如果需要引号,请**只使用直引号** \`"\` 并用 \`\\"\` 转义,或直接换成中文弯引号 \`"..."\` ——
千万不要在 prompt 字符串里写未转义的 ASCII 双引号,那会直接破坏外层 JSON。`;
}

/**
 * 把 AnalysisResult 转成"祈使指令清单"喂给 compose 阶段 LLM。
 *
 * 动机(见 PM 第二层审计):
 *   原始 JSON 虽然 LLM 能看到,但信号弱——它要自己挑哪些 buffer 该用、哪条 rule 要注入,
 *   容易漏掉关键字段。现在我们在 prompt 层就做好筛选 & 分类,按"必须保留 / 必须注入 /
 *   可调整 / 禁用"四种语气分段,每段起句用动词,让 Claude 对齐意图。
 */
export function buildComposeUser(args: {
  query: string;
  analysis: AnalysisResult;
}) {
  const { query, analysis } = args;

  const verticalPath =
    analysis.classify?.vertical_path
      ?.map((lv) => lv.label)
      .filter(Boolean)
      .join(" → ") || "(未知)";

  // ── 1. 抽取分组 ────────────────────────────────────────
  const byUserQuery = (analysis.extract ?? []).filter((x) => x.from === "user_query");
  const byAiInferred = (analysis.extract ?? []).filter((x) => x.from === "ai_inferred");
  const byGap = (analysis.extract ?? []).filter((x) => x.from === "gap");

  const fmtExtract = (items: typeof byUserQuery) =>
    items.length
      ? items.map((x) => `- ${x.field}: ${x.value}`).join("\n")
      : "  (无)";

  // ── 2. 硬约束:只列 hit=true 的,按 injection_location 分组 ────
  const hitRules = (analysis.applied_hard_rules ?? []).filter((r) => r.hit);
  const skippedRules = (analysis.applied_hard_rules ?? []).filter((r) => !r.hit);

  const fmtHitRule = (r: (typeof hitRules)[number]) =>
    `- [${r.rule_id}] ${r.injection_location ?? "tail"} 位置 → ${r.injection || "(未指定注入)"}`;

  const hitRulesBlock = hitRules.length
    ? hitRules.map(fmtHitRule).join("\n")
    : "  (无 hit=true 的硬约束,无需注入)";

  // ── 3. buffer:只列 picked=true,给出短语 ───────────────
  const pickedBuffers = (analysis.buffers ?? []).filter((b) => b.picked);
  const droppedBuffers = (analysis.buffers ?? []).filter((b) => !b.picked);

  const fmtPickedBuffer = (b: (typeof pickedBuffers)[number]) =>
    `- [${b.label}] → ${(b.phrases ?? []).join(", ") || "(未给出 phrases,请按 label 语义自然融入)"}`;

  const pickedBuffersBlock = pickedBuffers.length
    ? pickedBuffers.map(fmtPickedBuffer).join("\n")
    : "  (无 picked=true 的 buffer,按 model profile 自行发挥)";

  // ── 4. 域思考:只列 produces_phrases 非空的 ─────────────
  const domainPhrases = (analysis.domain_thinking ?? []).flatMap(
    (d) => d.produces_phrases ?? []
  );

  const domainBlock = domainPhrases.length
    ? `- ${[...new Set(domainPhrases)].join("\n- ")}`
    : "  (域思考阶段未产出 produces_phrases)";

  // ── 5. 禁用清单 ────────────────────────────────────────
  const forbidden: string[] = [];
  droppedBuffers.forEach((b) => forbidden.push(`- [buffer] ${b.label}`));
  skippedRules.forEach((r) => forbidden.push(`- [rule] ${r.rule_id}(未命中,不要注入)`));
  const forbiddenBlock = forbidden.length ? forbidden.join("\n") : "  (无)";

  return `用户原始 query:

"""
${query}
"""

# 你已决策的事实(请严格贯彻到 final_prompt)

## 垂类路径
${verticalPath}

## 必须保留的参数(来自用户原文,不得丢失、不得改义)
${fmtExtract(byUserQuery)}

## AI 推断的参数(可按 model profile 的写法规则调整顺序 / 语气)
${fmtExtract(byAiInferred)}

## 缺口参数(用户未指定,你可以按 profile 补齐,需合理不夸大)
${fmtExtract(byGap)}

## 必须注入的硬约束(原样嵌入,按位置)
${hitRulesBlock}

## 上场的 buffer 短语(picked=true,自然融入,勿堆砌)
${pickedBuffersBlock}

## 域思考产出的短语(domain_thinking.produces_phrases,可用于画面描述)
${domainBlock}

## 禁用(不要用 / 不要注入)
${forbiddenBlock}

---

# 任务
按上面的"事实清单"+ model profile 的写法规范,一次性填好 final_prompt 的 5 个字段:

- **prompt**:可直接投喂给目标模型的一段完整自然语言 prompt。不要编号拆段(除非画面本身要求),
  一整段自然流畅的描述,把上面所有必须保留 / 必须注入 / 上场 buffer / 域思考短语全部自然融入。

- **size**:从画面比例 → 映射到 9 个枚举之一(详见上文 §size 章节);未说兜底 \`auto\`。

- **quality**:从用户意图判断 → \`low\` / \`medium\` / \`high\` / \`auto\`,默认 \`medium\`。

- **n**:用户说 N 张就填 N,未说填 1。

- **output_format**:\`png\` / \`jpeg\` / \`webp\`,默认 png(需要透明背景也用 png)。

调用 \`${FINAL_PROMPT_TOOL_NAME}\` 一次提交。禁止输出自然语言解释。`;
}

