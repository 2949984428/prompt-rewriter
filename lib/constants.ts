// prompt-rewriter/lib/constants.ts
//
// 散落在多处的时间常量。**按语义分组**,不要一刀切成"全局 DEBOUNCE_MS"——
// 不同场景对延迟的容忍度本来就不同,合并成一个反而失真。
//
// 加新常量的标准:出现 ≥ 2 次,或者改一次需要在几个文件里同步搜替换。

// ─────────── 生图轮询 ───────────
// 客户端 + 服务端各自轮一套(交互 vs 后台),timeout 共享。
// interval 故意不一样:client 慢一点(用户在线等,延迟一两秒不显眼,省往返),
// server 快一点(批量场景同时跑多个 cell,早一点判完早一点放 semaphore)。
export const IMAGE_POLL_TIMEOUT_MS = 180_000;
export const IMAGE_POLL_INTERVAL_CLIENT_MS = 2000;
export const IMAGE_POLL_INTERVAL_SERVER_MS = 1500;

// ─────────── 防抖延迟(按场景) ───────────
// 三档,体现不同写入紧迫度。改前先想想是不是真的应该跟某档对齐,
// 或者你的新场景需要新增一档。
export const HISTORY_WRITE_DEBOUNCE_MS = 300; // 完成一轮后落历史:越快越好,用户已经停手
export const CONFIG_AUTOSAVE_DEBOUNCE_MS = 500; // 抽屉里编辑 skill / rules / hints 自动保存
export const SCORE_PATCH_DEBOUNCE_MS = 600; // 评分滑杆过滤抖动

// ─────────── 复制到剪贴板的状态自动 reset ───────────
export const COPY_SUCCESS_RESET_MS = 1600;
export const COPY_ERROR_RESET_MS = 2400;
