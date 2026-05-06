# Prompt Rewriter

把粗糙的图像生成 query，改写成专业的、可控的、可对比的 prompt — 而且每一步判断都看得见。

> Take a rough image-generation query and rewrite it into a professional, controllable, comparable prompt — with every reasoning step visible.

## 这是什么

一个面向 PM / 设计师 / Prompt 工程师的 prompt 改写工作台。三个独立但共底层的实验台：

| 实验台 | 用途 |
|---|---|
| **垂类（rewrite）** | 单 query 走 7 步推理（分类 / 字段抽取 / 思考 / 命中规则 / buffers / final prompt），每条产出都带溯源 |
| **格式（format）** | 1 个 query × N 个 skill 横评，看不同 prompt 写法的产出差异 |
| **批量（batch）** | N 个 query × M 个 skill 矩阵 + PM 评分 + 排行榜，做 skill 调优 |

核心思想：**改写策略是数据，不是代码**。所有 skill / hard rule / hint 都落在 `data/labs/format/skills/*.md`，通过抽屉编辑即时生效，不用重启。

## 启动

```bash
npm install
cp .env.example .env.local   # 填你的 LLM_API_KEY 等
npm run dev                  # http://localhost:3000
```

需要：

- Node.js 18+
- 一个 OpenAI 兼容的 LLM 网关（OpenAI / OpenRouter / vLLM / Ollama 都行）
- 可选：OpenAI Images（gpt-image-2）兼容的生图网关
- 可选：Cloudflare R2（批量实验台导出 CSV 时把图片转公网 URL 才需要）

## 演示路径

1. 左侧粘一段 query，例如「跨境电商促销海报，16:9，艺术字堆叠，主体压字」
2. 点 [跑改写]，等 5–15 秒
3. 看 6 段卡片：分类瀑布 / 参数表 / 思考流 / 命中规则 / buffers / 最终 prompt
4. ⑥ 切「带溯源」视图，hover 任一短语看来源
5. 点右上 [⚙ 设置] 改 `skill.md` 或开关硬约束 → 立刻再跑一次看差异

## 修改可读写规则

- `data/skills/skill.md` — 元启发 / 工作流（也可以在抽屉里改）
- `data/skills/hard_rules.json` — 全局硬约束（带启用开关）
- `data/skills/vertical_hints.json` — 可选垂类 hint
- `data/labs/format/skills/F*.md` — 格式实验台用的 skill 集，每个文件一种写法

## 技术栈

- **Next.js 16.2 / React 19** — App Router
- **Tailwind CSS v4** — CSS-first 主题（`app/globals.css` 末尾的 `@theme` block）
- **shadcn 4.5 over `@base-ui/react`**（不是 radix-ui）
- **Jotai 2** — 状态；每个实验台一个独立 atoms 文件
- **Zod v4** — 所有 server I/O 边界都 schema 校验
- **OpenAI SDK** — 走 OpenAI-compatible 接口

## 数据落盘

```
data/
├── skills/                 ← 全局 skill / 硬规则 / hint
├── llm-models.json         ← 可选模型清单
├── model_profiles/         ← 模型档案
└── labs/
    ├── rewrite/runs/       ← 垂类实验台运行记录（gitignore）
    ├── format/runs/        ← 格式实验台运行记录（gitignore）
    ├── format/skills/      ← 格式实验台的 skill 文件
    ├── batch/runs/         ← 批量实验台运行记录（gitignore）
    └── fusion/runs/        ← fusion 实验台运行记录（gitignore）
```

历史走"中央索引 + 分布式详情"：`data/history-index.json` 含轻量字段，详情按 lab 各自存。

## 已知限制

- **没有测试套件** — 改完手动测 dev server + `tsc --noEmit`
- **图像 quality 全局硬锁 `medium`** — 在 `lib/format-runner.ts` 的 `lockedFp` 和 `app/api/rewrite/route.ts` 各覆盖一次。改成可调要同时改这两处服务端覆盖点
- **F11-direct-api skill 特殊** — 走完整 LLM 路径，但 server 端把 `final_prompt.prompt` 强制覆盖回原 query，作为 baseline "不改写"对照组

## License

MIT — see `LICENSE`.
