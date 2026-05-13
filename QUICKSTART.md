# QUICKSTART —— 3 步开箱即用

> 给同事的快速上手指引。完整文档见 `README.md` 和 `CLAUDE.md`。

## 1. 解压 + 安装依赖

```bash
unzip prompt-rewriter-handoff-2026-05-12.zip
cd prompt-rewriter
npm install
```

**关于工作目录路径：**

- 项目工作目录路径**不要带冒号 `:`**（macOS 上 Finder 显示成 `/`，但实际上是 `:`）。npm 在某些场景会解析 PATH 异常。
- 不过本项目的 `package.json` scripts 已经全部改成 `node ./node_modules/.bin/<bin>` 显式调用（不是裸 `next dev`），所以**实际上放任何路径都能跑**。如果你看到 README/CLAUDE.md 里强调"不要还原成裸 `next dev`"就是这个原因。

## 2. 配置环境变量

```bash
cp .env.example .env.local
```

打开 `.env.local`，填三个 key：

| 变量 | 说明 |
| --- | --- |
| `LLM_BASE_URL` | 公司内网 LLM 网关地址 |
| `LLM_API_KEY` | LLM 网关 API key |
| `IMAGE_GATEWAY_BASE_URL` | 公司内网图像生成网关地址 |

**注意：** 这三个 endpoint 走的是**公司内网网关**，需要 **VPN 或 Clash bypass** 才能访问。如果在公司外网跑会一直 timeout / connection refused，先确认网络通了再来 debug。

## 3. 启动 + 验证

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)，按下面流程验证端到端通：

1. 进左侧导航 **「业务工具 → Pipeline 三步」**
2. 选 **T1 预设 case**（页面会有预置 case 下拉）
3. 点跑改写，等候三步流水线（分类 → 改写 → 图片）输出
4. 看到 final prompt + 出图 → 端到端通

---

## 现场改 SP / 策略库

右上角 **⚙ 设置** → 配置抽屉。可以现场改：

- `data/labs/pipeline/sps/classification.md` / `rewrite.md`（System Prompt）
- `data/labs/pipeline/strategies/platform-tone.json` / `vertical-standard.json`（策略库）
- `data/skills/` 下的 skill 文件
- `data/hard_rules.json` / `data/vertical_hints.json`

**改完抽屉里 debounce 自动保存，无需重启 `npm run dev`。** 下次 LLM 调用就生效。

---

## 文档索引

- `README.md` —— 项目概览 + 验收清单
- `CLAUDE.md` —— 给 Claude Code 的工作上下文，里面有详细的"已知技术细节"和"prompt 策略演进"
- `docs/` —— 设计文档和 SP 历史版本

如果跑不起来，先看 `CLAUDE.md` 的"已知技术细节"段。
