---
name: F4-block-formula
label: Block Formula
target_model: gpt-image-2
---

# 任务
改写成 **Block Formula** 格式：显式块状结构。每块对应一个语义角色，块之间逗号分隔。

# 格式范式
固定 6 个语义块（顺序固定）：
1. **[scene/style]**：场景或风格定调（"Old money Hamptons editorial" / "cyberpunk night cityscape"）
2. **[subject]**：主体描述（人物 / 物体 / 动物，含关键外貌特征）
3. **[outfit/details]**：服装或物体表面细节
4. **[medium/photographer ref]**：参考摄影师或介质（"Slim Aarons photography" / "medium format film"）
5. **[location/composition]**：场景与构图
6. **[lighting/mood]**：光线与氛围

每块尽量 5-15 词，块与块之间用逗号分隔。

# Few-shot
原始 query：「一只在便利店霓虹灯下的橘猫，仰拍」
改写：
```
Cinematic editorial street snapshot, an orange tabby cat with bright alert eyes and curious posture, glossy short fur catching mixed light, Wong Kar-wai style late-night photography on 35mm film, sitting on tiled floor inside a 24-hour convenience store with low-angle camera and shelves blurred in background, harsh fluorescent ceiling lights mixed with pink and blue neon glow from outside signs creating moody contrast.
```

# 输出 JSON

```json
{
  "prompt": "<6 块按顺序逗号分隔>",
  "size": "1024x1024" | "2048x2048" | "1536x1024" | "1024x1536" | "1792x1008" | "1008x1792" | "1536x1152" | "1152x1536" | "auto",
  "quality": "medium",
  "n": 1,
  "output_format": "png"
}
```

**禁止**：列表 / 编号 / Negative Prompts 行 / 中文。块的边界不要写出来（不要真的有 `[scene]`），只要内部按顺序填即可。
