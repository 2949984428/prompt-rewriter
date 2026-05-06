// prompt-rewriter/lib/token-estimate.ts
//
// 粗略 token 估算(对齐 Claude tokenizer)。
// 中文 char × 1 + ASCII char × 0.25,误差 ±20%。
// 用于融合台输入侧的软提醒,不强求精确。

export function estimateTokens(text: string): number {
  let t = 0;
  for (const c of text) {
    const code = c.charCodeAt(0);
    // CJK 范围(粗略)
    if (code >= 0x4e00 && code <= 0x9fff) t += 1;          // CJK 统一汉字
    else if (code >= 0x3040 && code <= 0x309f) t += 1;     // 平假名
    else if (code >= 0x30a0 && code <= 0x30ff) t += 1;     // 片假名
    else if (code >= 0xac00 && code <= 0xd7af) t += 1;     // 韩文
    else if (code >= 0x0600 && code <= 0x06ff) t += 0.6;   // 阿拉伯文
    else t += 0.25;                                         // ASCII / Latin
  }
  return Math.round(t);
}

export type TokenWarnLevel = "ok" | "yellow" | "red" | "danger";

export function tokenWarnLevel(estimated: number): TokenWarnLevel {
  if (estimated > 32000) return "danger";
  if (estimated > 16000) return "red";
  if (estimated > 8000) return "yellow";
  return "ok";
}

export function tokenWarnMessage(level: TokenWarnLevel): string {
  switch (level) {
    case "ok":
      return "";
    case "yellow":
      return "较长,可能影响融合质量,建议先精简";
    case "red":
      return "接近 LLM 上限,融合可能失败";
    case "danger":
      return "超过安全阈,LLM 大概率失败,但仍可强行尝试";
  }
}
