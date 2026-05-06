---
name: F6-json-spec
label: JSON Spec
target_model: gpt-image-2
---

# 任务
改写成 **JSON Spec** 格式：让 LLM 输出一个嵌套 JSON 描述图像（在 `prompt` 字段值里直接是合法 JSON 字符串）。这种格式有助于一致性场景（facial / palette / lighting consistency）。

# 格式范式
JSON 内含以下 key（按需填，可省略空值）：
```json
{
  "subject": { "type": "...", "description": "...", "pose": "...", "expression": "..." },
  "scene": { "location": "...", "time_of_day": "...", "ambience": "..." },
  "lighting": { "primary": "...", "secondary": "...", "mood": "..." },
  "color_grading": { "palette": [...], "tone": "...", "contrast": "..." },
  "composition": { "shot_type": "...", "angle": "...", "lens": "..." },
  "style": { "medium": "...", "reference": "...", "texture": "..." },
  "constraints": ["..."],
  "negative": ["..."]
}
```

# Few-shot
原始 query：「一只在便利店霓虹灯下的橘猫，仰拍」
改写：（注意 `prompt` 字段的值是一个 JSON 字符串）
```json
{
  "prompt": "{\"subject\":{\"type\":\"orange tabby cat\",\"description\":\"glossy short fur, bright alert green eyes, curious posture\",\"pose\":\"sitting upright on tile floor, front paws together\",\"expression\":\"curious looking up at camera\"},\"scene\":{\"location\":\"24-hour Asian convenience store interior\",\"time_of_day\":\"late night\",\"ambience\":\"intimate, slightly mysterious\"},\"lighting\":{\"primary\":\"harsh overhead fluorescent\",\"secondary\":\"pink and blue neon spill from storefront window\",\"mood\":\"high contrast, moody\"},\"color_grading\":{\"palette\":[\"cool fluorescent white\",\"warm orange fur\",\"pink neon\",\"blue neon\"],\"tone\":\"film-like\",\"contrast\":\"high\"},\"composition\":{\"shot_type\":\"close-up\",\"angle\":\"low-angle from cat eye level\",\"lens\":\"35mm prime\"},\"style\":{\"medium\":\"35mm film photography\",\"reference\":\"Wong Kar-wai late-night cinematography\",\"texture\":\"authentic film grain\"},\"constraints\":[\"keep cat as sole focal point\",\"no humans in frame\"],\"negative\":[\"plastic fur\",\"deformed paws\",\"over-sharpening\",\"watermark\"]}",
  "size": "1024x1024",
  "quality": "medium",
  "n": 1,
  "output_format": "png"
}
```

# 输出
直接输出上面那种顶层 JSON。注意：
- `prompt` 字段的**值是一个 JSON 字符串**（要把内层 JSON 序列化成 string，**双引号转义为 `\"`**）
- 顶层 JSON 仍含 `prompt / size / quality / n / output_format` 五个字段

**禁止**：在 `prompt` 字段直接放 JSON 对象（必须是字符串）；输出多个顶层 JSON。
