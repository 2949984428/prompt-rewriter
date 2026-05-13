# Prompt 改写器 Demo

把粗糙的图像 query，改写得像专业的人在说。每一步判断都看得见。

## 启动

```bash
cd prompt-rewriter
npm install
cp .env.example .env.local   # 然后填 SILICONFLOW_API_KEY / GEMINI_API_KEY
npm run dev
```
打开 http://localhost:3000

## 演示路径（给小光 / 方权）

1. 左侧粘一段 query，例如「跨境电商促销海报，16:9，艺术字堆叠，主体压字」
2. 点 [跑改写]，等 5–15 秒
3. 看 6 段卡片：分类瀑布 / 参数表 / 思考流 / 命中规则 / buffers / 最终 prompt
4. ⑥ 切「带溯源」视图，hover 任一短语看来源
5. 点右上 [⚙ 设置] 改 `skill.md` 或开关硬约束 → 立刻再跑一次看差异

## 修改可读写规则

- `data/skill.md` —— 元启发 / 工作流（也可在抽屉里改）
- `data/hard_rules.json` —— 全局硬约束（带启用开关）
- `data/vertical_hints.json` —— 可选垂类 hint，起步空数组

## 关联设计

- 主 spec：`../docs/superpowers/specs/2026-04-26-prompt-rewriter-demo-design.md`
- UI 规范：`../docs/superpowers/specs/2026-04-26-prompt-rewriter-demo-ui-design.md`
- 实施计划：`../docs/superpowers/plans/2026-04-26-prompt-rewriter-demo.md`

## 验收清单（demo 完成标准）

- [ ] 输入区粘 query → 点 [跑改写] → 5–15 秒内出现 6 段卡片
- [ ] ① 分类瀑布显示 ≥ 2 层垂类，每层信心分 + ⓘ 弹判断依据
- [ ] ② 参数表显示字段 / 值 / 来源 chip（缺失项米黄高亮）
- [ ] ③ 思考流每条标 trigger，produces 短语以 Coral chip 出现
- [ ] ④ 命中清单，已启用规则逐条显示 ✅/⚪
- [ ] ⑤ buffers 挑选，每条带理由
- [ ] ⑥ 双视图切换正常，「带溯源」高亮 5 种 origin 色，hover 弹来源
- [ ] [复制] 按钮可复制 final_prompt.prompt 到剪贴板
- [ ] 抽屉里改 skill.md / 关掉某条 hard_rule → 再跑同 query 输出立刻变化
- [ ] 历史 tab 列出最近改写，[载回] 可还原 query + 输出

## 已知技术细节

- 路径含冒号（`/Users/mac/Downloads/2026:01:04Requirement Analysis/`）使 npm PATH 解析异常，因此 `package.json` 的 scripts 都改成了 `node ./node_modules/.bin/<bin>` 显式调用，不影响功能
- 实际栈：Next.js 16 / React 19 / Tailwind CSS v4 / shadcn 4.5（base-ui，非 radix-ui）/ Jotai / Zod v4
- 主题色板与字号定义在 `app/globals.css` 末尾的 `@theme` block 内（追加在 shadcn 默认 token 之后），同时在 `:root` 把 shadcn 关键 token 重映射到 Anthropic 暖色，所以 shadcn 组件视觉也走暖色
