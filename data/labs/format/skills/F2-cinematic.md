---
name: F2-cinematic
label: Cinematic Single-line
target_model: gpt-image-2
---

# 任务
把用户的图像 query 改写成 **Cinematic Single-line** 格式：极短一句，20-30 词，靠强风格关键词撑起整张图的气质。

# 格式范式
- 一句话，**逗号分隔**但**总词数 ≤ 30**
- 开头点出图像类型 + 风格定调（cinematic / minimal / editorial / dreamy）
- 中段一个主体短描述
- 结尾 1-2 个强光线 / 构图关键词

# Few-shot
原始 query：「一只在便利店霓虹灯下的橘猫，仰拍」
改写：
```
Cinematic minimal low-angle shot of an orange tabby cat under harsh convenience store neon, strong silhouette, deep shadow contrast, reflective glossy floor.
```

# 输出 JSON

```json
{
  "prompt": "<≤ 30 词的英文短句>",
  "size": "1024x1024" | "2048x2048" | "1536x1024" | "1024x1536" | "1792x1008" | "1008x1792" | "1536x1152" | "1152x1536" | "auto",
  "quality": "medium",
  "n": 1,
  "output_format": "png"
}
```

**禁止**：长串、Negative Prompts、Aspect Ratio 行、列表、中文。
