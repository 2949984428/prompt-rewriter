# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **父目录** `../CLAUDE.md` 已经讲了双子项目对比、设计文档双份保存约定、Anthropic 暖色规范这些。本文件**只**写在 `prompt-rewriter/` 子目录工作时需要的具体细节。

## 启动 / 测试 / Lint

```bash
npm install                           # 第一次
npm run dev                           # http://localhost:3000
npm run build                         # 生产构建
npm run lint                          # eslint
node ./node_modules/.bin/tsc --noEmit # 类型检查(等价于 lint 之外的"build 是否通"检查)
```

**没有测试套件** —— 改完手动测 dev server + tsc 一遍即可。

## 路径含冒号陷阱

工作目录是 `/Users/mac/Downloads/2026:01:04Requirement Analysis/prompt-rewriter/`。冒号让 npm 的 PATH 解析炸掉,所以 `package.json` 的所有 scripts 都用 `node ./node_modules/.bin/<bin>` 显式调用,**不要还原成裸 `next dev`**。

## 实际栈

- **Next.js 16.2 / React 19** —— App Router,`runtime = "nodejs"` 在 server 路由头部声明
- **Tailwind CSS v4** —— **CSS-first** 主题,在 `app/globals.css` 末尾追加 `@theme { --color-* / --font-* / --shadow-* / --radius-* }`,**不要用 `tailwind.config.ts`**(v4 已弃用)
- **shadcn 4.5 over `@base-ui/react`** —— **不是 radix**:
  - `asChild={true}` → `render={<span/>}`
  - `delayDuration` → `delay`
  - Switch 的 selector 用 `data-checked:` 而非 `data-[state=checked]:`
- **Jotai 2** —— 状态;每个 lab 一个独立 atoms 文件(`atoms-format.ts` / `atoms-batch.ts`),**故意不复用**避免跨 lab 污染
- **Zod v4** —— 所有 server I/O 边界都 schema 校验;hot-path read 走 `safeParse` 一条条过,坏条目跳过(防一条老数据格式不兼容毁掉整个 lab)

## 几个实验台(独立但共底层)

| Lab | 入口 | 数据落盘 | 说明 |
|---|---|---|---|
| **垂类(rewrite)** | `components/output/*.tsx` | `data/labs/rewrite/runs/<id>.json` | 单 query 7 步推理 + A/B 出图,带溯源 |
| **格式(format)** | `components/labs/format/` | `data/labs/format/runs/<id>.json` | 1 query × N skill 横评 8-11 种 prompt 格式 |
| **批量(batch)** | `components/labs/batch/` | `data/labs/batch/runs/<id>.json` | N query × M skill 矩阵 + PM 评分 + 排行榜 |
| **融合(fusion)** | `components/labs/fusion/` | `data/labs/fusion/runs/<id>.json` | 多策略融合(实验形态,迭代中) |
| **Pipeline** | `components/labs/pipeline/` | 不落盘到 runs(端到端演示型,非横评) | 对齐线上 prompt-rewrite 链路:SP1 意图分类 → SP2 改写(垂类策略注入)→ 生图;**NDJSON 流式**(详见下文) |

侧栏额外有 Langfuse(只是 iframe 链接,不是 lab)。

**共用底层**:`lib/format-runner.ts`(skill 加载 + LLM 调用)、`lib/llm.ts`(LLM 网关)、`lib/image.ts` + `lib/image-job.ts` + `lib/image-store.ts`(生图 + 落盘 + 代理)、`lib/image-router.ts`(按 model 名分发到内部 IGW 或 Lovart Agent)。

**图像 quality 全局硬锁 `"medium"`**:不管 LLM 给 final_prompt 里填什么(包括 high),server 端在 `runFormatOne` 的 `lockedFp` 里覆盖为 medium;rewrite lab 的 `app/api/rewrite/route.ts` 也做同样覆盖。原因:成本可控 + 横评公平(跨 skill 对比时不让某条 skill 偷偷升档)。要放开只能改这两处服务端覆盖点,**前端切换器不是真相源**。

## Skill 文件系统

`data/labs/format/skills/` 下有 `F1-F11.md` + `_universal.md` + `index.json`:

- **`_universal.md`** —— 通用写作纪律(守恒 / 不矛盾 / 用例锚定),所有格式跑批前都被前置进 system prompt
- **`F11-direct-api.md`** 是**特殊**的(当前实现,已跟早期版本不同):
  - **走完整 LLM 路径**(跟 F10 共享同一套 size 推断)—— **不再是**早期的"早返回 + 启发式 SIZE_RULES"
  - 唯一区别:`lib/format-runner.ts` 在落盘前做 server-side safety,把 `final_prompt.prompt` 强制覆盖回 `query.trim()`(见 `lockedFp` 构造,`skill_id === "F11-direct-api"` 分支)
  - 为什么这么做:F11 作为 baseline"不改写 prompt",但 size 还是要按 query 推,这样跨 skill 对比时画幅公平
  - `F11-direct-api.md` 的内容**仍然生效**(影响 LLM 怎么推 size),改 size 启发式要改这个 .md 而**不是** `format-runner.ts`
- **`index.json`** 决定 UI 选 skill 时显示哪些。新加 skill 必须 `.md` + `index.json` 两边一起加,否则 UI 看不到

## 历史架构(path C)

不是单文件大 history.json,也不是 SQLite。是**中央索引 + 分布式详情**:

```
data/history-index.json                                   ← 各 lab 通用瘦索引
data/labs/<lab_id>/runs/<run_id>.json                     ← 详情各自存
```

- `history-index.json` 含 `id / lab_id / ts / query / summary / pm_score_avg / ref` 等轻量字段
- 详情文件按 lab schema 完整存(format → `FormatRunRecord`,batch → `BatchRunRecord`)
- 写历史走 `lib/history-write.ts:writeHistoryRunDebounced`(按 id debounce 300ms),**所有 lab 共用一个 endpoint** `PUT /api/history-runs/[id]`

## LLM 模型切换

`lib/llm.ts` 默认用 `bedrock/claude-sonnet-4-6`。前端有全局 `LlmModelSwitcher`,选中的 `llmModelAtom` 在 fetch body 透传 `llm_model`。可选模型在 `data/llm-models.json`(目前含 Claude 4.6 / Kimi K2.5 / Gemini 3 Flash / Gemini 2.5 Pro&Flash / GPT-4o / GPT-4o-mini / Doubao Seed 2.0 Pro,共 8 个)。

**Pipeline lab 例外**:支持 per-step LLM 覆盖。`pipelineSearchModelAtom`(默认 `gemini/gemini-3-flash-preview`)/ `pipelineReviewModelAtom`(默认 `doubao/seed-2-0-pro-260215`)/ `pipelineImageModelAtom`(空 → 后端 fallback `gpt-image-2`)。POST body 多 `llm_model_search / llm_model_review / image_model` 三个字段,server 端 fallback 链:per-step > 全局 `llm_model` > server hardcoded。响应中 `step{1,2,3}.llm_model / image_model` 回显实际跑的模型,UI 状态栏 chip 显示。

LLM gateway 是**Lovart 内部** OpenAI-compat:`http://llm-gateway-go.svc.pre.lovart.cloud/v1`(env 配)。

## Batch lab 关键细节

- **跑批** 用 SSE 推 cell patch:`/api/labs/batch/runs/[id]/stream` server 推,detail-view 客户端接
- **并发** 默认 16(`start` route 的 `concurrency` 参数 `min(1).max(16).default(16)`),通过 `lib/batch-store.ts` 的 `Semaphore` 控流
- **写盘** 走 `lib/batch-store.ts` per-id mutex(用 `globalThis` 跨请求共享,绕开 Next dev hot-reload 重置 module 顶层 state)
- **Cell 重试** `/cells/retry` 不进 semaphore,用 `markRunning(lockKey)` 防同 cell 并发;若 `record.status === "finished"` 必须先 `patchRecord({ status: "running" })` 再 `patchCell`,否则前端 SSE 已断开不会重订阅,看不到重试实时刷新
- **派生 queries** (`/api/labs/batch/derive-queries`)有 LLM schema drift 问题:大 N(>20) + 高字数要求时 LLM 可能把 `queries` 数组序列化成字符串。前端已有"stale-id flag pattern + 动态超时 + 取消按钮" UX 兜底(`components/labs/batch/create-form.tsx` 的 `deriveReqIdRef`),后端 schema 容错仍 TODO
- **Manual 自填模式** UI 是**列表式独立 textarea**(每条一个输入框 + 序号 + 删除按钮,顶部 `+ 添加`),**不是** `\n` 拆分的大 textarea。原因:复杂 prompt 含真实换行会被错拆
- **导出**有 5 路:HTML / ZIP / 数据 CSV(本机 URL 或 R2 URL)/ 盲评包(匿名 ZIP) / 飞书文档(spawn `lark-cli`)
- **盲评流程**:`lib/export/anon-mapping.ts` 的 djb2 hash 给 `(run_id, query_idx, skill_id)` 算稳定位置签;接收方 .json 用同算法反向映射回 skill_id 写到 `record.external_picks`

## Pipeline lab 关键细节

跟其他 lab 形态不同 —— **不是横评工具,是对齐线上 prompt-rewrite 链路的端到端测试台**。

2026-05-12 完成平台化改造(Runner / Registry / Harness 三件套),现在 Pipeline lab 是「**Runner 驱动 + 多版本策略 Registry + ExperimentRecord 落盘**」三层组合。下面按层讲。

### 5 段数据流(改造后:`lib/pipeline/` 抽象 + Runner 编排)

`app/api/labs/pipeline/route.ts` POST 不再 inline 五段,只负责 build initialCtx → `runPipeline(pipelineDefinition, initialCtx, send)` → 落 ExperimentRecord。5 段拆到 `lib/pipeline/steps/` 下各一个文件:

```
query → stepSearchIntent   (lib/pipeline/steps/step-search-intent.ts)
      → stepStrategyPack   (lib/pipeline/steps/step-strategy-pack.ts)
      → stepCreationPlanner(lib/pipeline/steps/step-creation-planner.ts)  ← mock,线上是真 agent
      → stepMediaReview    (lib/pipeline/steps/step-media-review.ts)
      → stepGenerateMedia  (lib/pipeline/steps/step-generate-media.ts)    ← 调 runImageWithRetry × N 并发
```

- **runner**:`lib/pipeline/runner.ts:runPipeline()` 顺序跑 step,浅合并 ctx patch,自动收集 trace。**不做 deep merge / parallelism / cancellation** —— 这些都是有意省掉,别加
- **ctx 形状**:`lib/pipeline/steps/types.ts:PipelineCtx`。**每个 step 只写自己负责的那个顶层字段**(SP1 写 `ctx.step1`,SP2 写 `ctx.step2`),互不重叠
- **retry 声明**:`step.retry = { maxAttempts, backoffMs }` 是模块声明合并(在 `runner.ts` 用 `declare module "./types"` 给 Step 加 `retry?` 字段)。SP1 / SP2 配 3 次 + `[1s, 2s, 3s]`,**Step 3 (生图)绝不配 step 级 retry** —— `runImageWithRetry` 内部已有 10×fib,叠了变成 10×3=30 次无意义
- **failed step 不 abort 整条 pipeline** —— SP1 失败时 SP2 仍能 fallback 用空 intent 拿默认策略包跑(行为跟改造前一致)。retry 用完后业务错误写到 emit data.error,trace 里这条 status=ok(吞了 throw),**想让 trace.failed 计入业务失败要去掉 step 外层 try/catch,但会丢前端 error 卡片**

### 多版本 Registry(2026-05-12 平台化产物)

策略 / SP 全部多版本化,**单一数据源 = `data/labs/pipeline/{strategies,sps}/<namespace>/`** 目录:

```
data/labs/pipeline/strategies/<ns>/_index.json         ← { active, versions[] }
data/labs/pipeline/strategies/<ns>/v1.json             ← 单个版本内容
data/labs/pipeline/sps/<ns>/_index.json
data/labs/pipeline/sps/<ns>/v1.md
data/labs/pipeline/_legacy/                            ← 迁移前的旧单文件备份,3 个月观察期后再删
```

4 个 namespace(`lib/strategies/registry.ts` 的 `Namespace` type):
- `vertical-standard` / `platform-tone`(策略类,JSON)
- `sp-classification` / `sp-rewrite`(SP 类,markdown)

`lib/strategies/registry.ts` 是 namespace-agnostic 的 8 个 API(`resolve / list / read / write / publish / activate / remove / patchMeta`),3 个 pipeline step 通过 `resolve(ns)` 拿 active 版本内容。**每次跑批 fs.readFile,无缓存** —— 抽屉改完立刻生效是核心 UX 红线,**不要加内存缓存**。

**atomic write**:所有写盘走 `tmp + fs.rename()`(POSIX 原子语义),防 server crash 时 `_index.json` 半写入。`registry.ts:atomicWriteFile`。

**加新 namespace 4 步流程**(扩展 hook):
1. `data/labs/pipeline/strategies/<新 ns>/v1.json` + `_index.json`(用 `scripts/migrate-strategies-to-versioned.mjs` 同款形态手写)
2. `registry.ts` 的 `Namespace` type + `NS_CONFIG` 各加一行
3. SP2 模板加 `{{LOVART_ACTIVE_<新 ns>_*}}` 占位符,`step-media-review.ts` 的 `spTemplate.replaceAll()` 多走两轮
4. 抽屉加一个新 tab(复用 `VersionedEditor` 组件,只换 namespace 名)

**绝对不要去改 registry 代码** —— `NS_CONFIG` 表驱动设计就是为了不动 registry。

### `{{LOVART_ACTIVE_*}}` 占位符注入

SP2 文末有 6 个占位符(命名严格走现网 `vertical/platform`,**不是** plan 早期版本的 `L1/L2`):`VERTICAL / VERTICAL_LABEL / VERTICAL_BULLETS / PLATFORM / PLATFORM_LABEL / PLATFORM_BULLETS`。`step-media-review.ts` 用 `spTemplate.replaceAll()` 6 次把策略包 bullets 直接注入到 SP **system 末尾的 `# Active Blocks` 段**(不在 user 段)。user content 只有 `## Recent conversation` / `## Original prompts` / `## Search Intent`,**不带策略 bullets**。改占位符位置 = 改 SP system 渲染顺序,不影响 placeholder 名字。

### NDJSON 流式(不是 SSE,跟 batch 区别)

POST `/api/labs/pipeline` 返回 `Content-Type: application/x-ndjson`,**一行一条 phase 事件**。phases:`start / step1 / strategy_pack / creation_planner / step2 / step3_start / step3_item_progress / step3_item / step3_done / experiment_saved / done / fatal`(`experiment_saved` 和 `experiment_save_failed` 是 P3a 加的,前端不消费也无害)。前端 `getReader()` + `TextDecoder({stream:true})` + `split("\n")` + 逐行 `JSON.parse`,reducer (`handleStreamPhase`) 增量更新 `result: Partial<PipelineResponse>`。

**Phase 2 字段增量**(向后兼容,前端不消费也不破):
- `step1` / `step2` data 多 `sp_version: string`(当前跑批用的 SP 版本 id)
- `strategy_pack` data 多 `versions: { vertical, platform }`
- `done` data 多 `trace: TraceEntry[]` + `strategy_versions: Record<string, string>`

Step 3 用 `Promise.all(reviewed.map(async ...))`,每张图各自 promise 内调 `send`,**谁先出图谁先到前端**。

### Step 3 重试范式(跟 Batch 对齐)

`lib/pipeline-image-runner.ts:runImageWithRetry()` 被 POST 跑批 + `POST /api/labs/pipeline/retry-image`(单格手动重试)共用:
- MAX_ATTEMPTS=10,fibonacci backoff `[1,2,3,5,8,13,20,30,45]s`(跟 `batch-runner.ts` 同款)
- 每次 attempt 推 `step3_item_progress`(含 attempt 计数 + 上次错)
- 全部用完推 `step3_item` 终态 failed

**手动 retry mailbox 模式**(`pipelineStreamMailboxAtom`):`GenerationCard` fetch 流后,把每条 phase 写到 mailbox(带自增 `_seq`),`PipelineLab` 用 `useEffect([mailbox?._seq])` 转交给同一份 `handleStreamPhase` reducer —— **手动 retry 和首轮跑批共享同一份 state 增量逻辑**。

### ExperimentRecord 落盘(2026-05-12 平台化产物)

每次 POST 跑批跑完,在 done phase 之前自动落一份 `data/experiments/exp_<uuid>.json`,**同时写入 `data/history-index.json`**(lab_id=`"labs.pipeline.experiment"`,瘦索引)。

`lib/experiments/store.ts` 4 个 API:`writeExperimentRecord / readExperimentRecord / listExperimentRecords / patchExperimentRecord`。前两者走 per-id mutex(防 lost update),`writeIndex` 走全局 mutex(防并发跑批丢条目)。mutex 用 `globalThis` 跨 Next.js dev hot-reload 共享。

**record schema** 在 `lib/schema.ts:ExperimentRecordSchema`(L498+),关键设计:
- `inputs.passthrough()` —— 未来加 pipeline 时新字段不破历史
- `metadata.default({...})` + `tags.default([])` —— 新增字段时旧 record 不报错
- `output.step3.generations: z.array(z.any())` —— 接 NDJSON 终态原样存,各 step 形态演进时不用改 schema
- **PATCH 只允许改 `tags / metadata`**,其他字段 store + api route 双重 immutable

**列表查询走 `history-index.json`(filter lab_id) → ms 级**,**不扫文件**。 500+ 条以后也撑得住,不需要单独建 index 文件。

**给主对话的隐性 TODO**:`generation[].image_urls[0]` 当前是 image gateway 返回的远程链接(如 `https://assets-persist.lovart.ai/agent_images/...`),**没走 `lib/image-store.ts:saveImageBytes()` 本地化**。`assets-persist` 看名字像 persistent storage 但无 SLA;真要 long-term 回放可靠,需在 `pipeline-image-runner.ts:tryGenerateOnce` 拿到 urls 后 fetch + 本地化后 emit 本地路径。短期不修(改 emit url 会影响前端缩略图缓存),**登记在这,3 个月后没出问题再决定**。

### 配置抽屉(顶栏 ⚙ 设置 · lab-aware)

`components/labs/pipeline/drawer/pipeline-drawer.tsx` 两级 tab:
- SP1 · 意图分类 → `Sp1Editor`(读 `sp-classification`)
- SP2 · 改写
  - 改写 SP → `Sp2Editor`(读 `sp-rewrite`)
  - 策略库 → `PipelineStrategyVerticalEditor`(vertical 驱动 · 同时编辑 `vertical-standard` + `platform-tone` 两个 namespace)

每个 namespace 走独立 `Index atom`(`lib/atoms-pipeline-strategies.ts`)+ `VersionedEditor` 通用组件(从 plan Part 4.5 的 4 份 copy-paste 抽出来的)。debounce 写盘走 `PUT /api/labs/pipeline/{strategies,sps}/<ns>/<id>` —— **写盘 = 写当前 active 版本(默认)或用户选中的 viewing 版本**。

**`PUT /api/labs/pipeline`**(旧统一接口)被改成走 Registry 兼容层,body `{ kind, name, content }` 时写到对应 namespace 的 active 版本。前端抽屉新版已经不调它,**保留为外部脚本 / 临时调试入口**;真没人用了再删(等观察 1 个月)。

### MdPreview vs PromptBlock 渲染规约(踩坑过)

`MdPreview`(react-markdown + remark-gfm)**只用于真 markdown**(SP 文件 / `composed_system` / 策略库 bullets 预览)—— 它**忽略单换行**(soft break),会把行折成段落。带 `\n` 但非 markdown 的「字段:值 + 缩进」结构(`reviewed[].prompt` / `generation.prompt` / SP1 search_intent JSON)必须用 `<pre whitespace-pre-wrap>`(参考 `PromptBlock` 组件),保留换行。`RawOutputViewer` 智能分流:认到 SP2 `{reviewed:[]}` shape → PromptBlock 渲染每条 prompt;其他 JSON → pretty-print + ```json fence + MdPreview;parse 不出 → ```text fence 兜底。

## Experiments lab(2026-05-12 平台化产物)

每次 Pipeline 跑批落盘后,在侧栏「Experiments」入口里能看到。

- 列表页 `/labs/experiments` → 走 `GET /api/experiments?pipeline_id=&tag=&q=&limit=&offset=`
- 详情页 `/labs/experiments/<id>` → 走 `GET /api/experiments/<id>`,**直接复用 Pipeline lab 的 4 卡渲染**(`record.output` 当成跑完的 result 喂给 SearchIntentCard / StrategyPackCard / Step2Card / GenerationCard,卡片接 `Partial<PipelineResponse>` 天然兼容)
- 顶栏「📌 跳到实验记录」按钮 —— 监听 NDJSON `experiment_saved` phase 拿 id,push 到详情页

**Phase 3b/3c 还没做**(A/B 对照 / 复跑 / 矩阵 / PM 评分 / Golden set / Langfuse / 飞书导出),plan Part 5.4 列了 5 个,**PM 提了才做对应那个**,不要全做。

## .env.local 期望的 key

启动期必读:

```env
# LLM 网关(必填)
LLM_BASE_URL=http://llm-gateway-go.svc.pre.lovart.cloud/v1
LLM_API_KEY=sk-placeholder      # 内网网关不真验证 key
LLM_MODEL=bedrock/claude-sonnet-4-6

# 生图网关(必填)
IMAGE_GATEWAY_BASE_URL=http://api-svc-pre-go.lovart.cloud
IMAGE_SERVICE_NAME=prompt-rewriter
# 图像模型(网关路径里 `/openai/<IMAGE_MODEL>/text-to-image` 的 <model> 段;切其他模型时改这里)
IMAGE_MODEL=gpt-image-2

# Cloudflare R2(可选,batch 导出 CSV → 公网 URL 时才用)
R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=lovart-assets
R2_PUBLIC_BASE_URL=https://pub-<id>.r2.dev   # bucket 启 r2.dev 公开访问后填
```

`.env*` 已 gitignore,改完**重启 dev server** 才生效(Next.js 不热加载 env)。

## firstRender / firstLoad ref 守卫(踩过坑别去掉)

以下抽屉编辑器的 debounce useEffect 都加了 `firstRender` / `firstLoad` ref 守卫,跳过启动那一帧:

- `SkillEditor` / `RulesList` / `HintsList`(rewrite lab 抽屉)
- `format-skill-editor` / `model-profile-editor`(format/batch lab 抽屉)
- `VersionedEditor`(2026-05-12 平台化产物,Pipeline lab 4 个 namespace 都用它:`Sp1Editor` / `Sp2Editor` / `PipelineStrategyVerticalEditor` 内的 vertical + platform 两个独立 ref)

原因:atom 启动期会从 `""` / `[]` 变成 API 拉来的初值 → 不守卫的话会触发"用空内容覆盖文件"的 bug。**不要删这些 ref**。

平台化改造后,Registry 多版本编辑额外多一个守卫维度 —— **切 viewingId 时也要重置 firstLoad**(用户切到 v2-draft 那一帧 content 重新从 API 拉,不守卫的话切完就把 v2-draft 内容覆盖成切之前 v1 的旧 buffer)。`VersionedEditor` 已经处理,自己写新 editor 时别遗漏。

## 设计文档双份保存

新需求 spec / PRD / UI:**双份落盘**

```
docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md       ← 项目仓库
+ ~/Documents/Lovart-Chocolae/Lovart 需求设计/需求/<需求中文名>/...   ← Obsidian
```

UI 设计章节走 `~/Downloads/DESIGN-claude.md` 的 Anthropic 暖色 + 衬线规范(parchment / ivory / terracotta / olive-gray;**禁冷蓝灰**)。

## 几个有意为之但看着像 bug 的事

- **两套生图轮询**(`lib/image-job.ts` 客户端 + `lib/batch-runner.ts:pollImageUntilDone` 服务端 + `lib/pipeline-image-runner.ts:pollImageTaskUntilDone` 服务端):rewrite/format 是用户在线等所以客户端轮,batch 是离线跑要 SSE 推所以服务端轮,pipeline 是 NDJSON 流式所以也服务端轮。**三份各自负责一条链路,故意不合并**
- **两套流式协议(SSE vs NDJSON)**:batch 用 SSE(`/api/labs/batch/runs/[id]/stream`)因为 run 是长生命周期、可断线重连,SSE 内置心跳和事件 id;pipeline 用 NDJSON(POST 长连接)因为 run 是一次性 < 90s 的同步过程,简单 `\n` 分隔 JSON 更直接、前端不需要 `EventSource` 反订阅。**不要把两个统一**
- **`as` cast in `app/api/rewrite/route.ts`**:soft schema 兜底策略,LLM 部分失败时返回 partial 让前端能渲染 —— 不是错误掩盖
- **`globalThis` mutex in batch-store** 跟 **`lib/experiments/store.ts`**:防 Next.js dev hot-reload 重置模块变量,生产 build 也无害
- **`atomFamily` 没清理 hook**(`formatJobAtomFamily`):demo 阶段无所谓;真要做先 measure 内存
- **`format-lightbox.tsx` 是半成品全局单例**:原意是提到顶层支持跨 cell 翻页,但 cell 端(`format-cell.tsx`)至今仍用本地 `previewSrc` 自渲 lightbox,这个全局单例实际没接通。`formatLightboxFormatIdAtom` 已在 `atoms-format.ts` 备好,真接通时需给 `ImageLightbox` 扩 `caption / onPrev / onNext / position` props。**现在不要删它**,备着
- **`app/api/labs/pipeline/route.ts` 的 GET / PUT 兼容层走 Registry**(2026-05-12 平台化遗留):旧前端抽屉调过这两个接口,Phase 2 后内容迁去多版本目录,**这两个 handler 不能直接删** —— 现在转译成 `resolve(ns)` / `registryWrite(ns, idx.active, body.content)`,作为外部脚本 / 临时调试入口续命。新前端抽屉不调它,等观察 1 个月没人用再删
- **Pipeline ExperimentRecord 存的是远程 image URL**(`https://assets-persist.lovart.ai/...`)不是 `/api/image-file/<sha>` 本地缓存:`pipeline-image-runner.ts` 没走 `saveImageBytes()`,跟 batch lab 不同。**已知隐患**,等 long-term record 真出现 404 再补救(改动会影响前端缩略图缓存逻辑,风险面比看起来大)
- **`data/labs/pipeline/_legacy/`**:Phase 2 迁移时把旧单文件移到这里 backup,**3 个月观察期后再删**。任何"清理冗余"动作都要等 PM 用过一段时间

## 几个常用 tsc 检查命令

```bash
node ./node_modules/.bin/tsc --noEmit                  # 全量类型检查
node ./node_modules/.bin/tsc --noEmit | grep "error"   # 只看错误
```
