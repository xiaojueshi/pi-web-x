import { startServer } from "@/src/server";
import { runServiceCommand } from "@/src/service-command";
import { formatPortInUseHint, isPiWebXRunning } from "@/lib/port-conflict";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

interface LaunchOptions {
  hostname: string;
  openBrowser: boolean;
  port: number;
}

/** 将环境布尔值解析为启用状态。 */
function isEnabled(value: string | undefined): boolean {
  return value !== undefined && TRUE_VALUES.has(value.trim().toLowerCase());
}

/** 解析并验证服务端口。 */
function parsePort(value: string): number {
  if (!/^\d+$/.test(value))
    throw new Error("Port must be a non-negative integer.");
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65535)
    throw new Error("Port must be between 0 and 65535.");
  return port;
}

/** 返回 pi-web-x CLI 帮助文本。 */
export function getHelpText(): string {
  return `Usage: pi-web-x [options]
       pi-web-x service <install|uninstall> [options]

Start the Pi Web X UI server.

Options:
  -p, --port <port>          Server port (default: 30141, or PORT)
  -H, --hostname <host>      Bind hostname (default: 127.0.0.1, or PI_WEB_X_HOSTNAME)
      --no-open              Do not open a browser automatically
  -h, --help                 Show this help message and exit

Service:
  service install            Register as an OS service and enable autostart
  service uninstall          Stop and remove the OS service
  service --help             Show service subcommand help

Environment:
  PORT                       Default port when --port is omitted
  PI_WEB_X_HOSTNAME          Default hostname when --hostname is omitted
  PI_WEB_X_NO_OPEN           Set to 1/true/yes/on to disable browser open
  PI_WEB_X_PASSWORD          Enable HTTP Basic Auth (username is always "pi")
  PI_WEB_X_ALLOWED_HOSTS     Extra exact proxy/custom hostnames, comma-separated
`;
}

/** 解析 CLI 参数，遇到未知参数或无效端口时抛出异常。 */
export function parseLaunchOptions(
  args = process.argv.slice(2),
  env = process.env,
): LaunchOptions | { help: true } | { service: true } {
  // service 子命令交给 src/service-command.ts 处理，主解析器不校验其参数
  if (args[0] === "service") return { service: true };
  let port = env.PORT ?? "30141";
  let hostname = env.PI_WEB_X_HOSTNAME ?? "127.0.0.1";
  let openBrowser = !isEnabled(env.PI_WEB_X_NO_OPEN);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--no-open") {
      openBrowser = false;
      continue;
    }
    if (arg === "-p" || arg === "--port") {
      const value = args[++index];
      if (!value)
        throw new Error(
          "Missing value for --port.\nUse --help to see available options.",
        );
      port = value;
      continue;
    }
    if (arg === "-H" || arg === "--hostname") {
      const value = args[++index];
      if (!value)
        throw new Error(
          "Missing value for --hostname.\nUse --help to see available options.",
        );
      hostname = value;
      continue;
    }
    throw new Error(
      `Unexpected argument: ${arg}\nUse --help to see available options.`,
    );
  }
  return { port: parsePort(port), hostname, openBrowser };
}

/** 在支持的平台异步打开浏览器，不影响服务本身生命周期。 */
function openBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? [process.env.ComSpec ?? "cmd.exe", "/c", "start", "", url]
        : ["xdg-open", url];
  const processHandle = Bun.spawn({
    cmd: command,
    stdout: "ignore",
    stderr: "ignore",
  });
  processHandle.exited.catch(() => undefined);
}

/**
 * 启动服务；启动失败时输出友好错误提示并返回 null。
 *
 * 端口被占用（EADDRINUSE）时先探测占用者是否已是 pi-web-x 实例，
 * 再给出换端口或查进程的可执行建议；其他错误只打印消息本身，
 * 避免输出编译后无意义的调用堆栈。
 *
 * @param options 启动选项（hostname / port / openBrowser）
 * @returns 成功时返回服务实例，失败时为 null（调用方应设置退出码）
 */
async function startServerWithFriendlyErrors(
  options: LaunchOptions,
): Promise<ReturnType<typeof startServer> | null> {
  try {
    return startServer(options);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    const isPortInUse =
      err.code === "EADDRINUSE" ||
      (error instanceof Error &&
        /in use|address already in use/i.test(error.message));
    if (isPortInUse) {
      const isPiWebX = await isPiWebXRunning(options.hostname, options.port);
      console.error(
        formatPortInUseHint({
          hostname: options.hostname,
          port: options.port,
          isPiWebX,
        }),
      );
    } else {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: Failed to start server. ${message}`);
    }
    return null;
  }
}

/** 启动 CLI 服务，并在需要时打开默认浏览器。 */
export async function main(): Promise<void> {
  let options: LaunchOptions | { help: true } | { service: true };
  try {
    options = parseLaunchOptions();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  if ("help" in options) {
    process.stdout.write(getHelpText());
    return;
  }
  if ("service" in options) {
    process.exitCode = await runServiceCommand(process.argv.slice(3));
    return;
  }
  if (!LOOPBACK_HOSTNAMES.has(options.hostname)) {
    const passwordEnabled = Boolean(process.env.PI_WEB_X_PASSWORD);
    console.warn(
      passwordEnabled
        ? `Warning: pi-web-x is listening on ${options.hostname} with Basic Auth over HTTP. Use HTTPS or a trusted VPN.`
        : `Warning: pi-web-x is listening on ${options.hostname} without authentication. Only use this on a trusted network.`,
    );
  }
  const server = await startServerWithFriendlyErrors(options);
  if (server === null) {
    process.exitCode = 1;
    return;
  }
  const url = `http://${options.hostname}:${server.port}`;
  console.log(`Pi Web X listening on ${url}`);
  if (options.openBrowser) openBrowser(url);
}

if (import.meta.main) void main();
