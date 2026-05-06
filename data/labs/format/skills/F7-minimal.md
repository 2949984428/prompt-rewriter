---
name: F7-minimal
label: 极简短句
target_model: gpt-image-2
---

# 任务
改写成 **极简短句** 格式：10-30 字（字符数，不是词数）的中文/英文/日文单句。靠强烈的风格名词激发模型。

# 格式范式
- 单句，10-30 字
- 不堆形容词，只放 2-3 个核心名词 + 1 个调性词
- 中文 query 输出中文短句；英文 query 输出英文；混语保留主语种

# Few-shot
- 原 query：「一只在便利店霓虹灯下的橘猫，仰拍」
  改写：`便利店深夜霓虹光下，橘猫仰望镜头，35mm 胶片`

- 原 query：「极简科幻 logo，一个抽象几何形状」
  改写：`极简科幻 logo，单一几何，黑底白线`

- 原 query：「Mountain range at sunset」
  改写：`Mountain range at golden hour, oil painting style`

# 输出 JSON

```json
{
  "prompt": "<10-30 字短句>",
  "size": "1024x1024" | "2048x2048" | "1536x1024" | "1024x1536" | "1792x1008" | "1008x1792" | "1536x1152" | "1152x1536" | "auto",
  "quality": "medium",
  "n": 1,
  "output_format": "png"
}
```

**禁止**：超过 30 字、加 Negative Prompts、加比例行、堆形容词。
