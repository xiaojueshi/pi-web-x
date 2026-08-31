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

/**
 * 启动会话保活。页面保持打开期间调用（认证通过后才应启用）。
 * @returns 停止保活的清理函数
 */
export function startSessionKeepAlive(): () => void {
  const ping = () => {
    void fetch("/api/auth/status", { cache: "no-store" }).catch(() => {
      // 网络瞬断等场景忽略：保活失败不影响当前会话，
      // 后续定时器或回到前台时会再次尝试。
    });
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") ping();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  const timer = setInterval(ping, KEEPALIVE_INTERVAL_MS);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}