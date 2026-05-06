---
name: midjourney-v7
version: 0.0.1-placeholder
source: (待补充官方或社区最佳实践)
---

# 目标模型 profile — Midjourney v7 (placeholder)

> 这是占位模板，展示"换模型就换 profile"的工作方式。实际使用前请补充真实规则。

## 1. Prompt 结构（示例，非权威）

```
<subject, dense English nouns> <scene / style phrases> <camera / lighting> <art references> --ar <ratio> --style <raw|expressive> --stylize <N> --chaos <N> --v 7
```

Midjourney 更吃**密集英文名词堆叠 + 参数 flag**，不吃 Labeled Spec 式冒号结构。

## 2. 需要覆盖的关键参数

- `--ar <W:H>` 显式锁比例（与 ratio_lock 硬约束联动）
- `--v 7` 固定版本
- `--style` / `--stylize` / `--chaos` 按风格强度给建议值
- 风格参考（如 `in the style of <artist/movie/period>`）避免真实在世艺术家名

## 3. 扩写纪律（示例）

- 主体描述需堆叠 3-6 个英文形容词，粗略 query 允许补，具体 query 不补
- 不输出 Labeled Spec 冒号结构
- 文案类需求不适合 Midjourney（其文字渲染差），domain_thinking 需显式提醒

> TODO: 接入真实 Midjourney v7 prompt guide 后替换本文件。Midjourney 的 API 字段与 gpt-image-2 不同(需要在此 profile 里说明完整的 final_prompt 结构:prompt 字段是要发给 MJ 的 /imagine 文本,可能还有 `--ar` / `--q` / `--stylize` 等参数拆成独立字段)。
