// prompt-rewriter/lib/skill-rule-index.ts
//
// 把 data/labs/format/skills/*.md 扫出来,按"三级粒度"产出 rule index。
// 给融合台前端的下拉菜单消费。
//
// 抽取规则:
//   - level 1 (skill):整个 .md 文件
//   - level 2 (section):# 或 ## 标题 + 标题下到下一个同级标题前的所有内容
//   - level 3 (principle):section 内 numbered list / bullet 项,匹配 ^[-*\d.+\s]+\*\*([^*]+)\*\*
//     单条原则 + 后续 2 行作为 extracted_text
//
// 启发式不完美,但够用 — F15 / F16 / universal 等 skill 都用了 `- **xxx** —` 的 bullet 风格,
// 抽取命中率高。粒度选错时 PM 还能走自由 paste 那个 tab 兜底。

import { promises as fs } from "fs";
import path from "path";

const SKILLS_DIR = path.join(process.cwd(), "data", "labs", "format", "skills");

export type PrincipleNode = {
  id: string;           // 原则的简短 id(从首句 ** ** 内容派生)
  text: string;         // 原则原文 + 上下文
};

export type SectionNode = {
  anchor: string;       // section 标题(原文,作为下拉显示文本)
  text: string;         // section 全文(skill_id::section 唯一,可作为 extracted_text)
  principles: PrincipleNode[];
};

export type SkillRuleNode = {
  skill_id: string;
  skill_label: string;  // frontmatter 里的 label,fallback skill_id
  full_text: string;    // 整个 .md 文件内容,作为 skill 级 extracted_text
  sections: SectionNode[];
};

export async function buildSkillRuleIndex(): Promise<SkillRuleNode[]> {
  const files = await fs.readdir(SKILLS_DIR);
  const out: SkillRuleNode[] = [];

  // universal 单独 push 在前(更显眼)
  try {
    const u = await fs.readFile(path.join(SKILLS_DIR, "_universal.md"), "utf-8");
    out.push({
      skill_id: "_universal",
      skill_label: "通用规则 (universal)",
      full_text: u,
      sections: extractSections(u),
    });
  } catch {
    // _universal.md 缺失则跳过
  }

  // 其余 skill 按文件名排序
  const skillFiles = files
    .filter((f) => f.endsWith(".md") && !f.startsWith("_") && f !== "index.json")
    .sort();
  for (const f of skillFiles) {
    const content = await fs.readFile(path.join(SKILLS_DIR, f), "utf-8");
    const skill_id = f.replace(/\.md$/, "");
    out.push({
      skill_id,
      skill_label: extractSkillLabel(content) ?? skill_id,
      full_text: content,
      sections: extractSections(content),
    });
  }
  return out;
}

function extractSkillLabel(md: string): string | null {
  // frontmatter 里找 label
  const m = md.match(/^---[\s\S]*?label:\s*(.+?)\n[\s\S]*?---/);
  return m ? m[1].trim() : null;
}

function extractSections(md: string): SectionNode[] {
  // 按 # 或 ## 切分。一级标题(#) 单独成 section,二级标题(##) 也独立成 section。
  // ### 及以下不切(避免过细)。
  const lines = md.split("\n");
  const sections: SectionNode[] = [];
  let current: { anchor: string; lines: string[] } | null = null;
  let inFrontmatter = false;
  let frontmatterEnded = false;

  for (const line of lines) {
    // 跳过 frontmatter
    if (!frontmatterEnded) {
      if (line.trim() === "---") {
        if (!inFrontmatter) {
          inFrontmatter = true;
          continue;
        } else {
          frontmatterEnded = true;
          continue;
        }
      }
      if (inFrontmatter) continue;
    }

    const headerMatch = line.match(/^(#{1,2})\s+(.+)/);
    if (headerMatch) {
      if (current) {
        sections.push(buildSectionNode(current.anchor, current.lines));
      }
      current = { anchor: headerMatch[2].trim(), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) {
    sections.push(buildSectionNode(current.anchor, current.lines));
  }
  return sections;
}

function buildSectionNode(anchor: string, lines: string[]): SectionNode {
  const text = lines.join("\n").trim();
  return { anchor, text, principles: extractPrinciples(text) };
}

function extractPrinciples(sectionText: string): PrincipleNode[] {
  // 启发匹配:bullet / numbered list 项,首段是 **bold** 的视为一条原则
  // 例如:
  //   - **Conservation** — every explicit element...
  //   1. **Conservation**: ...
  //   * **Verbatim** — ...
  const lines = sectionText.split("\n");
  const principles: PrincipleNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^[\s]*[-*+]?\s*\d*\.?\s*\*\*([^*]+)\*\*/);
    if (m) {
      // 取该行 + 后续 2 行作为上下文
      const text = lines.slice(i, i + 3).join("\n").trim();
      const idBase = m[1].trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      // 防重复:加 index 后缀
      const id = `${idBase || "principle"}-${i}`;
      principles.push({ id, text });
    }
  }
  return principles;
}
