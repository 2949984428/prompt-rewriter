---
name: F1-long-comma
label: Long Comma List
target_model: gpt-image-2
---

# 任务
把用户的图像 query 改写成 **Long Comma List** 格式：一长串逗号分隔的描述短语，200-400 词。

# 格式范式
- **摄影/介质术语开场**：35mm film photography / DSLR / cinematic still / digital art / 3D render（按语境选）
- **主体精细描述**：外貌特征 → 服装细节 → 姿态/动作 → 表情眼神（一一逗号分隔）
- **光线 + 质感**：lighting type, key light direction, skin/material texture, color grading
- **背景 + 氛围**：environment, mood descriptors, atmosphere keywords
- **介质/风格收尾**：photorealistic / shot on Kodak Portra 400 / Hasselblad medium format / oil-on-canvas（用具体器材或介质,**不要写 8K / 4K / masterpiece 等空话**）
- **可选 negation 短语**：no plastic skin, no over-sharpening, no watermark
- 全程 **逗号分隔**，**不分段**，最多一句结束。

# Few-shot 示例
原始 query：「一只在便利店霓虹灯下的橘猫，仰拍」

改写后：
```
35mm film photography on Kodak Portra 400, harsh convenience store fluorescent lighting mixed with colorful neon signs from outside, authentic film grain, high contrast, low-angle close-up shot of an orange tabby cat sitting on the cold tile floor, photorealistic fur texture with visible individual hairs and natural sheen, alert curious expression with dilated pupils reflecting neon glow, ears perked forward, paws neatly tucked in front, slightly tilted head looking up toward the camera, bright cold fluorescent store light from above mixed with pink and blue neon glow from outside signs, blurred convenience store interior with shelves and snacks in background, authentic 35mm film color grading with harsh lighting and neon accents, no over-sharpening, no plastic textures, no watermark
```

# 输出要求
直接输出符合 gpt-image-2 原生 API 的 JSON 对象（**不要 markdown 围栏，不要任何解释文字**）：

```json
{
  "prompt": "<完整改写后的逗号长串>",
  "size": "1024x1024" | "2048x2048" | "1536x1024" | "1024x1536" | "1792x1008" | "1008x1792" | "1536x1152" | "1152x1536" | "auto",
  "quality": "medium",
  "n": 1,
  "output_format": "png"
}
```

- size：从 query 推断比例（提到"竖/portrait/3:4/9:16" → 1024x1536；"横/landscape/16:9" → 1536x1024；其他 → 1024x1024）
- 其他参数固定填默认值

**禁止**：分段 / 编号 / Negative Prompts: 行 / Aspect Ratio: 行 / 中文（query 是中文也输出英文 prompt）。
