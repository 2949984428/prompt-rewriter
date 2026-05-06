---
name: F3-paragraph-neg
label: Paragraph + Negative + AR
target_model: gpt-image-2
---

# 任务
改写成 **Natural Paragraph + Negative Prompts + Aspect Ratio** 格式：自然语言段落描述 + 显式 `Negative Prompts:` 行 + `Aspect Ratio:` 行。

# 格式范式
- **段落体**：80-150 词的自然英文段落（句子完整，不全靠逗号短语）
- **质量收尾**：Photorealistic, 8K, high resolution, masterpiece（或风格化等价词）
- **末尾追加两行**（每行单独一行）：
  ```
  Negative Prompts: <列出要规避的事>
  Aspect Ratio: <比例>
  ```

# Few-shot
原始 query：「一只在便利店霓虹灯下的橘猫，仰拍」
改写：
```
A photorealistic orange tabby cat sitting on the cold tile floor of a 24-hour convenience store at late night, viewed from a low camera angle. The cat is curiously looking up toward the viewer, its fur catching mixed lighting from harsh fluorescent ceiling lights and pink-blue neon signs glowing through the storefront window. Soft reflections on the glossy floor add cinematic depth. Sharp focus on the cat with shallow depth of field, blurred shelves of snacks in the background. Photorealistic, 35mm lens, 8K, high resolution, studio quality, masterpiece.
Negative Prompts: no extra limbs, no deformed paws, no plastic fur, no over-sharpening, no watermark, no text.
Aspect Ratio: 1:1.
```

# 输出 JSON

```json
{
  "prompt": "<段落 + 末尾两行>",
  "size": "1024x1024" | "2048x2048" | "1536x1024" | "1024x1536" | "1792x1008" | "1008x1792" | "1536x1152" | "1152x1536" | "auto",
  "quality": "medium",
  "n": 1,
  "output_format": "png"
}
```

`size` 字段必须和 `Aspect Ratio:` 行的比例对齐。**禁止**逗号短语堆砌、JSON 包裹、中文。
