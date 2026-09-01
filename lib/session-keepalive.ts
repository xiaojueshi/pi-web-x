/**
 * 会话滑动续期的前端保活。
 *
 * 服务端会话 TTL 为 24 小时且支持滑动续期：任何有效请求都会把过期
 * 时间向后重置。只要页面保持打开，前端定期 ping 轻量 /api/auth/status
 * 即可续期；页面从后台回到前台时也立即补一次，避免跨天返回已过期。
 * 关闭页面后不再续期，24 小时无活动会话自然过期（下次需要重新登录）。
 */

/** 保活间隔：远小于会话 TTL（24h），后台标签节流也不影响续期。 */
const KEEPALIVE_INTERVAL_MS = 60 * 60 * 1000;

/** 客户端认证状态事件名。 */
export const SESSION_AUTH_STATUS_EVENT = "pi-web-x:auth-status";

/** `/api/auth/status` 暴露给客户端的最小状态。 */
export interface SessionAuthStatus {
  /** 是否已完成首次密码设置。 */
  initialized: boolean;
  /** 当前浏览器会话是否有效。 */
  authenticated: boolean;
}

/**
 * 检查当前 Web Session；失效时通知认证墙接管界面。
 *
 * 网络错误保持静默，避免瞬时断网误判为退出登录。该函数只改变客户端
 * 认证视图，不会调用任何 Agent stop/abort API。
 *
 * @returns true 表示已认证，false 表示需重新认证，null 表示无法确认
 */
export async function checkSessionAuthentication(): Promise<boolean | null> {
  try {
    const response = await fetch("/api/auth/status", { cache: "no-store" });
    if (!response.ok) return null;
    const status = (await response.json()) as SessionAuthStatus;
    if (
      typeof status.initialized !== "boolean" ||
      typeof status.authenticated !== "boolean"
    ) {
      return null;
    }
    if (!status.initialized || !status.authenticated) {
      window.dispatchEvent(
        new CustomEvent<SessionAuthStatus>(SESSION_AUTH_STATUS_EVENT, {
          detail: status,
        }),
      );
      return false;
    }
    return true;
  } catch {
    return null;
  }
}

/**
 * 启动会话保活。页面保持打开期间调用（认证通过后才应启用）。
 * @returns 停止保活的清理函数
 */
export function startSessionKeepAlive(): () => void {
  const ping = () => {
    void checkSessionAuthentication();
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") ping();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  ping();
  const timer = setInterval(ping, KEEPALIVE_INTERVAL_MS);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
