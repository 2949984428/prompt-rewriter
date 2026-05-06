// prompt-rewriter/lib/lark/cli.ts
//
// 把 lark-cli 当后端 SDK 用:spawn 进程 + 解析 stdout JSON。
//
// 为什么不用 Lark Open API:本机 lark-cli 已经登录(refresh token 活 30 天),
// 直接复用最省事。生产化部署再换 OpenAPI + 自管 token 那套。
//
// 所有命令共享一个解析模式:
//   stdout = JSON 字符串(lark-cli 默认输出 JSON)
//   stderr = 人类可读错误
//   exit code 0 = 成功
//
// 失败模式:
//   - lark-cli 不在 PATH:ENOENT
//   - 未登录 / token 全过期:exit code 非 0,stderr 提到 "auth" / "login"
//   - API 报错:exit 0 但 stdout JSON 含 code/msg
// 都统一抛 LarkCliError,带 type 字段让上层选择处理策略。

import { spawn } from "child_process";

export class LarkCliError extends Error {
  constructor(
    public type: "not_installed" | "auth_expired" | "api_error" | "unknown",
    message: string,
    public stderr?: string
  ) {
    super(message);
    this.name = "LarkCliError";
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

// 从 lark-cli 输出里抠 {ok:false, error:{message,code,detail}} 的精炼描述。
//
// 注意:不同子命令把 JSON 输出到不同流!
//   - +update:JSON 在 stdout,stderr 只有 [WARN] proxy
//   - +media-insert:JSON 在 stderr(伴 "Inserting:" 进度行),stdout 空
// 所以两个流都试一遍,谁先 parse 出来就用谁。
function tryExtractFromText(text: string): string | null {
  if (!text) return null;
  const firstBrace = text.indexOf("{");
  if (firstBrace < 0) return null;
  const candidate = text.slice(firstBrace);
  try {
    const obj = JSON.parse(candidate) as {
      error?: { message?: string; code?: number | string; detail?: unknown };
    };
    if (obj?.error) {
      const code = obj.error.code != null ? `[${obj.error.code}] ` : "";
      const msg = obj.error.message ?? "(no message)";
      const detail =
        obj.error.detail != null
          ? ` · detail: ${JSON.stringify(obj.error.detail).slice(0, 200)}`
          : "";
      return `${code}${msg}${detail}`;
    }
  } catch {
    /* JSON 不完整,fallback */
  }
  return null;
}

function extractApiError(stdout: string, stderr: string): string | null {
  return tryExtractFromText(stdout) ?? tryExtractFromText(stderr);
}

// 跑一条 lark-cli 命令,返回 stdout 文本。失败抛 LarkCliError。
//
// cwd 选项:用于 +media-insert —— lark-cli 强制 --file 必须是相对路径
// (安全限制),所以 spawn 时 cwd 切到图片所在目录,传 --file ./<filename>。
export function runLarkCli(
  args: string[],
  opts: { timeoutMs?: number; stdin?: string; cwd?: string } = {}
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const proc = spawn("lark-cli", args, {
      // stdio: stdin 可选,stdout / stderr 收集
      stdio: ["pipe", "pipe", "pipe"],
      cwd: opts.cwd,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, timeoutMs);

    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));

    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(
          new LarkCliError(
            "not_installed",
            "lark-cli 未安装或不在 PATH。`brew install lark-cli`",
            stderr
          )
        );
      } else {
        reject(new LarkCliError("unknown", String(err), stderr));
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new LarkCliError("unknown", `lark-cli 超时 ${timeoutMs}ms`, stderr)
        );
        return;
      }
      if (code !== 0) {
        // lark-cli 大部分错误 stdout 是 JSON {ok:false, error:{message,code}},
        // stderr 前面通常是 proxy WARN 之类无用信息,真错误在末尾。
        // 优先从 stdout JSON 提 error.message;拿不到再 fallback stdout/stderr 末尾 400 字符。
        const apiErr = extractApiError(stdout, stderr);
        const tail =
          stderr.length > 0 ? stderr.slice(-400) : stdout.slice(-400);

        // auth_expired 严格匹配:只信明确"过期 / 401 / 请重新登录"信号,
        // 不再因 stderr 含 "auth" 这种通用词就误诊
        const authSignal =
          (apiErr &&
            /expired|过期|please.*log.*in|请重新登录|unauthorized|\b401\b/i.test(
              apiErr
            )) ||
          /token.*expired|请重新登录|\b401\b/i.test(tail);

        if (authSignal) {
          reject(
            new LarkCliError(
              "auth_expired",
              "飞书登录已过期,请在终端运行 `lark-cli auth login`",
              stderr
            )
          );
        } else {
          reject(
            new LarkCliError(
              "api_error",
              `lark-cli 退出码 ${code}: ${apiErr ?? tail}`,
              stderr
            )
          );
        }
        return;
      }
      resolve(stdout);
    });

    if (opts.stdin) {
      proc.stdin.write(opts.stdin);
    }
    proc.stdin.end();
  });
}

// 跑 lark-cli + JSON.parse stdout,失败包成 LarkCliError
export async function runLarkCliJson<T = unknown>(
  args: string[],
  opts?: { timeoutMs?: number; stdin?: string }
): Promise<T> {
  const stdout = await runLarkCli(args, opts);
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new LarkCliError("api_error", "lark-cli 输出为空");
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch (e) {
    throw new LarkCliError(
      "api_error",
      `lark-cli 输出非 JSON: ${trimmed.slice(0, 200)}`,
      String(e)
    );
  }
}
