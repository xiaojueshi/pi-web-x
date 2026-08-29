/**
 * 端口占用时的友好提示与 pi-web-x 实例探测。
 *
 * 这些函数在启动失败（端口被占用）时使用，用于替代 Bun 打印的
 * 无意义的编译后堆栈，为使用者给出可执行的下一步指引。
 */

/** 首页 HTML 中的标识文本，用于识别端口上的服务是否为 pi-web-x。 */
const PI_WEB_X_PAGE_MARKER = "Pi Web X";

/** 探测超时（毫秒），避免拖慢启动失败反馈。 */
const PROBE_TIMEOUT_MS = 800;

/**
 * 探测指定地址是否已有 pi-web-x 实例在运行。
 *
 * 通过请求首页并匹配标识文本实现；连接失败、超时或内容不匹配
 * 一律视为「不是 pi-web-x」，避免在启动失败路径上二次抛错。
 *
 * @param hostname 服务绑定地址（0.0.0.0 / :: 等通配地址会映射到 127.0.0.1 探测）
 * @param port 服务端口
 * @returns 是否已有 pi-web-x 实例在占用该端口
 */
export async function isPiWebXRunning(
  hostname: string,
  port: number,
): Promise<boolean> {
  // 通配绑定地址无法作为目标发起请求，统一改用 loopback 探测
  const probeHost = ["0.0.0.0", "::", "[::]", "::1", "[::1]"].includes(
    hostname,
  )
    ? "127.0.0.1"
    : hostname;
  try {
    const url = new URL(`http://${probeHost}:${port}/`);
    const response = await fetch(url, {
      headers: { Accept: "text/html" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const body = await response.text();
    return body.includes(PI_WEB_X_PAGE_MARKER);
  } catch {
    return false;
  }
}

/**
 * 生成端口被占用时的友好提示文本。
 *
 * @param options.hostname 服务绑定地址（仅用于展示）
 * @param options.port 被占用的端口
 * @param options.isPiWebX 占用者是否已是 pi-web-x 实例
 * @returns 多行提示文本，包含换端口建议与当前平台的查进程命令
 */
export function formatPortInUseHint(options: {
  hostname: string;
  port: number;
  isPiWebX: boolean;
}): string {
  const { hostname, port, isPiWebX } = options;
  let findCommand: string;
  let stopCommand: string;
  if (process.platform === "win32") {
    // Windows 用 netstat 查 PID，taskkill 结束进程
    findCommand = `netstat -ano | findstr :${port}`;
    stopCommand = "taskkill /PID <PID> /F";
  } else if (process.platform === "darwin") {
    // macOS 标配 lsof，直接按端口反查 PID
    findCommand = `lsof -nP -i :${port}`;
    stopCommand = "kill <PID>";
  } else {
    // Linux 优先用 iproute2 的 ss（无需 root 也能看到进程名）
    findCommand = `ss -tlnp | grep ":${port}"`;
    stopCommand = "kill <PID>";
  }
  return [
    `Error: Port ${port} is already in use.`,
    isPiWebX
      ? `Another pi-web-x instance is already running on http://${hostname}:${port}.`
      : `Another program is already listening on http://${hostname}:${port}.`,
    "",
    "You can:",
    `  1. Use a different port:       pi-web-x -p ${port + 1}   (or PORT=${port + 1})`,
    "  2. Find and stop the process occupying the port:",
    `       ${findCommand}      # find the PID`,
    `       ${stopCommand}                      # stop it`,
  ].join("\n");
}