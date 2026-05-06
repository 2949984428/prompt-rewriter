// prompt-rewriter/app/api/lark/auth-status/route.ts
//
// GET → 返回本机 lark-cli 的登录状态。前端用它给"导出到飞书"按钮决定 enable/disable。
//
// 输出三态:
//   - ok:可用(token 有效或 needs_refresh,refresh token 还活着)
//   - needs_login:必须 `lark-cli auth login`
//   - not_installed:lark-cli 不在 PATH
//
// 不抛 500:状态本身就是答案。
//
// 性能:每次刷新 detail-view 都会调一次,但 lark-cli auth status 是本地命令,
// ~100ms。无需缓存。

import { NextResponse } from "next/server";
import { runLarkCliJson, LarkCliError } from "@/lib/lark/cli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LarkAuthStatus = {
  appId?: string;
  brand?: string;
  identity?: string;
  userName?: string;
  userOpenId?: string;
  expiresAt?: string;
  refreshExpiresAt?: string;
  tokenStatus?: "valid" | "needs_refresh" | "expired" | string;
  scope?: string;
};

export type AuthStatusResponse = {
  status: "ok" | "needs_login" | "not_installed";
  user?: string;
  expiresAt?: string;
  refreshExpiresAt?: string;
  message?: string;
};

export async function GET(): Promise<Response> {
  try {
    const data = await runLarkCliJson<LarkAuthStatus>(["auth", "status"], {
      timeoutMs: 5_000,
    });

    // refresh token 也过 → 必须重新登录
    const refreshAlive =
      !data.refreshExpiresAt ||
      new Date(data.refreshExpiresAt).getTime() > Date.now();
    if (!refreshAlive) {
      return NextResponse.json<AuthStatusResponse>({
        status: "needs_login",
        user: data.userName,
        expiresAt: data.expiresAt,
        refreshExpiresAt: data.refreshExpiresAt,
        message: "refresh token 已过期",
      });
    }

    return NextResponse.json<AuthStatusResponse>({
      status: "ok",
      user: data.userName,
      expiresAt: data.expiresAt,
      refreshExpiresAt: data.refreshExpiresAt,
    });
  } catch (e) {
    if (e instanceof LarkCliError) {
      if (e.type === "not_installed") {
        return NextResponse.json<AuthStatusResponse>({
          status: "not_installed",
          message: e.message,
        });
      }
      if (e.type === "auth_expired") {
        return NextResponse.json<AuthStatusResponse>({
          status: "needs_login",
          message: e.message,
        });
      }
    }
    // 其他未知问题:也算 needs_login 给个保守提示
    return NextResponse.json<AuthStatusResponse>({
      status: "needs_login",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
