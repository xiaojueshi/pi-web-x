import { startServer } from "@/src/server";

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

Start the Pi Web X UI server.

Options:
  -p, --port <port>          Server port (default: 30141, or PORT)
  -H, --hostname <host>      Bind hostname (default: 127.0.0.1, or PI_WEB_X_HOSTNAME)
      --no-open              Do not open a browser automatically
  -h, --help                 Show this help message and exit

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
): LaunchOptions | { help: true } {
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

/** 启动 CLI 服务，并在需要时打开默认浏览器。 */
export function main(): void {
  let options: LaunchOptions | { help: true };
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
  if (!LOOPBACK_HOSTNAMES.has(options.hostname)) {
    const passwordEnabled = Boolean(process.env.PI_WEB_X_PASSWORD);
    console.warn(
      passwordEnabled
        ? `Warning: pi-web-x is listening on ${options.hostname} with Basic Auth over HTTP. Use HTTPS or a trusted VPN.`
        : `Warning: pi-web-x is listening on ${options.hostname} without authentication. Only use this on a trusted network.`,
    );
  }
  const server = startServer(options);
  const url = `http://${options.hostname}:${server.port}`;
  console.log(`Pi Web X listening on ${url}`);
  if (options.openBrowser) openBrowser(url);
}

if (import.meta.main) main();
