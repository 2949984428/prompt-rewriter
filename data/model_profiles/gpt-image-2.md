---
name: gpt-image-2
version: 0.1.0
source: 内部 CodeX raster image gen skill / OpenAI gpt-image-2 best practices
---

# 目标模型 profile — gpt-image-2

**final_prompt 直接对齐 gpt-image-2 的 text-to-image 原生请求体。** 产出的对象会被原样展开塞进 API,所以字段名、合法值严格遵守:

```json
{
  "prompt": "完整自然语言 prompt 一整段",
  "size": "1024x1024" | "2048x2048" | "1536x1024" | "1024x1536" | "1792x1008" | "1008x1792" | "1536x1152" | "1152x1536" | "auto",
  "quality": "low" | "medium" | "high" | "auto",
  "n": 1,
  "output_format": "png" | "jpeg" | "webp"
}
```

> gpt-image-2 模型本身支持任意 16 倍数 + 3:1~1:3 + 总像素 0.65-8.3MP 的尺寸;此处为 demo 兼容性,固化为 8 个常见比例 + auto 共 9 个枚举。

`prompt` 字段的写法(下述 §1-§4)和参数字段的填法(下述 §5)分开考虑 —— prompt 是给模型看的自然语言,size/quality/n/output_format 是给 API 看的结构化参数。

前 5 步(classify / extract / domain_thinking / apply_hard_rules / buffers)产出的是**语义素材与约束**;合成阶段把它们**按下列结构重新生成**一段自然语言 prompt,而不是机械拼接。

## 1. Labeled Spec 输出结构（固定字段名，顺序固定）

```
Use case: <slug>
Asset type: <intended use>
Primary request: <core ask>
[Input images: <role annotation>]    # 仅 edit / compositing 场景
Scene/backdrop: <environment>
Subject: <main subject + appearance>
Style/medium: <photo | illustration | 3D | watercolor | ...>
Composition/framing: <wide | close | top-down; placement; lens if photo>
Lighting/mood: <lighting + mood>
Color palette: <palette>
Materials/textures: <surface>
Text (verbatim): "<exact text>"        # 有文案时必须
Constraints: <must keep / must preserve>
Avoid: <negative>
```

- 可空字段可省略整行，不要留空的 "Field: "。
- 字段内容使用英文短语（gpt-image-2 训练语料以英文为主），但 `Text (verbatim)` 字段必须保留 query 原文（中文/多语言都不翻译）。
- `Use case` 必须落在下面 16 个 slug 之一。

## 2. Use case taxonomy（closed set，classify level 1 必须对齐）

**Generate（无输入图）**

| slug | 含义 |
|---|---|
| `photorealistic-natural` | 写实人像 / 自然场景 / 生活摄影 |
| `product-mockup` | 商品图 / 电商主图 / 产品可视化 |
| `ui-mockup` | APP / Web / 系统界面草稿 |
| `infographic-diagram` | 信息图 / 图表 / 流程图 / 示意图 |
| `logo-brand` | Logo / 品牌视觉 / VI |
| `illustration-story` | 插画叙事 / 绘本 / 漫画分镜 |
| `stylized-concept` | 风格化概念图 / 海报 / 封面 |
| `historical-scene` | 历史场景 / 古代场景复原 |

**Edit（有输入图）**

| slug | 含义 |
|---|---|
| `text-localization` | 对图片中的文字进行翻译 / 替换 |
| `identity-preserve` | 保持人物同一性 / 换装 / 换场景 |
| `precise-object-edit` | 精确增删改单个物体 |
| `lighting-weather` | 改光照 / 天气 / 时段 |
| `background-extraction` | 抠图 / 替换背景 |
| `style-transfer` | 风格迁移 |
| `compositing` | 多图合成 / 拼贴 |
| `sketch-to-render` | 草图 / 线稿转成品 |

## 3. 扩写纪律（Augmentation discipline）

**核心原则**：只补 implied 的细节，绝不瞎加。

| query 具体度 | 允许补 | 禁止补 |
|---|---|---|
| 已具体（含主体/场景/风格/参数 ≥ 3 项） | 只做归一化，不增加设定 | 任何新增设定 |
| 粗略（主要是主题词） | composition / framing / polish level / practical layout | 未 implied 的角色/物体/品牌/slogan/palette |

违反即视为 final_prompt 失败，优先收窄到原 query 的语义。

## 4. 其他硬规则

- **结构顺序**（给模型易读）：scene → subject → details → constraints。即使字段顺序固定，字段内的语义展开也要从宏观到微观。
- **Text verbatim**：query 里明确带引号或标注"文案:"的内容，必须原文放进 `Text (verbatim): "..."`，不翻译、不改标点、不加粗。
- **难拼词**：对不常见品牌名或缩写，在 Text 字段附近逐字母拼出（如 `L-O-V-A-R-T`），帮助模型正确渲染。
- **Edit 模式必列 invariants**：edit 类任务 `Constraints` 字段必须写明"change only X; keep Y unchanged（identity / logo / layout / colors 任选相关项）"。每次迭代重复这些 invariants，防止模型漂移。
- **比例与尺寸**：比例信息放在 `Constraints` 字段末尾，并显式声明"strictly do not crop or adjust"（与 ratio_lock 硬约束协同）。

## 5. 反例（禁止出现）

- ❌ 直接把 extract 的字段名写进 prompt（`field=ratio, value=16:9`）
- ❌ 输出 JSON 或 YAML 包裹 labeled spec
- ❌ 把中文 Labeled Spec 字段名翻译成 "使用场景 / 资产类型"
- ❌ query 已经具体时还追加 "cinematic lighting / rich color palette / high detail" 这类万金油
- ❌ Edit 任务漏掉 "keep identity unchanged"

---

## 6. API 参数字段填法（size / quality / n / output_format）

**不要在 prompt 文本里重复描述"请按 3:4 比例高清输出"**——这些由 API 参数精确传入,重复写反而让模型困惑。

### size(必填)

从 extract 或用户原文判断画面比例,映射到 9 个值之一(优先精确比例匹配,其次方向兜底):

| 比例 | 常见用户说法 | size 值 | 适合 |
|---|---|---|---|
| 1:1 默认 | `1:1` / 朋友圈头像 / 一张方图 | `1024x1024` | 通用方图 |
| 1:1 高清 | `2K` / 高清 / 主视觉 / 商品大图 / 精修 | `2048x2048` | 商品主图、海报主视觉 |
| 3:2 横 | `3:2` / 标准横构图 / 编辑大片 / 杂志摄影 | `1536x1024` | 编辑摄影、杂志大片 |
| 2:3 竖 | `2:3` / 海报 / 小红书 / 杂志竖图 | `1024x1536` | 海报、小红书、品牌图 |
| 16:9 横 | `16:9` / 视频封面 / 桌面壁纸 / 横屏 banner / 电影感 | `1792x1008` | YouTube 封面、桌面壁纸 |
| 9:16 竖 | `9:16` / 手机壁纸 / Stories / Reels / 抖音 / TikTok | `1008x1792` | 手机壁纸、短视频封面 |
| 4:3 横 | `4:3` / 老画幅 / iPad | `1536x1152` | iPad 适配、复古影像 |
| 3:4 竖 | `3:4` / Pinterest / 杂志页 | `1152x1536` | Pinterest、杂志单页 |
| 兜底 | 用户完全没说 | `auto` | 模型自选 |

匹配优先级:先精确比例字符串(`16:9`/`9:16`/`4:3`/`3:4`/`3:2`/`2:3`/`1:1`)→ 再匹配语义关键词(手机壁纸 → `1008x1792`)→ 最后方向兜底(横 → `1536x1024`,竖 → `1024x1536`)。

### quality(必填)

- 默认 `medium`
- 用户说"高清 / 超清 / ultra / 极致画质 / 商业级" → `high`
- 用户说"草图 / 快速预览 / 看看感觉" → `low`
- 海报 / 封面 / 商品主图 / 商业插画 → 建议 `high`

### n(必填,1-10)

- 用户没说 → `1`
- 用户说"给我 4 张 / 4 张变体 / 4 version / 九宫格(这种写一张图分 9 格还是 `1`)" → 按意思填
- 注意:"九宫格海报"通常是**一张图**里有 9 个单元,应该填 `1`,不是 `9`

### output_format(必填)

- 默认 `png`
- 需要透明背景 / logo / 贴纸 → `png`
- 摄影写实 / 商品图 → `jpeg`(体积更小)
- 网页素材 → `webp`

### 反例

- ❌ `size: "3:4"` — 这是比例不是 size,应填 `1152x1536`
- ❌ `size: "portrait"` — 这是方向不是 size,应填 `1024x1536`(2:3 竖)或 `1008x1792`(9:16 竖)
- ❌ `size: "1080x720"` — 不是 16 倍数(720/16=45 ✓ 但不在枚举里),应填 `1792x1008` 或 `1536x1024`
- ❌ `quality: "ultra-hd"` — gpt-image-2 不认,应填 `high`
- ❌ `n: 9` 对应"九宫格海报(一张图分 9 格)" — 实际应填 `1`
- ❌ `output_format: "svg"` — 不支持
- ❌ 在 prompt 文本里写 "please render in 3:4 aspect ratio, high quality PNG" — 重复参数,让模型困惑

