// prompt-rewriter/lib/atoms.ts
import { atom } from "jotai";
import type {
  HardRule,
  VerticalHint,
  RewriteResult,
  HistoryItem,
  SkillsIndex,
} from "./schema";

// 流式过程中,result 可能是部分完成的,所以用 Partial
export type PartialRewriteResult = Partial<RewriteResult>;

// 输入 / 跑改写状态
export const queryAtom = atom<string>("");
export const isRunningAtom = atom<boolean>(false);
export const runErrorAtom = atom<string | null>(null);

// 当前结果(流式过程中可能是 partial) + 当前 LLM 原始返回(兜底用)
export const rewriteResultAtom = atom<PartialRewriteResult | null>(null);
export const lastRawAtom = atom<string | null>(null);

// 历史轮次(服务端落盘到 data/history.json,启动时通过 Providers 回读)
// 之所以不用 atomWithStorage / localStorage:
//   - Next.js SSR 首屏默认会以 [] 渲染,hydration 时偶发写回空值覆盖存储 → 刷新即丢
//   - 写到服务端更符合项目整体设计(所有 config 都在 data/ 下),跨浏览器也保留
export const historyAtom = atom<HistoryItem[]>([]);
// 引导完成标志:Providers 拉到初值后置 true;在此之前禁止写回服务端,
// 否则启动瞬间的空 [] 会覆盖磁盘上真正的历史。
export const historyLoadedAtom = atom<boolean>(false);

// 当前"正在输出区展示的"历史条目 id。
// 用途:A/B 生图结果出来之后,image-card 要把 urls / cost 写回这条 history,
// 供用户回看历史时能直接看到图片 —— 所以需要知道"现在这轮属于哪条"。
// run() 开始时清空,history 条目落地后写入新 id。
export const currentHistoryIdAtom = atom<string | null>(null);

// 当前 rewrite 跑批的完整 detail(HistoryItem 形状,含 image_jobs)。
// 新历史架构下不再用 historyAtom 装全量 detail —— 那既费内存又因 schema 演进
// 一改就批量 parse fail。改用这个"当前那条"小 atom:
//   - input-bar finalize 时 set
//   - image-card 完成时 patch image_jobs 字段并写回服务端
//   - HistorySidebar 点击载回时 fetch detail 后 set
// 用 unknown 是为避免 atoms 反向依赖太多 schema。
export type CurrentRewriteDetail = {
  id: string;
  ts: number;
  query: string;
  result: unknown;
  config_snapshot?: unknown;
  image_jobs?: { baseline?: unknown; optimized?: unknown };
} & Record<string, unknown>;
export const currentRewriteDetailAtom = atom<CurrentRewriteDetail | null>(null);

// 配置文件(启动从 API 拉,编辑后写回 API)
//
// skillMdAtom 永远持有 **当前 active 版本** 的内容:
//   - rewrite 链路不感知版本(总是跑 active),所以 UI 其他地方继续消费这个 atom
//   - skill-editor 切版本时,会同步把新 active 的内容回写到这个 atom
export const skillMdAtom = atom<string>("");
export const skillsIndexAtom = atom<SkillsIndex>({
  active: "",
  versions: [],
});
export const hardRulesAtom = atom<HardRule[]>([]);
export const verticalHintsAtom = atom<VerticalHint[]>([]);

// target_model + 可用 profiles + 当前 profile md
export const targetModelAtom = atom<string>("");
export const availableModelsAtom = atom<string[]>([]);
export const modelProfileMdAtom = atom<string>("");

// ─────────── LLM 改写模型(跨 lab 共享) ───────────
// 每个 lab 的输入区上方都有一个 dropdown,改这个 atom 切换;
// run 路径(rewrite + format)在 fetch body 里把这个值传给后端,
// 后端 lib/llm.ts 用它覆盖默认 MODEL。
export type LLMModelOption = {
  id: string;       // gateway 模型 ID, 如 bedrock/claude-sonnet-4-6
  label: string;    // 显示名, 如 Claude 4.6
  provider: string; // anthropic / moonshot / ...
  notes: string;
};
export const llmModelOptionsAtom = atom<LLMModelOption[]>([]);
export const llmModelAtom = atom<string>(""); // 当前选中的模型 id, "" = 用后端默认

// 衍生:仅启用的硬约束(喂给 LLM)
export const enabledRulesAtom = atom((get) =>
  get(hardRulesAtom).filter((r) => r.enabled)
);

// 抽屉:历史轮次已独立为左侧常驻 HistorySidebar,抽屉只承载 4 类低频配置
export type DrawerTab = "skill" | "model" | "rules" | "hints";
export const drawerOpenAtom = atom<boolean>(false);
export const drawerTabAtom = atom<DrawerTab>("skill");

// 配置自持久化"已保存 ✓"提示
export const saveStatusAtom = atom<"idle" | "saving" | "saved" | "error">("idle");

// ───────────── 生图(gpt-image-2) ─────────────
//
// 采用 A/B 并行对照模式,同时跑两路:
//   - baseline : 用户原始 query 直接丢给 gpt-image-2(不经改写)
//   - optimized: 改写流程产出的 final_prompt(含 size / quality / n / output_format)
// 两路参数故意保持一致(只有 prompt 文本不同),这样观察到的差异就是"改写"本身的价值。
// baseline 因为比 optimized 早几秒出发,常常能先出图 —— 这本身也是一个直观信号:
// 原句直出可能快但内容粗糙,改写后稍慢但结构完整。

export type ImageJobStatus =
  | "idle"
  | "creating"
  | "polling"
  | "completed"
  | "failed";

export type ImageJobParams = {
  size?: string;
  quality?: string;
  n?: number;
  output_format?: string;
};

export type ImageJobState = {
  status: ImageJobStatus;
  taskId: string | null;
  size: string | null;       // 实际落到 gateway 的 size(resolved_params.size)
  urls: string[];
  error: string | null;
  cost: number | null;
  startedAt: number | null;  // 本路出发时间戳,用于实时计时
  finishedAt: number | null; // 完成/失败时间戳,用于展示总耗时
  prompt: string | null;     // 本路真正发给 API 的 prompt 文本(用于 UI 回显)
  params: ImageJobParams | null; // 本路真正发给 API 的参数(用于 UI 回显)
};

export const INITIAL_IMAGE_JOB: ImageJobState = {
  status: "idle",
  taskId: null,
  size: null,
  urls: [],
  error: null,
  cost: null,
  startedAt: null,
  finishedAt: null,
  prompt: null,
  params: null,
};

export type ImageVariant = "baseline" | "optimized";

export const baselineJobAtom = atom<ImageJobState>(INITIAL_IMAGE_JOB);
export const optimizedJobAtom = atom<ImageJobState>(INITIAL_IMAGE_JOB);
