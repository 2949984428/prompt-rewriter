# 平台化改造路线 v1 · 实习生实施手册

> 这份文档是 prompt-rewriter 项目「Pipeline lab 平台化改造」的实习生上手指南。看完 Part 0-2 你应该明白:这个项目是什么、为什么要改造、改造分几步、第 1 天该读哪些文件。具体怎么动手在 Part 3-5(其他文档),本文不展开。

---

## Part 0 · 文档怎么用

### 0.1 这份文档解决什么问题

PM(巧克力)在过去 2 周里反复迭代 Pipeline lab 的 prompt-rewrite 链路 —— **改 SP / 改策略库 / 跑批 / 看结果 → 又改**。当前形态下有 3 个明显痛点:

1. **`app/api/labs/pipeline/route.ts` 把 SP1 → CreationPlanner → SP2 → 生图 4 段串联硬编码在 POST handler 里**,100+ 行内联逻辑,SP1/SP2 没重试、没超时控制,加新步骤就要改 handler。
2. **改 SP 模板 / 策略库 JSON 没版本号、没 changelog、没回滚**。Pipeline lab 跑批不落盘到 runs(它是端到端演示型,非横评),PM 评审讲不清「v3 比 v2 改善了什么」。
3. **Pipeline lab 跑批结果不进历史索引**,无法 A/B 对比、无法批量盲评。

这份手册把改造拆成三个 Phase,给实习生一个**可独立交付、互不阻塞**的实施路径。

### 0.2 三个 Phase 怎么分(必做 / 推荐 / 看需求)

| Phase | 名字 | 性质 | 解决什么 |
|---|---|---|---|
| **Phase 1** | Lightweight Pipeline Runner | **必做** | 把 4 段编排抽到独立 runner,统一重试 + 超时;为 Phase 2/3 铺地基 |
| **Phase 2** | Prompt Strategy Registry | **必做** | SP / 策略库带版本号 + changelog,改完能回滚、跑批结果能追溯到具体版本 |
| **Phase 3** | Experiment Harness | **看需求** | Pipeline lab 跑批落历史 + 多版本 A/B 对比 + 盲评流程;PM 评审时再做 |

**为什么 Phase 1 必做?** Phase 2 的「版本化 SP」要靠 Runner 注入版本号到 LLM 调用 trace,Phase 3 的「A/B 对比」也要靠 Runner 输出统一的 NDJSON 事件。Phase 1 没做完,2/3 没法开工。

**为什么 Phase 2 必做?** PM 改 SP 没追溯是当前最大痛点。改完 Phase 2,PM 自己点抽屉编辑就能产生版本记录,不再需要喊作者帮忙。

**为什么 Phase 3 看需求?** Pipeline lab 还在迭代「形态」(过去 2 周架构改 ≥ 3 次),冻结成 harness 之前要先确认形态稳定。

### 0.3 工时预估总览

| Phase | 实习生工时 | 拆子任务后 | 关键产物 |
|---|---|---|---|
| Phase 1 | **4-6 小时** | 不拆 | `lib/pipeline-runner.ts` + 重构 `route.ts` |
| Phase 2 | **1-2 天** | 不拆 | `data/labs/pipeline/registry/` 目录 + 抽屉读写改版本化 |
| Phase 3 | **3-5 天** | 可拆 **3a / 3b / 3c** | Pipeline lab 历史落盘 + diff viewer + 盲评包导出 |

- **Phase 3a**:Pipeline lab 跑批落到 `data/labs/pipeline/runs/<id>.json` + 接入 `history-index.json`(~1 天)
- **Phase 3b**:多 run 对比视图(`/labs/pipeline/compare?ids=a,b`),并列两条 NDJSON 时间轴(~1-2 天)
- **Phase 3c**:盲评包导出复用 batch lab 的 `lib/export/anon-mapping.ts`(~1 天)

### 0.4 找帮助的渠道

按"先问谁"顺序:

1. **`prompt-rewriter/CLAUDE.md`** —— 子项目所有约定都在这里。**几乎所有「为什么这样写」的问题这一份能答**。
2. **`docs/superpowers/specs/2026-04-26-prompt-rewriter-demo-design.md`** —— 主架构 spec(rewrite lab 的)。
3. **`docs/superpowers/plans/2026-04-29-fusion-lab.md`** —— 最近一次 lab 落地的实施 plan,可以当模板抄。
4. **Obsidian `Lovart-Chocolae/Lovart 需求设计/需求/Prompt 改写器 Demo/`** —— PM 评审用的镜像版,F15 v4 / writer 版 / reviewer 版 prompt 策略最终结论都在那。
5. **直接读源码** —— `app/api/labs/pipeline/route.ts` + `lib/pipeline-image-runner.ts` 是 Pipeline lab 全部业务逻辑入口。
6. **项目作者(液剑芮)** —— 上面 5 步都没解决再问。

> **关键 takeaway**:**先翻 CLAUDE.md,再读源码,最后问人**。CLAUDE.md 里记的「踩坑笔记」是用血换来的。

---

## Part 1 · 项目背景速通(实习生第 1 天看)

### 1.1 prompt-rewriter 是什么

它是 Lovart(AI 创作工具)的一个**内部 demo / 测试台**,不是上线产品。

- **服务对象**:PM(巧克力)、产品策略团队
- **核心目的**:验证「按用户意图分类 → 注入垂类策略 → 改写 prompt → 出图」这条线上 prompt-rewrite 链路的策略迭代效果
- **工作目录**:`/Users/mac/Downloads/2026:01:04Requirement Analysis/prompt-rewriter/`
  - ⚠️ **路径含冒号会让 npm 的 PATH 解析炸掉**。`package.json` 的所有 scripts 都用 `node ./node_modules/.bin/<bin>` 显式调用 —— **不要还原成裸 `next dev`**。
- **不是什么**:不是面向 C 端的产品、不是替代线上 prompt-rewrite 服务、不连生产数据库

> 名词解释:
> - **demo** = 演示型工具,跑给 PM 自己看
> - **lab** = "实验台",项目里每个 lab 是一个独立功能页(下面会列)
> - **SP** = system prompt,LLM 调用时的 system role 内容
> - **Lovart Creative Production Agent** = 线上真正跑的 agent,demo 在对齐它的链路

### 1.2 5 个 lab 各做什么

| Lab | 作用 | 形态 | 数据落盘 |
|---|---|---|---|
| **rewrite**(垂类) | 单 query 跑完整 7 步推理 + A/B 出图,带 origin 溯源高亮 | 单 query 深挖 | `data/labs/rewrite/runs/<id>.json` |
| **format**(格式) | 1 query × N skill 横评 8-11 种 prompt 格式 | 跨格式横评 | `data/labs/format/runs/<id>.json` |
| **batch**(批量) | N query × M skill 矩阵 + PM 评分 + 排行榜 | 大批量跑分 | `data/labs/batch/runs/<id>.json` |
| **fusion**(融合) | 多策略融合试验台(形态还在迭代) | 实验中 | `data/labs/fusion/runs/<id>.json` |
| **pipeline** | **对齐线上链路的端到端测试台**(意图分类 → 策略注入 → 改写 → 生图) | 端到端演示 | **不落盘到 runs**(Phase 3a 改造) |

> 名词解释:
> - **横评(cross-eval)** = 同一个输入跑多个不同配置,对比效果
> - **跑批(batch run)** = 一次启动跑多个 cell 的过程

### 1.3 Pipeline lab 重点讲(这是要改造的对象)

Pipeline lab 跟其他 4 个 lab 形态**完全不同**:

- 其他 lab 是「横评工具」 → 一次跑一堆 cell → 看哪条 skill / 哪个格式赢
- Pipeline lab 是「端到端演示」 → 跑一次完整链路 → 验证策略组合在真实 query 上的效果

它是 demo **最贴近线上链路**的一个 lab,因此也是 PM 当前迭代频率最高的一个。

### 1.4 Pipeline 数据流图

```
 ┌─────────────┐
 │  user query │   ← 抽屉里手输 / 历史 query 重跑
 └──────┬──────┘
        │
        ▼
 ┌─────────────────────────────────────────────────────┐
 │ Step 1 · runSearchIntent (SP1)                       │
 │   data/labs/pipeline/sps/classification.md           │
 │   默认 LLM = gemini/gemini-3-flash-preview            │
 │   输出: SearchIntentResult { L1, L2, intent_confidence }│
 └──────┬──────────────────────────────────────────────┘
        │
        ▼
 ┌──────────────────────────────────────────────────────┐
 │ buildStrategyPack(intent)                            │
 │   按 L1 拉 vertical-standard.json                     │
 │   按 L2 拉 platform-tone.json                         │
 │   产出: VERTICAL_LABEL / VERTICAL_BULLETS /          │
 │         PLATFORM_LABEL / PLATFORM_BULLETS            │
 └──────┬───────────────────────────────────────────────┘
        │
        ▼
 ┌──────────────────────────────────────────────────────┐
 │ mockCreationPlanner(query, N)                        │
 │   demo 用 mock(线上是真 agent)                       │
 │   产出: N 个 function_call 草稿(generate_media 之类) │
 └──────┬───────────────────────────────────────────────┘
        │
        ▼
 ┌──────────────────────────────────────────────────────┐
 │ Step 2 · runMediaPromptReview (SP2)                   │
 │   data/labs/pipeline/sps/rewrite.md                   │
 │   默认 LLM = doubao/seed-2-0-pro-260215                │
 │   注入策略包到 SP system 末尾 `# Active Blocks`        │
 │   输出: { reviewed: [{id, prompt}, ...] }              │
 └──────┬───────────────────────────────────────────────┘
        │
        ▼
 ┌──────────────────────────────────────────────────────┐
 │ Step 3 · runImageWithRetry × N(并发)                  │
 │   lib/pipeline-image-runner.ts                        │
 │   默认 image_model = gpt-image-2                       │
 │   MAX_ATTEMPTS=10, fib backoff [1,2,3,5,8,13,20,30,45]s│
 │   谁先出图谁先到前端(Promise.all 各自 await)          │
 └───────────────────────────────────────────────────────┘
```

> **关键 takeaway**:**Pipeline lab = SP1 → buildStrategyPack → mockPlanner → SP2 → 生图。Phase 1 要做的就是把这 5 段从 `route.ts` 抽到独立 runner**。

### 1.5 关键约定速查

改任何代码之前,这些约定必须记住:

- **文件系统是单一数据源** —— 所有 SP / 策略库 / runs 都在 `data/` 下,**没数据库**。改文件 = 改状态。
- **改 SP / 策略库无需重启** —— 抽屉编辑 600ms debounce → `PUT /api/labs/pipeline` → 写盘。server 端每次跑批 `fs.readFile`,**没有内存缓存**,下一轮立刻生效。
- **NDJSON 流式**(不是 SSE)—— Pipeline lab 的 POST `/api/labs/pipeline` 返回 `application/x-ndjson`,一行一条 phase 事件。前端 `getReader()` + `TextDecoder({stream:true})` + `split("\n")` 逐行 `JSON.parse`。
- **per-step LLM 模型可独立切** —— `llm_model_search`(SP1) / `llm_model_review`(SP2) / `image_model`(Step 3)。fallback 链:per-step > 全局 `llm_model` > server hardcoded。
- **图像 quality 全局硬锁 `"medium"`** —— 不管 LLM 给什么,server 端在 `lockedFp` 里强制覆盖。原因:成本可控 + 横评公平。**前端切换器不是真相源**。
- **视觉规范是 Anthropic 暖色 + 衬线**(parchment / ivory / terracotta / olive-gray)。**禁冷蓝灰**。规范源:`~/Downloads/DESIGN-claude.md`。
- **shadcn 4.5 底层是 `@base-ui/react` 不是 radix** —— 抄 radix 文档会跑不通:
  - `asChild={true}` → `render={<span/>}`
  - `delayDuration` → `delay`
  - Switch selector 用 `data-checked:` 而非 `data-[state=checked]:`
- **Tailwind v4 用 CSS-first** —— 主题在 `app/globals.css` 末尾 `@theme { ... }` 追加,**不要用 `tailwind.config.ts`**(v4 已弃用)。
- **firstRender ref 守卫**(抽屉编辑器里)**不要删** —— 防启动期 atom 从 `""` 变成 API 拉来的初值时触发"用空内容覆盖文件"的 bug。

> **关键 takeaway**:**改代码前过一遍这 9 条**。每一条都是有人踩坑后写下来的。

---

## Part 2 · 三件套架构总览

三个 Phase 各自交付一件套,合起来叫**「Pipeline lab 平台化三件套」**。

### 2.1 Lightweight Pipeline Runner(Phase 1 产物)

**做什么:**

把 `app/api/labs/pipeline/route.ts` 里 SP1 → buildStrategyPack → mockPlanner → SP2 → 生图的 4 段编排,抽到独立的 `lib/pipeline-runner.ts`。

**新增能力:**

- **统一重试 + 超时** —— SP1 / SP2 共用 fibonacci backoff(对齐 Step 3 已有的 retry 范式)
- **统一 NDJSON 事件 emit** —— Runner 自己负责 push phase 事件,route.ts 只负责接 stream
- **统一 LLM trace 上报** —— 为 Phase 2 注入版本号、Phase 3 落历史做准备

**解决什么痛点:**

- `route.ts` 100+ 行内联编排 → 加新步骤要改 handler、加测试得 mock 整个 HTTP 请求
- SP1 / SP2 LLM 调用失败没重试 → LLM 网关偶尔超时就整轮跑批失败
- phase 事件 emit 散落在 route 内多个 `controller.enqueue(...)` 调用 → 加新 phase 类型容易漏

**实习生能做什么:**

- 抽 `lib/pipeline-runner.ts` 的接口(参考 `lib/pipeline-image-runner.ts` 已有 retry 范式)
- 重构 `route.ts` 只剩 30 行(req schema 校验 + 调 runner + 把 emit 转 stream chunk)
- 加 `node ./node_modules/.bin/tsc --noEmit` 通过即可,demo 没测试套件

### 2.2 Prompt Strategy Registry(Phase 2 产物)

**做什么:**

给 SP 模板 + 策略库(vertical-standard.json / platform-tone.json)加版本管理:

- 文件结构:`data/labs/pipeline/registry/{sps,strategies}/<name>/v<n>.{md,json}`
- 中央索引:`data/labs/pipeline/registry/index.json`(含 active 版本号 + changelog)
- 抽屉编辑器改成「保存即开新版本号 + 写 changelog 摘要」

**解决什么痛点:**

- 当前 PM 改 SP 直接覆盖 `classification.md` —— 上一版本永久丢失
- 跑批结果不知道是哪一版 SP 出的 —— PM 评审讲不清「v3 比 v2 改善了什么」
- 想回滚到 2 周前的版本 → 翻 git log → 复制粘贴 → 容易抄错

**实习生能做什么:**

- 设计 `registry/index.json` 的 schema(Zod 强校验,参考 `lib/schema.ts`)
- 改抽屉编辑器:保存时 prompt 用户输 changelog 摘要,默认值 "minor edit"
- 改 `buildStrategyPack` 和 `runSearchIntent` 读 active 版本,把版本号注入 LLM trace

### 2.3 Experiment Harness(Phase 3 产物)

**做什么:**

把 Pipeline lab 升级成完整实验平台:

- **3a · 落盘** —— 每次跑批写 `data/labs/pipeline/runs/<id>.json` + 进 `history-index.json`
- **3b · 对比** —— `/labs/pipeline/compare?ids=a,b` 并列两条 NDJSON 时间轴,diff highlight 关键字段
- **3c · 盲评** —— 复用 `lib/export/anon-mapping.ts`(batch lab 已有)给 PM 出匿名 ZIP,接收 .json 反向映射

**解决什么痛点:**

- Pipeline lab 跑批结果靠浏览器内存活着 —— 关页面就没了
- PM 想对比「策略 v2 跑 query A 」vs「策略 v3 跑 query A 」 —— 当前手动开两个标签页眼睛看
- PM 拿改写结果给老板评审 —— 不能用真 prompt(会泄漏策略),需要匿名 ZIP

**实习生能做什么:**

- 3a:抄 `lib/batch-store.ts` 的写盘 + per-id mutex(`globalThis` 跨请求共享)模式
- 3b:抄 `feedback-next/` 的 diff 视图(如果有)或者新写一个并列时间轴 React 组件
- 3c:`lib/export/anon-mapping.ts` 现成的,只要适配 Pipeline lab 的 cell shape

### 2.4 三件套互相配合

```
         ┌─────────────────────────────────────────┐
         │  Prompt Strategy Registry(Phase 2)       │
         │  ─ 名词:SP / 策略库的版本仓库            │
         │  ─ 给 active 版本号 + changelog          │
         │  └ data/labs/pipeline/registry/          │
         └────────────────┬────────────────────────┘
                          │ Runner 启动时
                          │ 读 active 版本
                          ▼
         ┌─────────────────────────────────────────┐
         │  Lightweight Pipeline Runner(Phase 1)    │
         │  ─ 动词:执行 SP1→SP2→生图 4 段编排        │
         │  ─ 注入版本号到 LLM trace                 │
         │  ─ emit NDJSON phase 事件                 │
         │  └ lib/pipeline-runner.ts                │
         └────────────────┬────────────────────────┘
                          │ 跑完一轮
                          │ 把 run record 落盘
                          ▼
         ┌─────────────────────────────────────────┐
         │  Experiment Harness(Phase 3)             │
         │  ─ 历史:run 索引 + 详情落盘              │
         │  ─ A/B 对比 + 盲评包导出                  │
         │  └ data/labs/pipeline/runs/<id>.json     │
         │  └ data/history-index.json(共用)        │
         └─────────────────────────────────────────┘
```

记忆口诀:

- **Registry 是名词** —— 存放策略和 SP 的仓库(静态)
- **Runner 是动词** —— 拉一个名词出来跑(动态)
- **Harness 是历史** —— 记下 Runner 每次跑了什么、产出了什么(沉淀)

### 2.5 为什么不一次重写,为什么分三 Phase

**不一次重写:**

- 当前 `route.ts` + `pipeline-image-runner.ts` 已经 work,只是不够好。整体重写风险高、周期长,PM 当前还在迭代 SP 内容,demo 不能停摆。
- 三件套**互不阻塞** —— Phase 2 不依赖 Phase 3,Phase 3 实习生可以分 3a/3b/3c 三个人分别做。

**分三 Phase:**

- **Phase 1 是地基** —— 4-6 小时做完,后面任何改造都靠它。
- **Phase 2 是当下痛点** —— PM 改 SP 没追溯,做完立刻有感。
- **Phase 3 是冻结沉淀** —— demo 形态过去 2 周改 ≥ 3 次,过早冻结成 harness 会发现 schema 不够用又得改。**等 Pipeline lab 稳一稳再做 Phase 3**。

> **关键 takeaway**:**Phase 1 → 2 顺序做完,Phase 3 等 PM 说「形态稳了」再启动**。不要急着把三件套一次铺完。

---

> **Part 0-2 结束**。具体每个 Phase 怎么动手、改哪些文件、踩坑清单、FAQ、词汇表在 Part 3-9(其他文档)。先把这三部分读完,你应该能在脑子里画出:**「Pipeline lab 现在长什么样 / 痛在哪 / 三件套各解决什么 / 我从哪个 Phase 上手」**。


---

## Part 3 · Phase 1 · Pipeline Runner(详细实施手册,实习生第 2-3 天)

> 上一 Part 已经讲过 Pipeline lab 的 5 段数据流(SP1 → strategyPack → CreationPlanner → SP2 → 生图),也讲过当前实现把这五段直接 inline 在 `app/api/labs/pipeline/route.ts` 的 POST handler 里、130+ 行串成一个长函数。Phase 1 的任务**只有一件**:把这 5 段抽成 5 个独立 `Step`,用 `lib/pipeline/runner.ts` 编排,**行为完全不变**。

### 3.1 目标 & 验收

**做完后应该具备的能力:**

1. `app/api/labs/pipeline/route.ts` 的 POST handler 从 130+ 行 inline → ~30 行(build ctx + `runPipeline`)
2. 5 个 `Step` 各自落在 `lib/pipeline/steps/*.ts`,可以独立看、独立改、独立加测试
3. SP1 / SP2 各自带 retry 声明(maxAttempts + backoff),由 runner 统一展开;不需要在 step 里手写 retry 循环
4. Step 3(生图)**继续走 `runImageWithRetry`**,不动 —— 那套 10 次 + fibonacci 已经够好
5. 每个 step 完跑后,runner 自动往 `ctx.trace` 里追一条 `{step, ms, status, attempts}`,响应最后一行 `done` 事件 data 里多带 `trace` 字段

**行为不变红线(改造期间一旦发现这条违反,立刻停手回滚):**

- 前端 NDJSON 协议**100% 保留** —— phase 名(`start / step1 / strategy_pack / creation_planner / step2 / step3_start / step3_item_progress / step3_item / step3_done / done / fatal`)、字段 schema、顺序一个不能变
- 前端 `handleStreamPhase` reducer 不动任何一行
- 改造前跑 T1 case 截图 → 改造后跑 T1 case → 卡片字段对比一致

**验收清单(总):**

- [ ] `node ./node_modules/.bin/tsc --noEmit` 0 报错
- [ ] dev server 重启后跑 T1 / T2 / T3 三个测试 query,Step1Card / StrategyPackCard / Step2Card / GenerationCard 都正常出现
- [ ] 故意把 `data/labs/pipeline/sps/classification.md` 改成会让 LLM 返回非法 JSON 的内容(比如把 `"输出 JSON 格式如下"` 删掉),跑一次,SP1 的 retry 应该看到 3 次 attempt
- [ ] response 最后 `done` 事件的 `data.trace` 数组里有 5 条记录,字段齐全

---

### 3.2 准备工作(拉代码 + dev server + 跑 T1 留 baseline)

第一件事:把改造前的样子记录下来。这是验收用的标尺。

```bash
# 1. 起 dev server
cd "/Users/mac/Downloads/2026:01:04Requirement Analysis/prompt-rewriter"
npm install                # 首次或上次 pull 之后
npm run dev                # → http://localhost:3000

# 2. 类型检查 baseline(应该是干净的)
node ./node_modules/.bin/tsc --noEmit
```

**路径含冒号陷阱再强调一次:**工作目录是 `2026:01:04Requirement Analysis`,冒号让 npm 的 PATH 解析炸掉。所有 npm scripts 已经改成 `node ./node_modules/.bin/<bin>` 显式调用,**不要还原成裸 `next dev` / 裸 `tsc`**。如果跑 `npx tsc` 报奇怪的 ENOENT,这就是原因。

**baseline 三个测试 query(随便挑一个能跑通即可,推荐 T1):**

- **T1** —— `给我做一张 iPhone 17 在天猫双 11 的主图,简洁高级感`(电商 · 淘宝)
- **T2** —— `帮我做一张星巴克春节限定杯的小红书种草图`(品牌 · 小红书)
- **T3** —— `做一张抖音美妆直播的封面,主播在画面右边`(社媒 · 抖音)

打开 Pipeline lab,跑一次 T1,**截图保存**:

1. Step1Card(SP1 输出 + L1/L2 chip)
2. StrategyPackCard(vertical bullets + platform bullets)
3. Step2Card(reviewed prompts)
4. GenerationCard(生图)
5. 浏览器 Network 面板,POST `/api/labs/pipeline` 的 Response → 把 NDJSON 复制下来存成 `baseline-t1.ndjson`

最后这个 `baseline-t1.ndjson` 是验收时**逐行 diff 的对象**。

---

### 3.3 Step 1:完善 `lib/pipeline/runner.ts`

`lib/pipeline/types.ts` 已经起了头(`Step / Pipeline / defineStep / definePipeline`)。我们要在同目录加一个 `runner.ts`,实现 `runPipeline` 这个核心函数。

**关键概念(实习生先理解再写):**

- **`ctx`** —— 一个对象,从 step 1 跑到 step N 时累积所有阶段产物。每个 step 返回 `Partial<TCtx>`,runner 用**浅合并**(`{...ctx, ...patch}`)写回。**浅合并**意思是:`ctx.step1 = {...}` 这种顶层字段被整个替换,不会做 deep merge。这是有意为之 —— deep merge 会让 step 之间的隐式耦合越来越多,看不清谁覆盖了谁
- **`ctx patch`** —— step 返回的那个 `Partial<TCtx>` 对象就是 patch。最佳实践:每个 step 只写**自己负责的那个顶层字段**(SP1 写 `ctx.step1`,SP2 写 `ctx.step2`),互不重叠
- **`emit`** —— 跨 step 共享的事件发送函数。**保留原协议**意味着 step 内部还是叫 `emit({ phase: "step1", data: {...} })`,runner 只在最外层包一个 try/catch 把异常变成 `fatal` 事件
- **`retry` 声明** —— 在 `Step` 上加 `retry: { maxAttempts, backoffMs }`,runner 看到就自动循环。每次循环重新跑 `step.run(ctx, emit)`,**不重发** retry 之前已经 emit 出去的事件(LLM 调用一次的代价 + 用户看不见 retry 噪音都不希望)

**实现:**

```typescript
// prompt-rewriter/lib/pipeline/runner.ts
//
// Lightweight pipeline runner —— 顺序跑 step,自动收集 trace,可选 retry。
// 不做 parallelism(那是 Step 3 内部自己用 Promise.all 处理的事)。
// 不做事件命名约束(step 内 emit 啥就是啥)。

import type { Pipeline, Step, EmitFn, PipelineEvent } from "./types";

/**
 * 单个 step 在 trace 里留下的一条记录。
 * status:
 *   - "ok"     : run 正常返回
 *   - "failed" : 所有 retry 用完仍抛
 *   - "skipped": step.run 返回 undefined 或被 onError 决定不抛(暂未启用)
 */
export type TraceEntry = {
  step: string;
  ms: number;
  status: "ok" | "failed" | "skipped";
  attempts: number;
  error?: string;
};

export interface StepRetryConfig {
  maxAttempts: number;
  /** 每次失败后等多久再重试;长度 < maxAttempts-1 时多出来的次数复用最后一个值 */
  backoffMs: number[];
}

// 给 Step 接口扩 retry 字段(types.ts 起头时没加,这里通过模块声明合并)
declare module "./types" {
  interface Step<TCtx> {
    retry?: StepRetryConfig;
  }
}

export interface RunPipelineResult<TCtx> {
  ctx: TCtx;
  trace: TraceEntry[];
  /** 第一个 failed step 的 id(没失败就是 null) */
  failedAt: string | null;
}

/**
 * 跑一条 pipeline。step 内异常 → 按 retry 配置重试 → 全部用完仍失败 → 写 failed
 * 到 trace,**继续跑后续 step**(把决定权交给后续 step 看 ctx 决定要不要早返)。
 *
 * 为什么不直接整条 abort:我们的 SP1 失败时,SP2 仍然可以 fallback 用空 intent
 * 拿默认策略包跑。让 SP1 失败不影响 SP2 启动,行为跟改造前一致。
 */
export async function runPipeline<TCtx>(
  pipeline: Pipeline<TCtx>,
  initialCtx: TCtx,
  emit: EmitFn,
): Promise<RunPipelineResult<TCtx>> {
  let ctx: TCtx = initialCtx;
  const trace: TraceEntry[] = [];
  let failedAt: string | null = null;

  for (const step of pipeline.steps) {
    const stepStart = Date.now();
    const maxAttempts = step.retry?.maxAttempts ?? 1;
    const backoffMs = step.retry?.backoffMs ?? [];
    let attempts = 0;
    let lastError: unknown = null;
    let patch: Partial<TCtx> | undefined = undefined;
    let entryStatus: TraceEntry["status"] = "failed";

    for (let a = 1; a <= maxAttempts; a++) {
      attempts = a;
      try {
        patch = await step.run(ctx, emit);
        entryStatus = "ok";
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        if (a < maxAttempts) {
          const wait = backoffMs[a - 1] ?? backoffMs[backoffMs.length - 1] ?? 1000;
          console.warn(
            `[pipeline-runner] step=${step.id} attempt ${a}/${maxAttempts} failed (${
              e instanceof Error ? e.message : String(e)
            }),${wait}ms 后重试`,
          );
          await sleep(wait);
        }
      }
    }

    // 浅合并 patch 到 ctx(顶层 key 整个覆盖,不做 deep merge)
    if (patch && typeof patch === "object") {
      ctx = { ...ctx, ...patch };
    }

    const entry: TraceEntry = {
      step: step.id,
      ms: Date.now() - stepStart,
      status: entryStatus,
      attempts,
    };
    if (entryStatus === "failed") {
      entry.error = lastError instanceof Error ? lastError.message : String(lastError);
      if (!failedAt) failedAt = step.id;
    }
    trace.push(entry);
  }

  return { ctx, trace, failedAt };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 把 emit 包成一个会同时收集到本地数组的版本。
 * 给调试/测试用 —— 跑完后看完整 event 序列。生产路径不需要,直接传原 emit。
 */
export function makeTeeEmit(
  base: EmitFn,
): { emit: EmitFn; collected: PipelineEvent[] } {
  const collected: PipelineEvent[] = [];
  return {
    emit: (event) => {
      collected.push(event);
      base(event);
    },
    collected,
  };
}
```

**说明几个关键决策:**

1. **`declare module "./types"` 模块声明合并** —— 不在 `types.ts` 改原 `Step` 接口,而是在 runner.ts 里用 TypeScript 的 module augmentation 把 `retry?` 字段加上。好处:`types.ts` 保持极简,runner 这个能力增强落在使用方
2. **`failed` 不 abort 整条 pipeline** —— 这是改造前的行为(`runSearchIntent` 返回 `{ intent: null, error }`,后续 step 看到 `null` 自己降级)。runner 层不替业务做选择
3. **`makeTeeEmit` 是调试糖** —— 可以拿走完整事件流给单测对比,不影响生产路径

**验收(必过):**

- [ ] tsc 通过(`node ./node_modules/.bin/tsc --noEmit`)
- [ ] `runner.ts` 里所有泛型 `<TCtx>` 都正确传递,没有 `any`
- [ ] `declare module` 那段不报错(VS Code 里把鼠标悬停在 `step.retry` 上能看到类型)

---

### 3.4 Step 2:把 POST 5 阶段重构成 5 个 `defineStep`

现在把 `app/api/labs/pipeline/route.ts` 的 POST handler 里 inline 那 130+ 行,拆成 5 个 step 文件。

**先约定 ctx 形状(放在 `lib/pipeline/steps/types.ts` 或 `lib/pipeline/pipeline-context.ts`,挑一个,我用前者):**

```typescript
// prompt-rewriter/lib/pipeline/steps/types.ts

import type { SearchIntent, MediaPromptReviewResult } from "@/lib/pipeline/schema-shared";

export interface PipelineCtx {
  // 入参(start step 之前已经填好)
  query: string;
  searchModel?: string;
  reviewModel?: string;
  imageModel: string;
  referenceImages: string[];
  functionCallCount: number;
  doGenerate: boolean;
  startTotal: number;

  // 各 step 产物
  step1?: {
    intent: SearchIntent | null;
    raw: string;
    error?: string;
  };
  strategyPack?: {
    vertical_standard: { L1: string; label?: string; standards: string[] };
    platform_tone: { L2: string; label?: string; tone: string[] };
  };
  creationPlanner?: {
    function_calls: Array<{ id: string; prompt: string }>;
  };
  step2?: {
    result: MediaPromptReviewResult | null;
    raw: string;
    composed_system?: string;
    error?: string;
  };
}
```

> **`schema-shared.ts`** 是建议**从 `route.ts` 里把 `SearchIntentSchema / MediaPromptReviewSchema / SearchIntent / MediaPromptReviewResult` 这几个 Zod schema + 类型抽出来**放到 `lib/pipeline/schema-shared.ts`,5 个 step 共用。原 route.ts 改成从 schema-shared 重新导出,保证外部 import 不破。

**Step 1 · search_intent:**

```typescript
// prompt-rewriter/lib/pipeline/steps/step-search-intent.ts

import { defineStep } from "@/lib/pipeline/types";
import { callLLM } from "@/lib/llm";
import { promises as fs } from "fs";
import path from "path";
import { parse as besteffortParse } from "best-effort-json-parser";
import { SearchIntentSchema } from "@/lib/pipeline/schema-shared";
import type { PipelineCtx } from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "labs", "pipeline");

export const stepSearchIntent = defineStep<PipelineCtx>({
  id: "search_intent",
  description: "SP1 · 把用户 query 分类成 L1/L2 意图",
  retry: { maxAttempts: 3, backoffMs: [1000, 2000, 3000] },
  async run(ctx, emit) {
    const t1 = Date.now();
    const sys = await fs.readFile(
      path.join(DATA_DIR, "sps", "classification.md"),
      "utf8",
    );
    const user = `用户 query: ${ctx.query}\n\n请输出 SearchIntentResult JSON。`;

    let intent: PipelineCtx["step1"] = { intent: null, raw: "" };
    try {
      const raw = await callLLM(
        [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        ctx.searchModel,
      );
      const cleaned = extractJsonBlock(raw);
      const parsed = besteffortParse(cleaned);
      const validation = SearchIntentSchema.safeParse(parsed);
      if (validation.success) {
        intent = { intent: validation.data, raw };
      } else {
        // schema 不过 = 这次 attempt 失败,抛出去让 runner retry
        throw new Error(
          `SearchIntent schema 校验失败: ${validation.error.issues
            .map((i) => i.path.join(".") + ": " + i.message)
            .slice(0, 5)
            .join("; ")}`,
        );
      }
    } catch (e) {
      // 注意:retry 用完后还是会进这里 —— runner 把 throw 转成 trace.failed,
      // 这里不能再 throw,要把 error 写到 step1 让前端能渲染
      intent = {
        intent: null,
        raw: "",
        error: e instanceof Error ? e.message : String(e),
      };
    }

    emit({
      phase: "step1",
      data: {
        search_intent: intent.intent,
        raw: intent.raw,
        error: intent.error,
        elapsed_ms: Date.now() - t1,
        llm_model: ctx.searchModel ?? null,
      },
    });

    return { step1: intent };
  },
});

function extractJsonBlock(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) return fenced[1].trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }
  return text.trim();
}
```

> **关于 retry 和 throw 的边界,这里有一个常踩坑的点 ——**
> step.run 内部如果想触发 runner 的 retry,**就要 throw**(像上面 schema 校验失败时那样)。
> 但 retry 全部用完后,runner 会把最后一次 throw catch 住、写 `trace.failed`、继续下一个 step。
> 此时如果你在 `try/catch` 把它包住、不抛只填 `intent.error`,等于自己取消了 runner 的 retry —— **这是错的**。
> 上面的写法是:校验失败时 throw(runner 看到会 retry)→ runner 用完 retry 后,**它会再 catch 一次**?**不,runner 只 catch run() 的 throw**。所以 step 内必须**先内部 try schema 失败 throw → runner 多次 retry → 最后一次 attempt 仍 throw → runner 把这次 throw 写 trace 然后继续**。
> step1 的产物则**永远不能 throw 出去**(因为后续 step 需要 ctx.step1 至少有 `{intent: null}`)。所以最佳写法是:**最外面一层 try/catch 包住全函数,内部 schema 失败 throw 让 runner retry,外层 catch 兜底 emit + return**。
> 看上面 code 是这个意思:外层 catch 兜底写 `intent.error` 后 emit + return,runner 收到 return 视为 success(`status: ok`,只是带 error 字段)。
> **如果你想让 runner 把这种"业务失败"也计入 trace.failed**,把外层 catch 去掉、让 throw 一直透出来即可 —— 但那样 emit `step1` 事件就没了,前端看不到错误。
> **结论:目前实现选"step1 永远 ok + 业务错误写 data.error",和改造前一致。runner retry 只在 LLM 真正抛 network/timeout 时触发**。
> 看完这一段没懂没事,先按上面 code 抄,跑通 baseline 对照再说。

**Step 2 · strategy_pack:**

```typescript
// prompt-rewriter/lib/pipeline/steps/step-strategy-pack.ts

import { defineStep } from "@/lib/pipeline/types";
import { promises as fs } from "fs";
import path from "path";
import type { PipelineCtx } from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "labs", "pipeline");

type VerticalStandard = Record<string, { label?: string; standards?: string[] }>;
type PlatformTone = Record<
  string,
  { parent_L1?: string; label?: string; tone?: string[] }
>;

export const stepStrategyPack = defineStep<PipelineCtx>({
  id: "strategy_pack",
  description: "按 SP1 输出的 L1/L2,从 JSON 字典里拉对应的 vertical + platform bullets",
  // 纯 fs 读 + 字典查表,几乎不可能失败,不配 retry
  async run(ctx, emit) {
    const t = Date.now();
    const verticalDict: VerticalStandard = JSON.parse(
      await fs.readFile(
        path.join(DATA_DIR, "strategies", "vertical-standard.json"),
        "utf8",
      ),
    );
    const platformDict: PlatformTone = JSON.parse(
      await fs.readFile(
        path.join(DATA_DIR, "strategies", "platform-tone.json"),
        "utf8",
      ),
    );

    const intent = ctx.step1?.intent ?? null;
    const l1 = intent?.L1 ?? "other";
    const l2 = intent?.L2 ?? "other";

    const v = verticalDict[l1] ?? verticalDict["other"] ?? {
      label: "其他",
      standards: [],
    };
    const p = platformDict[l2] ?? platformDict["other"] ?? {
      label: "其他",
      tone: [],
    };

    const pack = {
      vertical_standard: {
        L1: l1,
        label: v.label,
        standards: v.standards ?? [],
      },
      platform_tone: {
        L2: l2,
        label: p.label,
        tone: p.tone ?? [],
      },
    };

    emit({
      phase: "strategy_pack",
      data: { ...pack, elapsed_ms: Date.now() - t },
    });

    return { strategyPack: pack };
  },
});
```

**Step 3 · creation_planner (mock):**

```typescript
// prompt-rewriter/lib/pipeline/steps/step-creation-planner.ts

import { defineStep } from "@/lib/pipeline/types";
import type { PipelineCtx } from "./types";

export const stepCreationPlanner = defineStep<PipelineCtx>({
  id: "creation_planner",
  description: "Mock 拆 N 个 function call 草稿(线上是真 agent,demo 简化)",
  async run(ctx, emit) {
    const t = Date.now();
    const count = ctx.functionCallCount;
    const arr: Array<{ id: string; prompt: string }> = [];
    for (let i = 0; i < count; i++) {
      const id = `call_${randomHex(16)}`;
      const prompt = count === 1 ? ctx.query : `${ctx.query} (function ${i + 1}/${count})`;
      arr.push({ id, prompt });
    }
    emit({
      phase: "creation_planner",
      data: { function_calls: arr, elapsed_ms: Date.now() - t },
    });
    return { creationPlanner: { function_calls: arr } };
  },
});

function randomHex(len: number): string {
  const chars = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * 16)];
  return s;
}
```

**Step 4 · media_prompt_review (SP2):**

```typescript
// prompt-rewriter/lib/pipeline/steps/step-media-review.ts

import { defineStep } from "@/lib/pipeline/types";
import { callLLM } from "@/lib/llm";
import { promises as fs } from "fs";
import path from "path";
import { parse as besteffortParse } from "best-effort-json-parser";
import { MediaPromptReviewSchema } from "@/lib/pipeline/schema-shared";
import type { PipelineCtx } from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "labs", "pipeline");

export const stepMediaReview = defineStep<PipelineCtx>({
  id: "media_review",
  description: "SP2 · 把策略包注入 system,跑改写产出 reviewed[]",
  retry: { maxAttempts: 3, backoffMs: [1000, 2000, 3000] },
  async run(ctx, emit) {
    const t = Date.now();
    const strategyPack = ctx.strategyPack!;
    const functionCalls = ctx.creationPlanner?.function_calls ?? [];

    // 注入 bullets 到 SP2 system 末尾的 # Active Blocks 段(占位符 6 个)
    const verticalLines = strategyPack.vertical_standard.standards
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const platformLines = strategyPack.platform_tone.tone
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const verticalBullets =
      verticalLines.length > 0
        ? verticalLines.map((s) => `- ${s}`).join("\n")
        : "_(none for this task)_";
    const platformBullets =
      platformLines.length > 0
        ? platformLines.map((t) => `- ${t}`).join("\n")
        : "_(none for this task)_";

    const spTemplate = await fs.readFile(
      path.join(DATA_DIR, "sps", "rewrite.md"),
      "utf8",
    );
    const sys = spTemplate
      .replaceAll("{{LOVART_ACTIVE_L1}}", strategyPack.vertical_standard.L1)
      .replaceAll(
        "{{LOVART_ACTIVE_VERTICAL_LABEL}}",
        strategyPack.vertical_standard.label ?? "",
      )
      .replaceAll("{{LOVART_ACTIVE_VERTICAL_BULLETS}}", verticalBullets)
      .replaceAll("{{LOVART_ACTIVE_L2}}", strategyPack.platform_tone.L2)
      .replaceAll(
        "{{LOVART_ACTIVE_PLATFORM_LABEL}}",
        strategyPack.platform_tone.label ?? "",
      )
      .replaceAll("{{LOVART_ACTIVE_PLATFORM_BULLETS}}", platformBullets);

    // user content 只放 query / items / search intent(策略 bullets 已经在 system 里了)
    const items = functionCalls.map((fc) => ({
      id: fc.id,
      tool: "generate_media" as const,
      prompt: fc.prompt,
    }));
    const userParts: string[] = [];
    userParts.push(`## Recent conversation\n[user]: ${ctx.query}`);
    userParts.push(`## Original prompts\n${JSON.stringify({ items }, null, 2)}`);
    if (ctx.step1?.intent) {
      userParts.push(
        `## Search Intent (上游分类输出)\n${JSON.stringify(ctx.step1.intent, null, 2)}`,
      );
    }
    const user = userParts.join("\n\n");

    let step2Result: PipelineCtx["step2"] = {
      result: null,
      raw: "",
      composed_system: sys,
    };

    try {
      const raw = await callLLM(
        [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        ctx.reviewModel,
      );
      const cleaned = extractJsonBlock(raw);
      const parsed = besteffortParse(cleaned);
      const validation = MediaPromptReviewSchema.safeParse(parsed);
      if (validation.success) {
        step2Result = { result: validation.data, raw, composed_system: sys };
      } else {
        throw new Error(
          `MediaPromptReview schema 校验失败: ${validation.error.issues
            .map((i) => i.path.join(".") + ": " + i.message)
            .slice(0, 5)
            .join("; ")}`,
        );
      }
    } catch (e) {
      step2Result = {
        result: null,
        raw: "",
        composed_system: sys,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    emit({
      phase: "step2",
      data: {
        review_result: step2Result.result,
        raw: step2Result.raw,
        composed_system: step2Result.composed_system,
        error: step2Result.error,
        elapsed_ms: Date.now() - t,
        llm_model: ctx.reviewModel ?? null,
      },
    });

    return { step2: step2Result };
  },
});

function extractJsonBlock(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) return fenced[1].trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }
  return text.trim();
}
```

**Step 5 · generate_media:**

```typescript
// prompt-rewriter/lib/pipeline/steps/step-generate-media.ts

import { defineStep } from "@/lib/pipeline/types";
import { runImageWithRetry } from "@/lib/pipeline-image-runner";
import type { PipelineCtx } from "./types";

export const stepGenerateMedia = defineStep<PipelineCtx>({
  id: "generate_media",
  description:
    "对每个 reviewed.prompt 并发跑生图,内部已有 10 次 fibonacci retry,不再叠 step 级 retry",
  // 注意:不在这里加 retry 配置!runImageWithRetry 自己有完整重试逻辑,
  // step 级再叠一层会让最坏情况变成 10×3=30 次 LLM 调用,无意义。
  async run(ctx, emit) {
    const t3 = Date.now();
    const reviewed = ctx.step2?.result?.reviewed ?? [];
    if (!ctx.doGenerate || reviewed.length === 0) {
      emit({
        phase: "step3_done",
        data: {
          elapsed_ms: 0,
          skipped: !ctx.doGenerate,
          image_model: null,
        },
      });
      return {};
    }

    emit({
      phase: "step3_start",
      data: { count: reviewed.length, image_model: ctx.imageModel },
    });

    // 并发 —— runImageWithRetry 内部 emit step3_item_progress / step3_item
    await Promise.all(
      reviewed.map((r) =>
        runImageWithRetry({
          id: r.id,
          prompt: r.prompt,
          imageModel: ctx.imageModel,
          referenceImages: ctx.referenceImages,
          emit,
          manualRetry: false,
        }),
      ),
    );

    emit({
      phase: "step3_done",
      data: {
        elapsed_ms: Date.now() - t3,
        skipped: false,
        image_model: ctx.imageModel,
      },
    });
    return {};
  },
});
```

**再写一个 `index.ts` 把 5 个 step 拼成 pipeline:**

```typescript
// prompt-rewriter/lib/pipeline/steps/index.ts

import { definePipeline } from "@/lib/pipeline/types";
import type { PipelineCtx } from "./types";
import { stepSearchIntent } from "./step-search-intent";
import { stepStrategyPack } from "./step-strategy-pack";
import { stepCreationPlanner } from "./step-creation-planner";
import { stepMediaReview } from "./step-media-review";
import { stepGenerateMedia } from "./step-generate-media";

export const pipelineDefinition = definePipeline<PipelineCtx>({
  id: "labs.pipeline.main",
  steps: [
    stepSearchIntent,
    stepStrategyPack,
    stepCreationPlanner,
    stepMediaReview,
    stepGenerateMedia,
  ],
});

export type { PipelineCtx };
```

**最后改 `app/api/labs/pipeline/route.ts` POST handler:**

```typescript
// prompt-rewriter/app/api/labs/pipeline/route.ts (POST 部分,只改这块,GET/PUT 不动)

import { runPipeline } from "@/lib/pipeline/runner";
import { pipelineDefinition, type PipelineCtx } from "@/lib/pipeline/steps";

export async function POST(req: NextRequest) {
  let body: z.infer<typeof PipelineRequestSchema>;
  try {
    const json = await req.json();
    body = PipelineRequestSchema.parse(json);
  } catch (e) {
    return Response.json(
      { error: "request 参数错误", detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  const startTotal = Date.now();
  const initialCtx: PipelineCtx = {
    query: body.query,
    searchModel: body.llm_model_search || body.llm_model,
    reviewModel: body.llm_model_review || body.llm_model,
    imageModel: body.image_model || "gpt-image-2",
    referenceImages: body.uploaded_image_urls ?? [],
    functionCallCount: body.function_call_count,
    doGenerate: body.do_generate,
    startTotal,
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: { phase: string; data: Record<string, unknown> }) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      try {
        send({ phase: "start", data: { query: body.query } });

        const { trace } = await runPipeline(pipelineDefinition, initialCtx, send);

        send({
          phase: "done",
          data: { total_elapsed_ms: Date.now() - startTotal, trace },
        });
      } catch (e) {
        send({
          phase: "fatal",
          data: { error: e instanceof Error ? e.message : String(e) },
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
```

POST handler 从 130+ 行 → ~30 行。原来内联的 `runSearchIntent / buildStrategyPack / mockCreationPlanner / runMediaPromptReview / extractJsonBlock / randomHex` 全部从 route.ts 删掉(它们已经搬到对应 step 文件)。**注意:`SearchIntentSchema / MediaPromptReviewSchema` 和它们对应的 type 也要从 route.ts 移到 `lib/pipeline/schema-shared.ts`**,route.ts 改成从那里 re-export 保持外部 import 不破。

**验收(必过):**

- [ ] `node ./node_modules/.bin/tsc --noEmit` 0 报错
- [ ] dev server 重启后跑 T1,Step1Card / StrategyPackCard / Step2Card / GenerationCard 全部出现
- [ ] 浏览器 Network 抓 POST response,跟 `baseline-t1.ndjson` 行对行 diff,**phase 名 + 字段集** 完全一致(`done` 事件除外 —— 多了 `trace` 字段是预期)
- [ ] Step3Card 里多张图的实时 progress chip("重试 N/M")仍然能看到

---

### 3.5 Step 3:给 SP1/SP2 加 retry 声明

3.4 的代码里已经写了 `retry: { maxAttempts: 3, backoffMs: [1000, 2000, 3000] }`,这里只是讲为什么是这两个值,以及如何测试。

**为什么 3 次 + [1s, 2s, 3s]:**

- LLM JSON drift 是真实存在的 ── Claude / Doubao 偶尔会在 JSON 里把数字写成 `"3"` 字符串、把 enum 写成中文同义词、漏右大括号。**重试一次大多数情况就能恢复**(同样的 system + user 再发一遍,LLM 这次状态不一样了)
- 3 次拍脑袋,经验值。再多次延迟太长用户感知差(SP1 用户站着等);再少次第二次还失败就直接挂了
- backoff 不像 Step 3 那么激进的 fibonacci —— SP1/SP2 是用户在线等,**总等待 ≤ 6s** 是上限。Step 3 是离线,可以等 3 分钟
- **Step 3 故意不加 step 级 retry**(`stepGenerateMedia` 配置里写明白了),否则 10×3=30 次,无意义

**测试 retry 是否真的展开:**

故意把 `data/labs/pipeline/sps/classification.md` 改成这样(让 LLM 必返回 invalid JSON):

```md
你是一个分类器。直接输出汉字"你好",不要输出 JSON。
```

然后跑一次 T1,**查看 dev server 的控制台**,应该看到:

```
[pipeline-runner] step=search_intent attempt 1/3 failed (...) ,1000ms 后重试
[pipeline-runner] step=search_intent attempt 2/3 failed (...) ,2000ms 后重试
```

最后 step1 事件的 `data.error` 仍然写着 schema 校验失败,前端 Step1Card 显示错误。**done 事件的 trace 里这一条 `attempts: 3, status: ok`(根据 3.4 的实现注释,业务错误吞掉不向 runner 抛 → runner 视为 ok)。**

> **如果你想让 trace 里这一条标 failed(用于后续 Phase 3 失败率统计),把 step-search-intent 外层 try/catch 去掉**,让 throw 透出。但这样会丢 step1 事件,前端看不到 error message。**目前 demo 优先用户看见错误信息,Phase 3 评估走 trace.error 字段而不是 status**。

**记得测完把 classification.md 改回去!**保险方式:做这个测试前 `git stash` 一下,测完 `git stash pop`。

**验收:**

- [ ] 故意触发 SP1 schema 失败 → dev server 控制台看到 3 次 attempt 日志
- [ ] 故意触发 SP2 schema 失败(把 rewrite.md 改成"不要输出 JSON")→ 同样看到 3 次
- [ ] 测试结束后把 sps/*.md 还原,正常跑 T1 通过

---

### 3.6 Step 4:trace 自动收集

3.3 的 runner 已经做了 trace。这里只是把它在 `done` 事件里透出来,并验证字段。

**runner.ts 已经返回 `{ ctx, trace, failedAt }`** —— POST handler 里:

```typescript
const { trace } = await runPipeline(pipelineDefinition, initialCtx, send);
send({
  phase: "done",
  data: { total_elapsed_ms: Date.now() - startTotal, trace },
});
```

跑完一次 T1,Network 抓最后一行 done,应该长这样:

```json
{
  "phase": "done",
  "data": {
    "total_elapsed_ms": 18432,
    "trace": [
      { "step": "search_intent", "ms": 2103, "status": "ok", "attempts": 1 },
      { "step": "strategy_pack", "ms": 4, "status": "ok", "attempts": 1 },
      { "step": "creation_planner", "ms": 1, "status": "ok", "attempts": 1 },
      { "step": "media_review", "ms": 4892, "status": "ok", "attempts": 1 },
      { "step": "generate_media", "ms": 11432, "status": "ok", "attempts": 1 }
    ]
  }
}
```

**前端是否要消费这个 trace?** Phase 1 不要。前端代码一行不改是红线。Phase 3 才会加 trace 面板。

**验收:**

- [ ] done 事件 data 里有 trace 数组
- [ ] 5 条记录顺序为 search_intent → strategy_pack → creation_planner → media_review → generate_media
- [ ] 每条都有 step / ms / status / attempts 4 个字段
- [ ] 跑一次 retry 测试,attempts 字段确实变成 3

---

### 3.7 Phase 1 红线 / 不该做

**这些事在 Phase 1 一律不能干,即使看起来很顺手:**

1. **不改前端任何代码** —— `components/labs/pipeline/*` 一个字符都不要碰。如果你发现哪里非改不可,那就是 step 重构破坏了协议,回去找 bug
2. **不动 `lib/pipeline-image-runner.ts`** —— 那 10 次 fibonacci 重试是 PM 验过的体感,不要改 MAX_ATTEMPTS、不要改 BACKOFF_MS、不要把它合并进 runner.ts
3. **不引入 retry 高阶函数** —— 比如把 retry 抽成 `withRetry(step, config)` 装饰器。runner 内置就够了,装饰器只是给代码增加一层 indirection
4. **不做 deep merge** —— ctx 浅合并是有意为之。如果两个 step 都想写 `ctx.step1.intent`,那是设计问题,要么合并成一个 step,要么改 ctx 形状
5. **不引入新依赖** —— runner.ts 不需要 zustand / signal / observable 这类东西。原生 Promise + for 循环够用
6. **不重命名 phase 事件** —— 即使你觉得 `step1` 应该叫 `search_intent_result` 更好,**也不要改**,前端 reducer 写死了这些名字
7. **不动 `data/labs/pipeline/sps/*.md`、`data/labs/pipeline/strategies/*.json`** —— Phase 1 只动代码,不动配置

### 3.8 Phase 1 常见坑

**坑 1:TypeScript 泛型在 `defineStep<PipelineCtx>({...})` 里报 "Type X is not assignable to type Partial<PipelineCtx>"。**

原因:你 `return` 的对象里某个字段类型跟 `PipelineCtx` 里声明的不严格匹配(比如可选字段你返成必选)。**对策**:把 step 函数显式标返回类型 `async run(ctx, emit): Promise<Partial<PipelineCtx>> { ... }`,让 TS 立刻在错误处给红线。

**坑 2:闭包变量捕获 —— `emit` 在 `await Promise.all(reviewed.map(...))` 之后不能用。**

实际不会出问题,因为 send 是 `controller.enqueue` 的闭包,只要 controller 没 close 就有效。但容易让你担心。**记忆点**:在 step 函数内部不要把 emit 存到 module 顶层变量(别整 `let GLOBAL_EMIT`),只在函数参数里传递。

**坑 3:`ctx` 浅合并 vs 深合并的边界。**

举例:你想 step 4 给 step 1 的产物追加一个字段(比如 `ctx.step1.audit = {...}`)。**不能直接 patch `{ step1: { audit: ... } }` 返回 —— 这会把整个 step1 替换成只剩 audit 一个字段的对象。**

正确写法是 step 4 显式读 + 写:

```typescript
const newStep1 = { ...ctx.step1, audit: {...} };
return { step1: newStep1 };
```

但更好的写法是:**审计信息不放回 ctx.step1,而是给它自己开个 `ctx.audit` 顶层字段**。这样不同 step 互不污染。

**坑 4:`declare module "./types"` 报 "Augmentations for the global scope can only be directly nested in external modules or ambient module declarations"。**

原因:`runner.ts` 没有任何 `import` 时,TS 把它当 global script 而非 module,augmentation 不允许。**对策**:确保 `runner.ts` 至少有一个 `import`(我们已经有 `import type { Pipeline, ... } from "./types"`,不会触发)。

**坑 5:路径冒号问题让 `tsc` 显示奇怪错误。**

`node ./node_modules/.bin/tsc --noEmit` 在工作目录含冒号时偶尔报 `error TS5083: Cannot read file '/Users/...../tsconfig.json'`,且行号错位。**对策**:确认你**在 `prompt-rewriter/` 目录下**跑 tsc(不是父目录),并且用 `node ./node_modules/.bin/tsc` 而非裸 `tsc` / `npx tsc`。

**坑 6:dev server 没重启,改了 step 但跑批用的还是旧代码。**

Next.js App Router 大多数文件支持 HMR,但**改 server-only 路由 + import 路径变化时**(尤其新建文件后),HMR 有时会缓存旧的 module graph。**对策**:Phase 1 改造期间养成 Ctrl-C 杀 dev server 再 `npm run dev` 的习惯,1 秒成本换 0 烦恼。

**坑 7:把 `lib/pipeline/types.ts` 起头那两个 `defineStep / definePipeline` 重写了。**

`types.ts` 已经有了,**只在 `runner.ts` 里 `declare module` 扩字段**,不要回头改 types.ts 的接口。改了 types.ts 之后 git diff 会很乱,review 时讲不清增量。

---

## Part 4 · Phase 2 · Strategy Registry(详细实施手册,本周)

> Phase 1 做完后,5 个 step 已经各自独立,**策略数据**(`vertical-standard.json` / `platform-tone.json`)还是单文件全量,每次改一条 bullet 直接覆写。PM 想做 A/B —— 比如 vertical-standard 出 v2 草稿、跑 5 个 query 看看跟 v1 谁更好 —— 现在做不了。Phase 2 给两个策略文件**加版本化**,数据结构跟 `data/skills/_index.json + vN.md` 同形,UI 抽屉抄 `SkillEditor` 的多版本模式。SP1 / SP2 也版本化,逻辑同形。

### 4.1 目标 & 价值

**完成后具备的能力:**

1. 每个策略文件不是单 JSON 而是一个**目录**:`vertical-standard/_index.json + v1.json + v2-draft.json + ...`
2. `lib/strategies/registry.ts` 给所有 step 提供统一的 `resolve(name) → activeContent` 入口,内部读 `_index.json.active` 决定拿哪个版本
3. 抽屉 UI 给每个策略加版本切换器 + 设为当前 + 新建 + 重命名 + 删除,完全抄 `SkillEditor` 模式
4. SP1 / SP2 改写器(`data/labs/pipeline/sps/classification.md / rewrite.md`)同样从单文件 → 目录化 + 版本化
5. Pipeline POST response 多带 `strategy_versions: { vertical: "v3", platform: "v1", sp1: "v2", sp2: "v1" }`,方便后续 Phase 3 评估时知道当时用的哪版

**为什么这件事值得做:**

- 改完一条 bullet 后,**不再无法回滚** —— 以前要靠 git
- A/B 直接 UI 切版本就行,不需要改文件
- 跑批结果带版本号 → Phase 3 评估系统可以建"哪版策略在哪类 query 上更强"的报表

### 4.2 数据结构迁移(单文件 JSON → 目录 + `_index.json` + `vN.json`)

**新目录结构(以 vertical-standard 为例):**

```
data/labs/pipeline/strategies/
  vertical-standard/
    _index.json            # 元信息:active + versions[]
    v1.json                # 历史第一版(从原单文件迁移而来)
    v2-draft.json          # PM 在抽屉里点"新建版本"创建
    v3-aggressive.json     # 又一个尝试

  platform-tone/
    _index.json
    v1.json
    ...
```

**`_index.json` 形状:**

```json
{
  "active": "v1",
  "versions": [
    {
      "id": "v1",
      "label": "初版(2026-04-26 巧克力)",
      "notes": "从单文件迁移过来的基线版本",
      "createdAt": "2026-04-26T10:00:00.000Z",
      "author": "system-migration"
    },
    {
      "id": "v2-draft",
      "label": "v2 草稿 - 加强材质质感",
      "notes": "电商 standards 第 4 条改成更具体的表面纹理要求",
      "createdAt": "2026-05-06T14:32:11.000Z",
      "author": "巧克力"
    }
  ]
}
```

**单个 `vN.json` 形状**和原 `vertical-standard.json` **完全一致**(同样的 dict 结构):

```json
{
  "_meta": { "description": "...", "version": "v1", "owner": "巧克力" },
  "ecommerce": { "label": "电商", "standards": [...] },
  "brand": { "label": "品牌", "standards": [...] },
  ...
}
```

这样旧代码(包括 step 里 `verticalDict[l1]` 这种用法)**完全不用改读取逻辑**,只是从"读固定文件"换成"通过 registry 读 active 版本"。

**迁移脚本(一次性,可以手跑):**

```typescript
// prompt-rewriter/scripts/migrate-strategies-to-versioned.ts
// 一次性脚本,把 vertical-standard.json / platform-tone.json 迁成目录化
//
// 跑法:node ./node_modules/.bin/tsx scripts/migrate-strategies-to-versioned.ts

import { promises as fs } from "fs";
import path from "path";

const STRATEGY_DIR = path.join(
  process.cwd(),
  "data",
  "labs",
  "pipeline",
  "strategies",
);

const TARGETS = [
  { single: "vertical-standard.json", dir: "vertical-standard" },
  { single: "platform-tone.json", dir: "platform-tone" },
];

async function migrate() {
  for (const t of TARGETS) {
    const singlePath = path.join(STRATEGY_DIR, t.single);
    const dirPath = path.join(STRATEGY_DIR, t.dir);

    // 已经迁过就跳过
    try {
      await fs.stat(path.join(dirPath, "_index.json"));
      console.log(`[skip] ${t.dir} 已存在 _index.json`);
      continue;
    } catch {
      // 没迁,继续
    }

    const content = await fs.readFile(singlePath, "utf8");
    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(path.join(dirPath, "v1.json"), content, "utf8");
    await fs.writeFile(
      path.join(dirPath, "_index.json"),
      JSON.stringify(
        {
          active: "v1",
          versions: [
            {
              id: "v1",
              label: "初版(迁移自单文件)",
              notes: "Phase 2 迁移基线",
              createdAt: new Date().toISOString(),
              author: "system-migration",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    console.log(`[done] ${t.dir} 已迁完`);
  }
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

**SP 同样迁:**`data/labs/pipeline/sps/classification.md` → `sps/classification/_index.json + v1.md`。SP 内容是 markdown 不是 JSON,版本文件后缀 `.md`,其他完全同形。迁移脚本同步加这一段(或单写一份)。

**迁完后旧的单文件保留一份在 `_legacy/` 目录里作为 safety net,3 个月后再删:**

```
data/labs/pipeline/strategies/_legacy/
  vertical-standard.json
  platform-tone.json
```

---

### 4.3 `lib/strategies/registry.ts` 核心 API

```typescript
// prompt-rewriter/lib/strategies/registry.ts
//
// 策略库注册中心。给 pipeline step 提供"读 active 版本内容"的统一入口。
// 抽屉 UI 通过 list / publish / activate / delete 管理版本。

import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";

const STRATEGY_BASE = path.join(
  process.cwd(),
  "data",
  "labs",
  "pipeline",
  "strategies",
);

const SP_BASE = path.join(process.cwd(), "data", "labs", "pipeline", "sps");

// ─── 版本元信息 schema ─────────────────────────────
export const VersionMetaSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/i),
  label: z.string(),
  notes: z.string().default(""),
  createdAt: z.string(),
  author: z.string().default(""),
});

export const IndexSchema = z.object({
  active: z.string(),
  versions: z.array(VersionMetaSchema).min(1),
});

export type VersionMeta = z.infer<typeof VersionMetaSchema>;
export type Index = z.infer<typeof IndexSchema>;

// ─── 注册的"命名空间"(namespace = 一类策略文件) ─────────────────────────
//   namespace 是版本化资源的逻辑分组,比如 "vertical-standard" / "platform-tone" / "sp1" / "sp2"
//   每个 namespace 在磁盘上对应一个目录(strategies/<name>/ 或 sps/<name>/)
export type Namespace =
  | "vertical-standard"
  | "platform-tone"
  | "sp-classification"
  | "sp-rewrite";

interface NamespaceConfig {
  baseDir: string;
  versionExt: ".json" | ".md";
}

const NS_CONFIG: Record<Namespace, NamespaceConfig> = {
  "vertical-standard": {
    baseDir: path.join(STRATEGY_BASE, "vertical-standard"),
    versionExt: ".json",
  },
  "platform-tone": {
    baseDir: path.join(STRATEGY_BASE, "platform-tone"),
    versionExt: ".json",
  },
  "sp-classification": {
    baseDir: path.join(SP_BASE, "classification"),
    versionExt: ".md",
  },
  "sp-rewrite": {
    baseDir: path.join(SP_BASE, "rewrite"),
    versionExt: ".md",
  },
};

// ─── 工具:读 / 写 index ──────────────────────────────
async function readIndex(ns: Namespace): Promise<Index> {
  const raw = await fs.readFile(
    path.join(NS_CONFIG[ns].baseDir, "_index.json"),
    "utf8",
  );
  return IndexSchema.parse(JSON.parse(raw));
}

async function writeIndex(ns: Namespace, idx: Index): Promise<void> {
  await fs.writeFile(
    path.join(NS_CONFIG[ns].baseDir, "_index.json"),
    JSON.stringify(idx, null, 2),
    "utf8",
  );
}

function versionPath(ns: Namespace, id: string): string {
  return path.join(NS_CONFIG[ns].baseDir, id + NS_CONFIG[ns].versionExt);
}

// ─── 公开 API ────────────────────────────────────────

/**
 * 读 active 版本的内容(完整文本)。pipeline step 跑批时调这个。
 * 返回 { id, content } —— content 是原始字符串(JSON 还是 md 由 namespace 决定)。
 */
export async function resolve(ns: Namespace): Promise<{
  id: string;
  content: string;
}> {
  const idx = await readIndex(ns);
  const content = await fs.readFile(versionPath(ns, idx.active), "utf8");
  return { id: idx.active, content };
}

/** 抽屉 UI 列版本时调:返回完整 index + 每版本是不是 active */
export async function list(ns: Namespace): Promise<Index> {
  return await readIndex(ns);
}

/** 读指定版本内容(用户在抽屉切版本查看时调) */
export async function read(
  ns: Namespace,
  id: string,
): Promise<string> {
  return await fs.readFile(versionPath(ns, id), "utf8");
}

/** 写指定版本内容(防抖保存) */
export async function write(
  ns: Namespace,
  id: string,
  content: string,
): Promise<void> {
  // 写 JSON 类的版本前做合法性校验,避免坏 JSON 把后续跑批毁了
  if (NS_CONFIG[ns].versionExt === ".json") {
    try {
      JSON.parse(content);
    } catch (e) {
      throw new Error(
        `JSON 格式不合法,未保存: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  await fs.writeFile(versionPath(ns, id), content, "utf8");
}

/**
 * 新建版本。fromId 给定时复制其内容作起点,否则空内容。
 * id 必须合法;label / notes 用户填;author 由调用方传入(目前用 "巧克力" 固定)。
 */
export async function publish(
  ns: Namespace,
  args: {
    id: string;
    label: string;
    notes?: string;
    fromId?: string;
    author?: string;
  },
): Promise<void> {
  const idx = await readIndex(ns);
  if (idx.versions.some((v) => v.id === args.id)) {
    throw new Error(`版本 id 已存在: ${args.id}`);
  }
  const meta = VersionMetaSchema.parse({
    id: args.id,
    label: args.label,
    notes: args.notes ?? "",
    createdAt: new Date().toISOString(),
    author: args.author ?? "",
  });

  // 拷贝内容
  let initialContent = "";
  if (args.fromId) {
    initialContent = await fs.readFile(versionPath(ns, args.fromId), "utf8");
  } else if (NS_CONFIG[ns].versionExt === ".json") {
    initialContent = "{}";
  }
  await fs.writeFile(versionPath(ns, args.id), initialContent, "utf8");

  idx.versions.push(meta);
  await writeIndex(ns, idx);
}

/** 设为 active */
export async function activate(ns: Namespace, id: string): Promise<void> {
  const idx = await readIndex(ns);
  if (!idx.versions.some((v) => v.id === id)) {
    throw new Error(`未找到版本: ${id}`);
  }
  idx.active = id;
  await writeIndex(ns, idx);
}

/** 删除版本(active 不能删,至少留一个) */
export async function remove(ns: Namespace, id: string): Promise<void> {
  const idx = await readIndex(ns);
  if (idx.active === id) {
    throw new Error("当前 active 版本不能删,请先切到别的版本");
  }
  if (idx.versions.length <= 1) {
    throw new Error("至少保留一个版本");
  }
  idx.versions = idx.versions.filter((v) => v.id !== id);
  await writeIndex(ns, idx);
  // 删文件(失败忽略,数据已经在 index 里看不到了,文件残留无害)
  try {
    await fs.unlink(versionPath(ns, id));
  } catch {
    // ignore
  }
}

/** 更新元信息(label / notes 改名) */
export async function patchMeta(
  ns: Namespace,
  id: string,
  patch: { label?: string; notes?: string },
): Promise<void> {
  const idx = await readIndex(ns);
  const v = idx.versions.find((v) => v.id === id);
  if (!v) throw new Error(`未找到版本: ${id}`);
  if (patch.label !== undefined) v.label = patch.label;
  if (patch.notes !== undefined) v.notes = patch.notes;
  await writeIndex(ns, idx);
}
```

**说明:**

- 4 个 namespace(2 策略 + 2 SP)用同一份 API。后续要加新的(比如未来的 `hard-rules`、`few-shots`),只要在 `NS_CONFIG` 加一行
- `resolve / list / read / write / publish / activate / remove / patchMeta` 8 个 API 覆盖所有抽屉 UI 操作
- `versionExt` 通过 namespace 区分 .json / .md。JSON 类的写入前做 `JSON.parse` 校验,避免坏内容把后续 pipeline 毁了

**验收:**

- [ ] 跑迁移脚本,目录结构按预期
- [ ] 写一个小 ts 测试(或直接在 dev console 调):`await resolve("vertical-standard")` 拿到 v1 内容
- [ ] `await publish("vertical-standard", { id: "v2-test", label: "test", fromId: "v1" })` → 目录里多一个 v2-test.json
- [ ] `await activate("vertical-standard", "v2-test")` → `_index.json.active` 变成 v2-test
- [ ] `await remove("vertical-standard", "v1")` 时 active=v2-test,应成功;再 `await remove("vertical-standard", "v2-test")` active 自己,应抛错

---

### 4.4 `buildStrategyPack` 改走 registry

step-strategy-pack.ts 改造:

```typescript
// prompt-rewriter/lib/pipeline/steps/step-strategy-pack.ts (Phase 2 版本)

import { defineStep } from "@/lib/pipeline/types";
import { resolve } from "@/lib/strategies/registry";
import type { PipelineCtx } from "./types";

type VerticalStandard = Record<string, { label?: string; standards?: string[] }>;
type PlatformTone = Record<
  string,
  { parent_L1?: string; label?: string; tone?: string[] }
>;

export const stepStrategyPack = defineStep<PipelineCtx>({
  id: "strategy_pack",
  description: "按 SP1 输出的 L1/L2,从 registry 拿 active 版本的字典查表",
  async run(ctx, emit) {
    const t = Date.now();
    const v = await resolve("vertical-standard");
    const p = await resolve("platform-tone");

    const verticalDict: VerticalStandard = JSON.parse(v.content);
    const platformDict: PlatformTone = JSON.parse(p.content);

    const intent = ctx.step1?.intent ?? null;
    const l1 = intent?.L1 ?? "other";
    const l2 = intent?.L2 ?? "other";

    const vEntry = verticalDict[l1] ?? verticalDict["other"] ?? {
      label: "其他",
      standards: [],
    };
    const pEntry = platformDict[l2] ?? platformDict["other"] ?? {
      label: "其他",
      tone: [],
    };

    const pack = {
      vertical_standard: {
        L1: l1,
        label: vEntry.label,
        standards: vEntry.standards ?? [],
      },
      platform_tone: {
        L2: l2,
        label: pEntry.label,
        tone: pEntry.tone ?? [],
      },
    };

    emit({
      phase: "strategy_pack",
      data: {
        ...pack,
        elapsed_ms: Date.now() - t,
        versions: { vertical: v.id, platform: p.id },
      },
    });

    return {
      strategyPack: pack,
      // ctx 新增字段记录这次跑批用了哪几版,POST handler 在 done 事件透出
      strategyVersions: { vertical: v.id, platform: p.id },
    };
  },
});
```

PipelineCtx 加一个字段:

```typescript
export interface PipelineCtx {
  // ... 旧字段 ...
  strategyVersions?: {
    vertical: string;
    platform: string;
    sp1?: string;
    sp2?: string;
  };
}
```

step-search-intent / step-media-review 也同步改:从 `fs.readFile(sps/classification.md)` → `resolve("sp-classification")`,拿到 id 写到 `ctx.strategyVersions.sp1`。

最后 POST handler 改 done:

```typescript
const result = await runPipeline(pipelineDefinition, initialCtx, send);
send({
  phase: "done",
  data: {
    total_elapsed_ms: Date.now() - startTotal,
    trace: result.trace,
    strategy_versions: result.ctx.strategyVersions,
  },
});
```

**验收:**

- [ ] 跑一次 T1,Network 抓 `strategy_pack` 事件 → data 里多了 `versions: { vertical: "v1", platform: "v1" }`
- [ ] done 事件 data 里有 `strategy_versions: { vertical, platform, sp1, sp2 }` 4 字段
- [ ] 在抽屉点"设为当前"切到 v2-draft 后(下一节做的 UI),立刻跑下一次 T1 → strategy_versions.vertical = "v2-draft",**无需重启 dev server**(因为 registry 每次 `resolve` 都 `fs.readFile`,没缓存)

---

### 4.5 抽屉 UI 加版本化(策略库 tab + SP 抽屉 tab)

抄 `components/drawer/skill-editor.tsx` 的模式。核心 state 三件套:

- `index`(全部版本 + active)—— `useAtomValue` 拿 atom,或者 fetch 拿
- `viewingId`(当前查看哪版)—— 默认初始化为 `index.active`,用户可切到草稿对照
- `content`(viewingId 的内容)—— 切版本时重拉

**关键 atoms(每个 namespace 一对):**

```typescript
// prompt-rewriter/lib/atoms-pipeline-strategies.ts

import { atom } from "jotai";
import type { Index } from "@/lib/strategies/registry";

export const verticalIndexAtom = atom<Index>({ active: "", versions: [] });
export const platformIndexAtom = atom<Index>({ active: "", versions: [] });
export const sp1IndexAtom = atom<Index>({ active: "", versions: [] });
export const sp2IndexAtom = atom<Index>({ active: "", versions: [] });
```

**API route(给抽屉 UI 用):**

`app/api/labs/pipeline/strategies/[ns]/route.ts` —— `GET /` (list) / `POST /` (publish)
`app/api/labs/pipeline/strategies/[ns]/[id]/route.ts` —— `GET` (read) / `PUT` (write) / `PATCH` (patchMeta) / `DELETE` (remove)
`app/api/labs/pipeline/strategies/[ns]/[id]/activate/route.ts` —— `POST` (activate)

(SP 同样的 routes 路径用 `/api/labs/pipeline/sps/[ns]/...`)

每个 route 只是把 registry 函数包成 NextResponse,代码很短,不重复贴。

**抽屉组件(以 vertical 为例):**

```typescript
// prompt-rewriter/components/labs/pipeline/strategy-editor.tsx
"use client";

import { useAtom } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { verticalIndexAtom } from "@/lib/atoms-pipeline-strategies";

export function VerticalStrategyEditor() {
  const [index, setIndex] = useAtom(verticalIndexAtom);
  const [viewingId, setViewingId] = useState<string>("");
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);

  // 首次拿到 index 后初始化 viewingId
  useEffect(() => {
    if (!viewingId && index.active) {
      setViewingId(index.active);
    }
  }, [index.active, viewingId]);

  // 切版本时拉这版内容
  const firstLoad = useRef(true);
  useEffect(() => {
    if (!viewingId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const r = await fetch(
          `/api/labs/pipeline/strategies/vertical-standard/${encodeURIComponent(viewingId)}`,
        );
        const text = await r.text();
        if (!cancelled) setContent(text);
      } finally {
        if (!cancelled) {
          setLoading(false);
          firstLoad.current = false; // 拉完才让 debounce 写盘开始生效
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewingId]);

  // 防抖写盘 —— firstLoad 守卫必加,否则启动时空字符串会覆盖文件!
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!viewingId) return;
    if (firstLoad.current || loading) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await fetch(
          `/api/labs/pipeline/strategies/vertical-standard/${encodeURIComponent(viewingId)}`,
          { method: "PUT", body: content },
        );
      } catch (e) {
        console.warn("[strategy-editor] save failed:", e);
      }
    }, 600);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [content, viewingId, loading]);

  async function refresh() {
    const r = await fetch("/api/labs/pipeline/strategies/vertical-standard");
    setIndex(await r.json());
  }

  async function activate() {
    if (!viewingId || viewingId === index.active || busy) return;
    setBusy(true);
    setOpError(null);
    try {
      const r = await fetch(
        `/api/labs/pipeline/strategies/vertical-standard/${encodeURIComponent(viewingId)}/activate`,
        { method: "POST" },
      );
      if (!r.ok) throw new Error((await r.json()).error || "activate failed");
      await refresh();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function createNew() {
    const id = window.prompt(
      "新版本 id:",
      `v${index.versions.length + 1}-draft`,
    );
    if (!id) return;
    const label = window.prompt("显示名:", id);
    if (!label) return;
    const fromMode = window.confirm(
      `从当前版本 (${viewingId}) 复制内容?\n确定 = 复制,取消 = 空白`,
    );
    setBusy(true);
    try {
      const r = await fetch("/api/labs/pipeline/strategies/vertical-standard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          label,
          fromId: fromMode ? viewingId : undefined,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      await refresh();
      setViewingId(id);
      firstLoad.current = true;
    } catch (e) {
      setOpError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteThis() {
    if (viewingId === index.active) {
      setOpError("active 版本不能删");
      return;
    }
    const ok = window.confirm(`删除 ${viewingId}?`);
    if (!ok) return;
    setBusy(true);
    try {
      const r = await fetch(
        `/api/labs/pipeline/strategies/vertical-standard/${encodeURIComponent(viewingId)}`,
        { method: "DELETE" },
      );
      if (!r.ok) throw new Error((await r.json()).error);
      await refresh();
      setViewingId(index.active);
    } catch (e) {
      setOpError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const viewingMeta = useMemo(
    () => index.versions.find((v) => v.id === viewingId),
    [index.versions, viewingId],
  );

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏:版本选择 + 操作 */}
      <div className="border-b border-border-cream px-8 pt-6 pb-5">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="font-serif text-[13px] text-olive-gray">
            当前查看版本
          </span>
          <select
            value={viewingId}
            onChange={(e) => setViewingId(e.target.value)}
            disabled={busy || index.versions.length === 0}
            className="min-w-[240px] flex-1 rounded-md border border-border-cream bg-ivory px-3 py-2 font-mono text-[13px] text-near-black"
          >
            {index.versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.id === index.active ? "✓ " : "  "}
                {v.label} ({v.id})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 text-[12px]">
          <button
            onClick={activate}
            disabled={busy || viewingId === index.active}
            className="rounded-md bg-terracotta px-3 py-1.5 text-ivory disabled:opacity-40"
          >
            {viewingId === index.active ? "✓ 已是当前版本" : "设为当前版本"}
          </button>
          <button
            onClick={createNew}
            disabled={busy}
            className="rounded-md border border-border-warm bg-parchment px-3 py-1.5"
          >
            + 新建
          </button>
          <button
            onClick={deleteThis}
            disabled={busy || viewingId === index.active}
            className="rounded-md border border-border-warm bg-parchment px-3 py-1.5"
          >
            删除
          </button>
        </div>
        {opError && (
          <p className="mt-2 text-[12.5px] text-error-crimson">{opError}</p>
        )}
        {viewingMeta?.notes && (
          <p className="mt-2 text-[12px] text-stone-gray">{viewingMeta.notes}</p>
        )}
      </div>

      {/* 编辑器 */}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        disabled={loading || !viewingId}
        spellCheck={false}
        className="flex-1 resize-none bg-ivory px-8 py-6 font-mono text-[13px] leading-[1.7] text-near-black"
      />
    </div>
  );
}
```

PlatformStrategyEditor / Sp1Editor / Sp2Editor 同形,只是 atom 和 namespace 名换一下。**4 个组件几乎完全一样,可以提一个 `<VersionedEditor ns={...} atom={...} />` 通用组件**,但 demo 阶段先 copy-paste 出 4 份,等 PM 用一段时间有了反馈再抽象。

**抽屉 tab 结构最终长这样**(改 `pipeline-drawer.tsx`):

```
SP1 · 意图分类  → <Sp1Editor />
SP2 · 改写       → <Sp2Editor />
垂类策略库       → <VerticalStrategyEditor />
平台策略库       → <PlatformStrategyEditor />
```

**验收:**

- [ ] 打开抽屉,4 个 tab 都正常出现版本选择器
- [ ] 切到 v2-draft 编辑一条 bullet → 600ms 后自动写盘(看磁盘 + dev server console)
- [ ] 点"新建"创建 v3-test (从 v1 复制) → 立刻能在下拉看到
- [ ] 切到 v3-test → 点"设为当前" → 下次跑批 strategy_versions.vertical = "v3-test"
- [ ] active 版本删除按钮 disabled,可以删 v3-test 但不能删当前 active

---

### 4.6 Phase 2 红线

1. **不动 Phase 1 的 5 个 step 主流程** —— 4.4 改 step-strategy-pack 只是把读文件的位置改成 resolve,其他逻辑一行不变。**不要顺手"重构"成大幅改写**
2. **不删 `_legacy/` 目录里旧单文件** —— 3 个月观察期,任何"清理冗余"动作都要等 PM 用过一段时间后再说
3. **不引入数据库** —— 文件系统就够。SQLite / postgres 在 demo 阶段都是过度工程
4. **不在 registry 加内存缓存** —— `fs.readFile` 每次跑批读一次,毫秒级。加缓存 = 增加"切版本后是否生效"的不确定性,**违反"改完立刻生效"的核心 UX**
5. **不让 4 个编辑器组件共享 atom** —— 每个 namespace 独立 atom 是有意为之,避免一个抽屉的状态污染另一个
6. **不在 PUT 写盘时校验业务字段**(比如"electronics.standards 必须有 5 条")—— 只做 JSON.parse 合法性校验,业务正确性留给 PM 自己看预览。`vN.json` 是草稿池,允许暂时不完整
7. **路径不动** —— `data/labs/pipeline/strategies/<ns>/_index.json` 这条路径写进了 registry 常量,改路径会让 Phase 1 step 同步坏。**短期没必要**

### 4.7 Phase 2 踩坑预警

**坑 1 · firstRender 守卫(必踩,**强烈预警**)。**

写 debounce 写盘的 `useEffect([content])` 时,**一定要加 `firstLoad.current` ref 守卫**。否则:
- 组件 mount → atom 是空字符串 `""` → useEffect 触发(因为 content 变化了:undefined → "")→ 600ms 后 PUT 一个空字符串到磁盘 → 把 v1.json 整个清空了

这个坑 `SkillEditor / RulesList / HintsList / format-skill-editor / pipeline-sp-editor / pipeline-strategy-l1-editor` 全部踩过。**已经在 prompt-rewriter/CLAUDE.md 顶部明文列了不要删这些 ref**。Phase 2 新加的 4 个编辑器,**每个**都要带 firstLoad ref,**每个**都要在内容加载完成后(`finally` 里)`firstLoad.current = false`。

测试方法:写完编辑器,**重启 dev server**,**不要做任何操作**,**等 2 秒**,然后打开 `data/labs/pipeline/strategies/vertical-standard/v1.json` —— 内容应该跟启动前**一模一样**。如果变空或被覆盖,说明守卫失效。

**坑 2 · `JSON.parse` 在 PUT 时报错,但 textarea 显示的内容看着没问题。**

原因:textarea 里改 JSON 时,用户编辑过程中**中间状态合法不了**(比如改 `"a": 1` → 删到 `"a"` → 半边引号没闭合)。如果用户编辑速度比 600ms debounce 慢,会触发 PUT 时校验失败。

**对策**:registry 的 `write()` 现在抛错 → 上层 API route 返回 400 → 编辑器 UI 应该有 toast 提示"JSON 不合法,未保存"。Phase 2 至少要在编辑器底部加一行状态:

```tsx
const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
// ...PUT 之后 setSaveStatus
<div>{saveStatus === "error" && <span className="text-error-crimson">JSON 不合法,未保存</span>}</div>
```

否则用户看不见错误,以为存上了,实际磁盘还是旧的。

**坑 3 · `useAtom` vs `useAtomValue` 误用导致无限重渲染。**

如果你 `const [index] = useAtom(verticalIndexAtom);`,**只读不写时用 `useAtomValue`**。useAtom 会订阅写权限,某些情况下让 jotai 多触发一次 render。Phase 2 抽屉本身要 setIndex(refresh 后),所以 useAtom 是对的,但**别的只读组件别照抄**。

**坑 4 · 路径冒号让 `node ./node_modules/.bin/tsx scripts/migrate-strategies-to-versioned.ts` 跑不起来。**

实测在 prompt-rewriter/ 目录下用 `node ./node_modules/.bin/tsx ./scripts/migrate-strategies-to-versioned.ts` 可以(前面加 `./`)。如果还不行,临时方案:把脚本写成 `.mjs`(纯 js),手动写 `require` / `import` 加 await top-level。**别用 `npx tsx`**(npx 在含冒号路径下不稳定)。

**坑 5 · ctx 浅合并的隐式坑(从 Phase 1 带来,Phase 2 加重)。**

step-strategy-pack 现在返回:

```typescript
return {
  strategyPack: pack,
  strategyVersions: { vertical: v.id, platform: p.id },
};
```

step-search-intent 之后也要给 strategyVersions 加 sp1:

```typescript
// step-search-intent 新增
const sp = await resolve("sp-classification");
// ... 用 sp.content 作为 system prompt ...
return {
  step1: ...,
  strategyVersions: { ...ctx.strategyVersions, sp1: sp.id },  // 注意展开!
};
```

如果你写成 `strategyVersions: { sp1: sp.id }`,**会把 strategy_pack step 设的 vertical/platform 整个抹掉**(浅合并)。**每次 patch `strategyVersions` 时必须 spread 旧的**。

更安全的写法:**把 strategyVersions 改成可累加的子 patch 模式**,在 PipelineCtx 里写成 `Partial<{...}>` 而非 `{...}`,每个 step 只设自己负责的那一字段。但浅合并仍然要 spread。**习惯成自然:patch 嵌套对象时永远 `...ctx.foo, override`**。

**坑 6 · activate 后没 refresh,UI 还显示旧 active。**

`activate()` 后必须 `await refresh()` 拉新 index → setIndex → UI 重新 derive `viewingMeta` / 各按钮 disabled 状态。**4.5 的代码里写了 await refresh,不要漏**。漏了的话点"设为当前"后,按钮还是 enabled、下拉前缀还没有 ✓,用户会一脸困惑。

**坑 7 · 跨 Phase 边界:Phase 1 改完没合,Phase 2 直接开干。**

千万别。Phase 1 没跑通 baseline 对比,Phase 2 的所有验收都会带上 Phase 1 的残留 bug。**Phase 1 合 PR + reviewer approve 后再开 Phase 2 分支**。


---

## Part 5 · Phase 3 · Experiment Harness（下周 +,可慢做）

Phase 1 把 Pipeline lab 重写到 Runner-driven,Phase 2 引入策略 Registry 让多版本可路由 —— 这两步做完,你已经能跑批 + 切版本对比了。**Phase 3 是把"每次跑批"变成"可检索、可复跑、可对照"的实验单元**,让 PM 第二天回来时能找到昨天那一轮、能把它和今天这轮并排看,而不用翻浏览器历史。

下面 5.1-5.5 是 Phase 3 的拆分、红线和实施提示。**与 Phase 1/2 不同,Phase 3 三段都可以独立交付:3a 跑完整个团队就立刻能用,3b/3c 按 PM 需求节奏推。**

### 5.1 目标 & 拆分(3a 落盘 / 3b A/B / 3c 高阶)

- **3a · ExperimentRecord 落盘**(1 天)—— Pipeline 跑完自动写一份带配置快照的 record 到 `data/experiments/<id>.json`,侧栏加「Experiments」入口列表 + 详情页复用 Pipeline 4 卡渲染。**这一步做完已经够 PM 用一周**。
- **3b · A/B 对照**(1-2 天)—— 列表多选 N 条 record,进对比页并排看出图 + reviewed prompt diff + 配置 diff。
- **3c · 高阶能力**(按需,只列功能不展开)—— 矩阵跑批、PM 评分、Golden set、Langfuse 上报、飞书导出报告。**别一上来就排进来,等 PM 提了再做对应的那个,不是全做**。

拆分原则:**3a 是真依赖,3b 依赖 3a 的 record 文件,3c 依赖 3a/3b 的产物。** 反过来不成立 —— 不要为了 3c 的某个功能去回头改 3a 的 schema,加新字段就行。

### 5.2 Phase 3a · ExperimentRecord 落盘(1 天)

#### Schema(`lib/schema.ts` 加一段)

```ts
export const ExperimentRecordSchema = z.object({
  id: z.string(),                              // exp_<uuid>
  ts: z.number(),                              // 跑批时间(ms)
  pipeline_id: z.string(),                     // "vertical_prompt_rewrite_v1"
  inputs: z.object({
    query: z.string(),
    function_call_count: z.number().int().min(1).max(8).default(4),
    // 未来其他 pipeline 的 inputs 字段往这里加(open shape,Zod passthrough)
  }).passthrough(),
  config_snapshot: z.object({
    // Phase 2 完成后这里才有意义:跑那一刻 Registry 解出来的版本
    strategy_versions: z.record(z.string(), z.string()).default({}),
    // 例:{ vertical: "v3", platform: "v1", classification_sp: "v2" }
    models: z.object({
      search: z.string().default(""),
      review: z.string().default(""),
      image: z.string().default(""),
    }),
  }),
  output: z.object({                           // 来自 PipelineResponse,完整保存
    step1: z.any(),
    step2: z.any(),
    step3: z.object({
      generations: z.array(z.any()),
    }),
  }),
  trace: z.array(z.any()).default([]),         // Phase 1 加的 ctx.trace
  tags: z.array(z.string()).default([]),       // ["case:T1", "iteration:2026-05-12"]
  metadata: z.object({
    author: z.string().default(""),
    replay_of: z.string().optional(),          // 如果是复跑,记原 record id
    note: z.string().default(""),
  }).default({}),
});
export type ExperimentRecord = z.infer<typeof ExperimentRecordSchema>;
```

#### API

- **写盘** —— `POST /api/labs/pipeline` 在 NDJSON `done` phase 之后,server 端 build record → `fs.writeFile(data/experiments/<id>.json)` → 在 NDJSON 末尾多推一行 `{ phase: "experiment_saved", id }`。前端拿到这个 id 后,顶栏出现一个「📌 跳到实验记录」按钮。
- **列表** —— `GET /api/experiments?tag=&pipeline_id=&limit=50&offset=0` 返回瘦索引(只含 id / ts / query / tags / pipeline_id / strategy_versions / metadata.author / metadata.note),**不含 output**。瘦索引来源:扫 `data/experiments/*.json` 读 head 字段 —— 起步阶段够用,等数量 > 500 再考虑独立 index.json。
- **详情** —— `GET /api/experiments/<id>` 返回完整 record。
- **打标** —— `PATCH /api/experiments/<id>` body: `{ tags?, metadata? }`,只允许改这两个字段,其他字段视为 immutable。

#### UI

- 左侧栏在 Pipeline 入口下加一个「Experiments」入口,路由 `/labs/experiments`
- 列表页:表头 `时间 / Query / 策略版本 chips / 模型 chips / tags / 操作`,行点击进详情
- 详情页:**直接复用 Pipeline lab 的 4 卡渲染**(`SearchIntentCard / StrategyPackCard / CreationPlannerCard / GenerationCard`),把 record.output 当成已经跑完的 result 喂进去就行 —— 卡片本来就是接 `Partial<PipelineResponse>`,天然兼容

#### 实习生踩坑提示

- record 文件名严格用 `<id>.json`,id 用 nanoid 或 crypto.randomUUID,不要用 timestamp(并发写盘可能撞)
- 落盘走 `globalThis` mutex(参考 `lib/batch-store.ts` 模式),防 hot-reload 重置
- 列表瘦索引读 head 字段时用 `Zod safeParse` 一条条过,坏文件跳过 + log,**不要让一份脏文件把整个列表炸掉**
- tags 字段在列表页支持自由文本筛选(`q` 参数,匹配 substring 即可,不上 FTS)

### 5.3 Phase 3b · A/B 对照(1-2 天)

#### 复跑(`⊕ 复跑`)

列表行右侧加按钮「⊕ 复跑」,弹一个轻量对话框:
- 默认值 = 该 record 的 inputs + config(model / strategy_versions)
- 允许覆盖 `strategy_versions.<namespace>`(下拉,选项来自 Phase 2 Registry 的 `list(namespace)`)
- 允许覆盖 `models.search / review / image`
- 确认后:`POST /api/labs/pipeline`,body 多一个 `replay_of: <原 id>`;新 record 写盘时 `metadata.replay_of` 填上

#### 对比页(`/labs/experiments/compare?ids=a,b,c`)

- 列表多选 → 顶部「对比(N)」按钮 → 跳对比页
- 视觉布局:**N 列横向并排**,每列从上到下:
  - 顶部 chip 行:`pipeline_id / strategy_versions / models`,跟其他列不一致的 chip **标红**
  - 出图缩略图 grid(每列 N 张图,可点击放大走现有 `ImageLightbox`)
  - reviewed prompt 段:每个字段一行,跨列 inline diff(同字段不同列内容标红/标绿)
  - composed_system 段:折叠默认收起,展开后 line-by-line 双栏 diff
- diff 渲染**不要上 `react-diff-view`**(大依赖、样式跟 Anthropic 暖色不搭),用一个简单 `<pre>` 双栏 + 字符级 diff 算法(`diff` npm 包的 `diffWords` 够用,体积小)

#### 实习生踩坑提示

- 对比页选了**不同 pipeline_id 的 record**怎么办?**允许进入,但 diff 区只渲染共同字段**(都有 step3 出图 → 可对比;step2 字段名不同 → 各自 raw 渲染,不强 diff)。顶部加 banner 提示「这 N 条记录来自不同 pipeline,只显示共同字段对比」
- 对比页 URL 是 `?ids=a,b,c` 而不是 POST body —— 分享给 PM 时复制粘贴 URL 就能复现视图
- 缩略图 grid 用现有 `lib/image-store.ts` 的本地缓存路径,不要从 R2 拉(慢)

### 5.4 Phase 3c · 高阶能力(按需,只列功能不展开)

**收到 PM 明确需求才动手**,以下只列功能 + 关联的现有参考代码,实施细节落到那时再设计。

| 功能 | 一句话 | 复用 / 参考 |
|---|---|---|
| **多 query 矩阵跑批** | N query × M strategy_version,出胜率矩阵 + 胜率热力图 | `lib/batch-runner.ts` Semaphore 控流模式 |
| **PM 评分** | 每条 generation 多维评分(对齐 batch lab),写回 record.metadata 或独立 `score` 字段 | `components/labs/batch/score-drawer.tsx`(直接抄抽屉,改 PATCH 目标为 experiment record) |
| **Golden set** | 标 ✓ 的历史 record 当回归测试基准,改 SP 后能一键跑一遍 golden set 看哪些变了 | record tags `["golden"]` 筛出 + 矩阵跑批入口 |
| **Langfuse trace 上报** | 每个 step.run 的 ctx.trace 异步推到 Langfuse,做线上观测 | `lib/lark/` 现有上报模式,或直接用 langfuse-js SDK |
| **飞书 / lark 导出报告** | 对比页一键导出成飞书文档(图 + diff 表)发评审群 | batch lab `spawn lark-cli` 模式 + `lib/export/` |

### 5.5 Phase 3 红线

- ❌ **不引入 SQLite / Postgres** —— 文件系统单一数据源是这套项目的 superpower,撤回这点会让历史架构、batch、format、experiments 四套都得改
- ❌ **不做多租户 / RBAC** —— 这是内部 demo,加权限只会拖延 PM 用上的时间
- ❌ **不做 PR / approval flow** —— Registry 改 active 版本走文件编辑 + Git,不另起一套审批
- ❌ **不做"统一 trace 协议"** —— Langfuse 接进来就够,不要自研一个跨 lab 通用 trace schema(那是平台团队的活,这个 demo 不背)
- ❌ **不在 ExperimentRecord 里塞图像 base64** —— 只存 image url,实物落在 `lib/image-store.ts` 已有的缓存目录(避免单 record 几 MB 失控)

## Part 6 · 总览(给后来人)

### 6.1 三个 Phase 完成后的代码地图

```
prompt-rewriter/
├── lib/
│   ├── pipeline-runner.ts          ← Phase 1 新增:Runner + Step 抽象
│   ├── pipeline-registry.ts        ← Phase 1 新增:definePipeline()
│   ├── pipeline/
│   │   ├── steps/                  ← Phase 1 新增:step1-classify.ts / step2-rewrite.ts / step3-generate.ts
│   │   └── vertical-prompt-rewrite.ts  ← Phase 1 新增:definePipeline 注册主 pipeline
│   ├── strategy-registry.ts        ← Phase 2 新增:多版本策略 resolve / list / register
│   ├── schema.ts                   ← Phase 1 加 TraceEntry / Phase 2 加 StrategyVersion / Phase 3 加 ExperimentRecord
│   └── experiment-store.ts         ← Phase 3a 新增:落盘 + 列表 + 详情
├── data/
│   ├── labs/pipeline/strategies/   ← Phase 2 新增:vertical/v1.json / v2.json / v3.json / index.json(active 指针)
│   └── experiments/                ← Phase 3a 新增:<id>.json 列表
├── app/api/
│   ├── labs/pipeline/route.ts      ← Phase 1 改写为 Runner.run() + NDJSON stream pump
│   ├── experiments/route.ts        ← Phase 3a 新增:GET 列表
│   ├── experiments/[id]/route.ts   ← Phase 3a 新增:GET 详情 / PATCH tags
│   └── strategies/[ns]/route.ts    ← Phase 2 新增:版本 CRUD + 切换 active
└── components/
    ├── labs/pipeline/
    │   └── pipeline-drawer.tsx     ← Phase 2 改造:版本下拉 + 历史快照
    └── labs/experiments/           ← Phase 3a 新增:list-view / detail-view / compare-view
```

**记忆诀窍**:Phase 1 改的都是「跑」字相关(runner / steps);Phase 2 改的都是「版本」字相关(strategies / registry);Phase 3 改的都是「记录」字相关(experiments / compare)。三层互不踩脚。

### 6.2 怎么往后继续扩展

- **加新 pipeline**(比如「视频 prompt 改写」)—— 在 `lib/pipeline/` 新建 `video-prompt-rewrite.ts`,`definePipeline({ id: "video_prompt_rewrite_v1", steps: [...] })`;新增 route `app/api/labs/video-pipeline/route.ts` 调 `runner.run()`;sidebar 加入口。**不要在现有 pipeline 上加 step 来"复用"**,新 pipeline 就是新 pipeline
- **加新策略 namespace**(比如「色板策略」)—— `data/labs/pipeline/strategies/palette/v1.json` + `index.json`;Phase 2 Registry 的 `register("palette", "v1", ...)` 自动接住;SP2 占位符加 `{{LOVART_ACTIVE_PALETTE_*}}` 两个 + spTemplate.replaceAll 多走两轮
- **加新 lab**(比如「视频审核 lab」)—— 沿用现有 lab 目录约定:`components/labs/<lab>/` + `data/labs/<lab>/runs/` + `app/api/labs/<lab>/` + sidebar 加入口 + atoms 独立一个文件(故意不复用,见 CLAUDE.md)

### 6.3 平台叙事(给上层汇报时怎么讲)

三句话版本:

> 第一阶段(Phase 1)把 Pipeline lab 从命令式 route 重写到 Runner 驱动 —— 现在每个 step 是独立可观测单元,加一步只改一行注册。
>
> 第二阶段(Phase 2)把策略文件从「单文件 active」改成「多版本 + Registry 路由」—— 同一时刻可以让线上跑 v3、对照组跑 v1,PM 在抽屉里切版本不重启服务。
>
> 第三阶段(Phase 3)把每次跑批落成可检索的 ExperimentRecord —— PM 第二天回来能找到昨天那一轮,能跟今天并排看,能复跑改一个参数。

落到工具定位上:**从「单 pipeline 工具」演进到「团队 prompt 实验平台」**,但底层仍然是文件系统 + Next.js,没有引入数据库 / 服务端框架重构。

## Part 7 · 词汇表

| 术语 | 含义 |
|---|---|
| **Pipeline** | 一条端到端的业务链路(query → 改写 → 生图)。本项目目前只有 `vertical_prompt_rewrite_v1`,未来可能加视频版 |
| **Step** | Pipeline 的一个节点;Phase 1 后每个 Step 是 `{ id, deps, run(ctx) }` 的独立单元 |
| **Lab** | UI 上的一个独立实验台目录,跟 Pipeline 不是一回事:Pipeline 是业务链路,Lab 是 UI 入口。当前有 rewrite / format / batch / fusion / pipeline 五个 |
| **NDJSON** | Newline-Delimited JSON,一行一条 JSON 对象。Pipeline lab 用它做流式响应,比 SSE 简单(不需要 `EventSource`,直接 fetch + reader) |
| **SSE** | Server-Sent Events,长连接 + 事件 id + 自动重连。Batch lab 用它,因为 run 是长生命周期可断线重连。**别把两个统一**,见 CLAUDE.md |
| **SP** | system prompt 的缩写。Pipeline 有 SP1(意图分类)和 SP2(改写),分别落在 `data/labs/pipeline/sps/classification.md` / `rewrite.md` |
| **L1 / L2** | 垂类策略的一级 / 二级分类。L1 是品类(品牌 / 电商 / 营销),L2 是平台 / 子场景(小红书 / Instagram / 抖音)。同时驱动策略包加载 |
| **CreationPlanner mock** | Pipeline 里模拟「线上 agent 派出 N 个生图任务」的函数,产出 N 个 `function_call` 草稿。**demo 是 mock**,线上是真 agent |
| **function_call** | 一条生图任务草稿,对应 SP2 输入里的一条待改写 prompt。Pipeline 跑 N 次出图就是 N 个 function_call |
| **generate_media** | 线上 agent 的生图 tool 名,Pipeline lab 沿用这个命名做 mock |
| **buffers / annotated / origin** | rewrite lab 的核心数据契约:`final_prompt.annotated[].origin` 字符串(`user_query | buffer:<label> | hard_rule:<id>` 等)驱动前端 `originStyle()` 高亮色 |
| **Brief + 10 字段** | SP2 输出结构:1 段 Brief + 10 个字段(每个字段三态:EMPTY / LOCK / HAND)。改 SP 前必读父目录 CLAUDE.md 的「三态字段规则」段 |
| **atom** | Jotai 的最小状态单元。每个 lab 一个独立 atoms 文件(`atoms-format.ts` / `atoms-batch.ts`),**故意不复用** |
| **shadcn** | UI 组件库;本项目用的是 shadcn 4.5 **over `@base-ui/react`**,**不是 radix-ui**。改组件时注意 `render={<span/>}` 而不是 `asChild`,`delay` 而不是 `delayDuration`,Switch 用 `data-checked:` 而非 `data-[state=checked]:` |
| **Tailwind v4** | **CSS-first @theme**,在 `app/globals.css` 末尾追加 `@theme { --color-* }`,**不要用 `tailwind.config.ts`**(v4 已弃用) |
| **Anthropic 暖色** | 视觉系统:Parchment `#f5f4ed` / Ivory `#faf9f5` / Terracotta `#c96442` / Olive Gray `#5e5d59`。**禁冷蓝灰**。规范源 `~/Downloads/DESIGN-claude.md` |
| **MdPreview / PromptBlock** | 渲染分流:MdPreview(react-markdown + remark-gfm)只用于真 markdown,**会吞 soft break**;PromptBlock(`<pre whitespace-pre-wrap>`)用于带 `\n` 但非 markdown 的字段值。混用会踩坑 |
| **Registry**(Phase 2) | 策略多版本注册中心,`registry.resolve("vertical", "v3")` 取版本,`registry.list("vertical")` 列所有版本,`registry.register(...)` 注入 |
| **Experiment**(Phase 3) | 一次跑批的完整快照(inputs + config + output + trace + tags),落盘到 `data/experiments/<id>.json` |
| **Trace**(Phase 1) | `ctx.trace[]` 数组,每个 Step 跑完往里 push 一条 `{ step_id, start, end, ok, error?, payload? }`,用于事后回放 + 给 Phase 3 ExperimentRecord 喂数据 |
| **firstRender / firstLoad ref 守卫** | 抽屉编辑器 debounce useEffect 必须有的护栏:启动期 atom 从空数组变 API 初值时,**不守卫的话会用空内容覆盖文件**。**踩过坑别去掉**,见 CLAUDE.md |
| **三件套** | 给新板块建认知模型的三份文档:本质 / 能力架构 / 能力模型。本子项目本身不写三件套,但 PM 在板块认知阶段会引用 |

## Part 8 · FAQ

#### Q1. 第 1 天 `npm install` 报路径冒号相关错怎么办

工作目录 `/Users/mac/Downloads/2026:01:04Requirement Analysis/prompt-rewriter/` 含冒号,这让 npm PATH 解析炸掉。所有 `package.json` scripts 都已经改成 `node ./node_modules/.bin/<bin>` 显式调用 —— **不要还原成裸 `next dev`**。如果只是 install 卡住,直接 `cd` 进目录再跑就行(冒号在路径里 OK,只是 npm PATH 解析有问题)。

#### Q2. `.env.local` 没填 LLM_API_KEY 跑 dev 会怎样

dev server 能起,前端能加载,但任何走 LLM 的 API(SP1 / SP2 / format runner)都会在 server 端 500。先看 `prompt-rewriter/CLAUDE.md` 的「.env.local 期望的 key」段把 5 个必填项填齐,**改完重启 dev server**(Next.js 不热加载 env)。

#### Q3. 端口 3000 被占

`lsof -i:3000` 看占用,杀掉或换端口:`PORT=3001 npm run dev`。前端没有写死 3000,SSR fetch 走相对路径,换端口安全。

#### Q4. tsc 过了但跑批挂在 Step 1

最常见原因是 LLM 网关返回了非 JSON(网关 502 / VPN 没连)。看 dev server 终端日志,搜 `LLM_BASE_URL` / `step1` 错误栈。Phase 1 之后 ctx.trace 会带 payload,前端 NDJSON 也会推 `fatal` phase,排查更快。

#### Q5. Phase 1 改完 NDJSON 流不出 → 怎么 debug

三个常见点:① route 里忘了 `return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } })`;② Runner 内 `send(phase)` 是 sync 写 controller 但忘了 await `writer.write()`;③ `\n` 分隔符漏了(每条 JSON 必须末尾带 `\n`)。直接 `curl -N` 测原始流确认服务端在推,再看前端 reducer。

#### Q6. Phase 1 `step.run` 返回 ctx patch 时 TypeScript 报错 → 解决

最常见是 ctx 是 `Readonly<Ctx>` 但你直接 mutate。Step 的契约是 `run(ctx) => Promise<Partial<Ctx>>`,**返回 patch 给 Runner 合并**,不要 `ctx.step1 = ...` 直接改。如果 patch 类型推不出,Step 的泛型签名加 `Step<CtxIn, CtxOut extends Partial<CtxIn>>`。

#### Q7. Phase 2 改完 SP 抽屉里发现旧版本不见了 → 数据迁移没做完

Phase 2 第一步是把当前单文件 `data/labs/pipeline/strategies/vertical-standard.json` 改成 `vertical/v1.json` + `vertical/index.json`(active 指 v1)。迁移要写一个一次性脚本扫旧文件 → 写新结构,然后**保留旧文件做 fallback 一周再删**。如果你删早了,Git 历史能找回来。

#### Q8. Phase 2 `registry.resolve` 报 "version not found" → 兜底逻辑

应该兜到 `index.json` 的 `active` 版本,**不要兜到 throw**。`resolve(ns, version?)` 签名:不传 version → 用 active;传了但找不到 → log warn + 用 active + 在返回值带个 `fallback: true` flag,UI 顶栏出黄 banner「请求版本 vX 不存在,已用 active v3」。

#### Q9. Phase 2 `firstRender` 守卫不加会怎样(实际症状)

dev server 起来后 0.5 秒内,SkillEditor 的抽屉文件被覆盖成空字符串,你刷新页面发现 SP 没了。**而且 git 不一定能救**(如果你之前 commit 过空版本)。原理:`useAtom(skillAtom)` 启动那一帧值是 `""`,API 拉到内容后变成真值 —— 这两次变化都触发 debounce useEffect,第一次就把空字符串落盘了。守卫做的是「第一次跑过的那一帧标记为 firstRender,跳过落盘」。

#### Q10. Phase 3a ExperimentRecord 文件命名规则

`data/experiments/<id>.json`,id 用 `crypto.randomUUID()`(或 nanoid),**不要用 timestamp**(并发写盘可能撞)。文件 < 5 MB 不分片,> 5 MB 再考虑把 step3.generations 的图 url 数组拆到 sidecar 文件。

#### Q11. Phase 3a 怎么处理一个 record 几 MB 大

reviewed prompt + composed_system 加起来可能十几 KB,真正大头是 step3.generations 里的图(如果存了 base64 就炸了)。**红线**:ExperimentRecord **只存 image url**(指向 `lib/image-store.ts` 的本地缓存),不存 base64。这样单 record 通常 < 500 KB,500 条都不到 250 MB。

#### Q12. Phase 3b 对比页选了不同 pipeline 的 record 怎么办

**允许进入,顶部 banner 提示「这 N 条记录来自不同 pipeline,只显示共同字段对比」**,diff 区只渲染都有的字段(基本只剩 step3 出图 + query)。step2 字段名不同 → 各自 raw 渲染,不强 diff。不要拦截 —— PM 偶尔会想横跨 pipeline 看,拦了反而难用。

#### Q13. Phase 3 跑完发现 record 历史里有几条"格式不全"的旧文件,列表打不开

`safeParse` 一条条过,坏文件跳过 + console.warn,**不要让一份脏文件把整个列表炸掉**(这套兜底模式来自 history-index hot-path read,见 `prompt-rewriter/CLAUDE.md`)。

#### Q14. 想加一个新策略 namespace(比如「色板」),从哪改起

四步:① `data/labs/pipeline/strategies/palette/v1.json` + `index.json`;② SP2 模板加 `{{LOVART_ACTIVE_PALETTE_LABEL}}` / `{{LOVART_ACTIVE_PALETTE_BULLETS}}` 两个占位符;③ `spTemplate.replaceAll()` 多走两轮(在现有 6 个之后,排第 7-8 位);④ pipeline-drawer 抽屉加一个「色板策略」tab(复制 vertical-standard tab 改 namespace 名)。**不要去改 Registry 代码** —— Phase 2 完成后 Registry 是 namespace-agnostic 的。

## Part 9 · 引用资源

### 9.1 项目内关键文件路径

**根 / 父级**
- `/Users/mac/Downloads/2026:01:04Requirement Analysis/CLAUDE.md` —— 父级:双子项目对比 + 设计文档双份保存 + Prompt 改写策略演进(F15 v4 / writer / reviewer)
- `/Users/mac/Downloads/2026:01:04Requirement Analysis/prompt-rewriter/CLAUDE.md` —— 子目录:技术栈 + 路径冒号陷阱 + lab 矩阵 + firstRender 守卫 + 故意不合并的事

**Phase 1 主要触达**
- `/Users/mac/Downloads/2026:01:04Requirement Analysis/prompt-rewriter/app/api/labs/pipeline/route.ts` —— 当前 NDJSON 路由,Phase 1 要重写
- `/Users/mac/Downloads/2026:01:04Requirement Analysis/prompt-rewriter/lib/pipeline-image-runner.ts` —— Step 3 重试范式参考
- `/Users/mac/Downloads/2026:01:04Requirement Analysis/prompt-rewriter/lib/batch-runner.ts` —— Semaphore 控流模式参考
- `/Users/mac/Downloads/2026:01:04Requirement Analysis/prompt-rewriter/components/labs/pipeline/pipeline-lab.tsx` —— 前端 NDJSON 消费 reducer 现状

**Phase 2 主要触达**
- `/Users/mac/Downloads/2026:01:04Requirement Analysis/prompt-rewriter/data/labs/pipeline/strategies/` —— 当前策略文件目录(单文件 active)
- `/Users/mac/Downloads/2026:01:04Requirement Analysis/prompt-rewriter/components/labs/pipeline/pipeline-drawer.tsx` —— 抽屉编辑器,Phase 2 改造加版本下拉
- `/Users/mac/Downloads/2026:01:04Requirement Analysis/prompt-rewriter/components/output/skill-editor.tsx` —— firstRender 守卫的标杆实现

**Phase 3 主要触达**
- `/Users/mac/Downloads/2026:01:04Requirement Analysis/prompt-rewriter/lib/schema.ts`(L221-L348)—— HistoryItemSchema / BatchRunRecordSchema / ConfigSnapshotSchema 参考,Phase 3a ExperimentRecord 跟它们同款风格
- `/Users/mac/Downloads/2026:01:04Requirement Analysis/prompt-rewriter/components/labs/batch/score-drawer.tsx` —— PM 评分抽屉,Phase 3c 直接抄
- `/Users/mac/Downloads/2026:01:04Requirement Analysis/prompt-rewriter/lib/batch-store.ts` —— globalThis mutex 跨 hot-reload 共享 state 模式
- `/Users/mac/Downloads/2026:01:04Requirement Analysis/prompt-rewriter/data/history-index.json` —— 现有中央瘦索引参考,Phase 3a 起步阶段不抄它,直接扫文件;500+ 条以后再考虑

### 9.2 Obsidian 相关笔记

- `~/Documents/Lovart-Chocolae/Lovart 需求设计/需求/Prompt 改写器 Demo/Prompt 改写器 Demo.md` —— 主笔记(PM 评审主用)
- `~/Documents/Lovart-Chocolae/Lovart 需求设计/需求/Prompt 改写器 Demo/F15 Art Direction (含通用规则) — 精简版 v4.md`(124 行)—— Brief + Fields 改写策略最终精简版
- `~/Documents/Lovart-Chocolae/Lovart 需求设计/需求/Prompt 改写器 Demo/完整 prompt(融合 v2 · 三态字段 · 复制即用).md`(~406 行)—— writer 角色
- `~/Documents/Lovart-Chocolae/Lovart 需求设计/需求/Prompt 改写器 Demo/reviewer prompt(融合 v3 · 三态字段 + anchor traceability · 复制即用).md`(~262 行)—— reviewer 角色
- `~/Downloads/DESIGN-claude.md` —— Anthropic 暖色 + 衬线视觉规范(强制源)

### 9.3 外部资料

- Next.js 16 App Router docs —— https://nextjs.org/docs/app
- Tailwind CSS v4 docs(**CSS-first @theme**)—— https://tailwindcss.com/docs/v4-beta
- shadcn/ui —— https://ui.shadcn.com/
- `@base-ui/react`(**不是 radix**)—— https://base-ui.com/
- Jotai 2 —— https://jotai.org/
- Zod v4 —— https://zod.dev/
- react-markdown —— https://github.com/remarkjs/react-markdown
- `diff` npm 包(Phase 3b 对比页用)—— https://www.npmjs.com/package/diff

### 9.4 关键 commits

- `32c8a8cb` —— Pipeline lab MVP checkpoint(Phase 1 起步前的基线,改完 Phase 1 后回头 diff 这个 commit 能看到完整改动面)
- `b9c24891` —— 批量测试台导出全套 + 盲评 + 复制重跑 + R2 上传(batch lab 的"完整形态"参考,Phase 3c 的多个功能在这里都有原型)
- `55311fcb` —— 批量测试台 + image quality 锁 medium(image quality 全局硬锁的实现点,改放开前必读)
- `9954e9ce` —— docs(CLAUDE.md): 同步 prompt-rewriter 子项目 + 设计文档双份保存约定(双份保存约定的源 commit)
