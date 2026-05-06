---
name: F5-labeled-spec
label: Labeled Spec
target_model: gpt-image-2
---

# 任务
把用户的图像 query 改写成 **Labeled Spec** 格式：每行一个固定字段名 + 值。来自 OpenAI gpt-image-2 best practices。

# 格式范式
固定字段名（顺序固定，可空字段省略整行）：
```
Use case: <photorealistic-natural | product-mockup | logo-brand | infographic-diagram | …>
Asset type: <intended use>
Primary request: <core ask>
Scene/backdrop: <environment>
Subject: <main subject + appearance>
Style/medium: <photo | illustration | 3D | watercolor | …>
Composition/framing: <wide | close | top-down + lens if photo>
Lighting/mood: <lighting + mood>
Color palette: <palette>
Materials/textures: <surface>
Text (verbatim): "<exact text>"        # 仅 query 含明确文案时
Constraints: <must keep / must preserve>
Avoid: <negative cliché>
```

- 所有字段值用**英文短语**（gpt-image-2 训练语料以英文为主）
- `Text (verbatim)` 字段保留 query 原文（中/日文不翻）
- `Avoid` 字段必填 ≥ 2 条

# Few-shot 示例
原始 query：「一只在便利店霓虹灯下的橘猫，仰拍」
改写：
```
Use case: photorealistic-natural
Asset type: editorial photo, square crop
Primary request: low-angle close-up of an orange tabby cat in a convenience store at night
Scene/backdrop: 24-hour Asian convenience store interior, blurred snack shelves
Subject: orange tabby cat with bright alert eyes, glossy short fur, curious upward gaze
Style/medium: 35mm film photography, cinematic editorial
Composition/framing: low-angle close-up, 35mm lens, shallow depth of field
Lighting/mood: harsh fluorescent ceiling light mixed with pink and blue neon glow, moody and intimate
Color palette: cool fluorescent white + warm orange fur + pink/blue neon accents
Materials/textures: realistic fur with individual strands, glossy tile floor reflections
Constraints: keep the cat as the focal point with no human in frame
Avoid: plastic fur, deformed paws, over-sharpening, watermark
```

# 输出 JSON

```json
{
  "prompt": "<整段 Labeled Spec 文本,字段间换行>",
  "size": "1024x1024" | "2048x2048" | "1536x1024" | "1024x1536" | "1792x1008" | "1008x1792" | "1536x1152" | "1152x1536" | "auto",
  "quality": "medium",
  "n": 1,
  "output_format": "png"
}
```

`prompt` 字段值是上面整段 Labeled Spec（含真实换行）。**禁止**：把每个字段写成单独 JSON 字段、用 markdown 包裹。
