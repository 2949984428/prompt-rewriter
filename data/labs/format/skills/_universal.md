# 通用写作纪律(所有格式共用)

无论目标格式是逗号长串、JSON、字段表还是中文任务式,在改写时都必须遵守以下 5 条规则。这些规则来自 OpenAI Cookbook + fal.ai 五槽框架 + 社区共识,与具体格式正交 —— **格式决定排版,纪律决定不丢要素 / 不矛盾扩写**。

## 规则 1 · 守恒(Conservation)
query 里的**主体 / 修饰词 / 数字 / 专名 / 引号文本 / 视角 / 比例**,在最终 prompt 中必须能找到对应表达。同义可,丢弃不可。极简产出(F7 / reductive 工种)允许凝练为不丢失语义的上位词,**不允许直接砍**。

## 规则 2 · 原文锚定(Verbatim)
query 中的**引号内容 / 【...】 / 品牌名 / 数字 / @# 符号 / 中日韩文字面文本**逐字落入 prompt,**不翻译、不改写**。即使最终产出是英文,verbatim 字符也保留原始字符集。

## 规则 3 · 不矛盾(No Contradiction)
扩写补默认时,新增内容必须与 query 兼容、与已填字段不互斥。常见互斥对:

- 白天 / 阳光 ↔ 霓虹 / 月光 / 夜景
- 柔光 / 漫射 / 雾 ↔ 高对比 / 戏剧光 / 硬阴影
- 极简 / 留白 / 单色 ↔ 繁复 / 装饰 / 多色彩堆砌
- 矢量 logo / 平面 ↔ 写实毛发 / 胶片颗粒
- 鸟瞰 / 俯拍 ↔ 仰拍 / 低角度
- 黑白 / 单色 ↔ rich / vivid color palette

## 规则 4 · 用例锚定(Use-Case Anchoring)
最终 prompt 必须显式或隐式表达**产物类型**(logo / editorial photo / UI mockup / product shot / packaging / infographic / cinematic still 等)。这是 gpt-image-2 切换"渲染模式"和"打磨度"的最强信号。

- 字段格式(F5 / F6 / F9 / F10):走 `Use case` 或 `Asset type` 字段
- 段落格式(F1 / F2 / F3 / F8):产物类型词放在第一句,例如 "Editorial photo of..." / "Logo design for..."
- 极简(F7):用核心介质名词承载,例如 "胶片"/"logo"/"icon"

如果 query 没说产物类型,从语境推断并显式落地。

## 规则 5 · 反空话词、反凑长度(No Stuffer / No Padding)
**禁用 stuffer 词**:`8K` / `4K` / `ultra-detailed` / `masterpiece` / `professional` / `high quality` / `best quality` / `cinematic`(单独当作品质词时禁用,作为风格说明可保留)。OpenAI 官方明确反对 —— 不传达任何视觉决策,只是廉价信号。

**唯一例外**:`photorealistic` 是 gpt-image-2 写实模式触发词,实证有效,可保留。

**字数是上限不是配额**:F1 (200-400 词)、F7 (10-30 字)等格式给的字数区间是上限。query 信息少时允许偏短、允许字段空着,**不要瞎补**品种 / 年龄 / 城市 / 季节这类 query 没说的事。

---

# 输出前自检
- [ ] query 显式要素全部能在最终 prompt 找到(规则 1)
- [ ] verbatim 字符逐字保留(规则 2)
- [ ] 没有互斥(规则 3)
- [ ] 产物类型已表达(规则 4)
- [ ] 没堆 8K / masterpiece 等空词(规则 5)

任一项不过 → 静默重写一次,**不要在输出里解释自检过程**。
