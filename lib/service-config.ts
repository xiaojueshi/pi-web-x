/**
 * pi-web-x 系统服务定义的纯构造函数。
 *
 * 本模块只做「字符串/路径/命令构造」与「平台判定」，不触碰文件系统与进程，
 * 便于在任意平台（含 CI）单测。实际的写入与执行在 `src/service-command.ts`。
 */

import { join, win32 } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";

/** 统一的系统服务名（systemd unit 名 / Windows 任务名）。 */
export const SERVICE_NAME = "pi-web-x";

/** macOS launchd 的 Label（域名风格）。 */
export const LAUNCHD_LABEL = "com.pi-web-x";

/** 默认服务端口，与主 CLI 一致。 */
export const DEFAULT_PORT = 30141;

/** 默认绑定地址，与主 CLI 一致。 */
export const DEFAULT_HOSTNAME = "127.0.0.1";

/**
 * 服务启动配置快照。
 *
 * 安装时把用户想要的 port / hostname / 密码固化下来，服务管理器
 * 以快照内容启动 pi-web-x，用户之后可直接编辑快照文件改配置。
 */
export interface ServiceSnapshot {
  /** 服务监听端口。 */
  port: number;
  /** 服务绑定地址。 */
  hostname: string;
  /** Basic Auth 密码；未设置时为 undefined。 */
  password?: string;
}

/** systemd 用户级 unit 文件路径。 */
export function systemdUserUnitPath(home = homedir()): string {
  return join(home, ".config", "systemd", "user", `${SERVICE_NAME}.service`);
}

/** systemd 用户级服务的配置快照（EnvironmentFile）路径。 */
export function systemdEnvFilePath(home = homedir()): string {
  return join(home, ".config", "pi-web-x", "env");
}

/** macOS LaunchAgent plist 路径。 */
export function launchdPlistPath(home = homedir()): string {
  return join(home, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

/**
 * macOS 日志文件路径（launchd 不收集 stdout，必须显式指定输出文件）。
 *
 * @param kind out（stdout）或 err（stderr）
 */
export function macLogPath(home = homedir(), kind: "out" | "err"): string {
  return join(home, "Library", "Logs", `pi-web-x.${kind}.log`);
}

/** Windows 上任务命令的标准输出重定向目标日志文件路径。 */
export function windowsLogPath(home = homedir()): string {
  // 用 win32 语义拼接，保证在任意平台（含跨平台单测）产出反斜杠分隔的路径
  return win32.join(home, ".pi-web-x", "service.log");
}

/**
 * 生成 systemd 用户级 unit 文件内容。
 *
 * port / hostname / 密码全部经 EnvironmentFile 注入（- 前缀容忍文件缺失），
 * ExecStart 固化启动命令（每个参数独立加引号）与固定参数 --no-open，
 * 用户改配置不需要动 unit 主体。
 *
 * @param execArgs 启动命令参数（编译二进制为 [二进制路径]；解释器为 [bun, 脚本]）
 * @param envFile 配置快照文件绝对路径
 * @returns unit 文件文本
 */
export function buildSystemdUnit(execArgs: string[], envFile: string): string {
  const quoted = execArgs.map((arg) => `"${arg}"`).join(" ");
  return [
    "[Unit]",
    "Description=Pi Web X web UI server",
    "After=network.target",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${quoted} --no-open`,
    "WorkingDirectory=%h",
    `EnvironmentFile=-${envFile}`,
    "Restart=on-failure",
    "RestartSec=2",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

/** 将文本转义为 XML 文本节点内容（plist 内嵌路径等）。 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 生成 macOS LaunchAgent plist 文件内容。
 *
 * 配置快照直接内联：port/hostname 进 ProgramArguments，密码进
 * EnvironmentVariables（plist 以 0600 权限落盘）。KeepAlive 让 launchd
 * 在进程退出后自动拉起，RunAtLoad 保证加载即启动。
 *
 * @param execArgs 启动命令参数（编译二进制为 [二进制路径]；解释器为 [bun, 脚本]）
 * @param snapshot 安装时的配置快照
 * @param home 用户主目录（用于 WorkingDirectory 与日志路径）
 * @returns plist 文件文本
 */
export function buildLaunchdPlist(
  execArgs: string[],
  snapshot: ServiceSnapshot,
  home = homedir(),
): string {
  const args = [
    ...execArgs,
    "--no-open",
    "-p",
    String(snapshot.port),
    "-H",
    snapshot.hostname,
  ];
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${LAUNCHD_LABEL}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...args.map((arg) => `    <string>${escapeXml(arg)}</string>`),
    "  </array>",
  ];
  if (snapshot.password !== undefined) {
    lines.push(
      "  <key>EnvironmentVariables</key>",
      "  <dict>",
      "    <key>PI_WEB_X_PASSWORD</key>",
      `    <string>${escapeXml(snapshot.password)}</string>`,
      "  </dict>",
    );
  }
  lines.push(
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <true/>",
    "  <key>WorkingDirectory</key>",
    `  <string>${escapeXml(home)}</string>`,
    "  <key>StandardOutPath</key>",
    `  <string>${escapeXml(macLogPath(home, "out"))}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${escapeXml(macLogPath(home, "err"))}</string>`,
    "</dict>",
    "</plist>",
    "",
  );
  return lines.join("\n");
}

/**
 * 生成 systemd 配置快照（EnvironmentFile）内容。
 *
 * 字段与主 CLI 的环境变量命名一致（PORT / PI_WEB_X_HOSTNAME /
 * PI_WEB_X_PASSWORD），password 缺省时不写入。
 *
 * @param snapshot 配置快照
 * @returns env 文件文本
 */
export function buildEnvFileContent(snapshot: ServiceSnapshot): string {
  const lines = [
    `PORT=${snapshot.port}`,
    `PI_WEB_X_HOSTNAME=${snapshot.hostname}`,
  ];
  if (snapshot.password !== undefined) {
    lines.push(`PI_WEB_X_PASSWORD=${snapshot.password}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * 将一段命令文本转义为 Windows cmd 的外层引号参数。
 *
 * 用于 schtasks /TR 内部嵌套引号场景，规则为外层引号配对、内部引号转义；
 * Windows 专项逻辑集中于此，方便将来按实测反馈调整。
 */
function quoteForCmd(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * 构造 Windows 计划任务的命令体（/TR 值）。
 *
 * 用法：`schtasks /Create /SC ONLOGON /TN pi-web-x /TR <返回值> /F`。
 * schtasks 无 stdout 收集能力，故用 cmd /c 包装并把输出重定向到日志文件；
 * 整个返回值作为一个参数传给 schtasks，嵌套引号统一转义。
 *
 * @param execArgs 启动命令参数（编译二进制为 [二进制路径]；解释器为 [bun, 脚本]）
 * @param snapshot 配置快照（Windows 上密码会以明文出现在任务定义中）
 * @param logPath 日志文件绝对路径
 * @returns /TR 值
 */
export function buildWindowsTaskCommand(
  execArgs: string[],
  snapshot: ServiceSnapshot,
  logPath = windowsLogPath(),
): string {
  const quotedArgs = execArgs.map((arg) => quoteForCmd(arg)).join(" ");
  const launch = [
    quotedArgs,
    "--no-open",
    "-p",
    String(snapshot.port),
    "-H",
    snapshot.hostname,
    ">>",
    quoteForCmd(logPath),
    "2>&1",
  ].join(" ");
  const passwordPrefix =
    snapshot.password !== undefined
      ? `set PI_WEB_X_PASSWORD=${quoteForCmd(snapshot.password)} && `
      : "";
  return `cmd /c ${quoteForCmd(passwordPrefix + launch)}`;
}

/**
 * 返回 Windows 计划任务的「创建并强制覆盖」命令参数数组，用于 spawnSync。
 *
 * @param taskCommand /TR 值（buildWindowsTaskCommand 的返回值）
 * @returns schtasks 参数数组
 */
export function buildWindowsCreateArgs(taskCommand: string): string[] {
  return [
    "/Create",
    "/F",
    "/TN",
    SERVICE_NAME,
    "/SC",
    "ONLOGON",
    "/TR",
    taskCommand,
  ];
}

/** 返回 Windows 计划任务的「删除」命令参数数组（force 清除已注册任务）。 */
export function buildWindowsDeleteArgs(): string[] {
  return ["/Delete", "/F", "/TN", SERVICE_NAME];
}

/** 返回 Windows 计划任务的「立即运行」命令参数数组。 */
export function buildWindowsRunArgs(): string[] {
  return ["/Run", "/TN", SERVICE_NAME];
}

/** 返回 Windows 计划任务的「查询」命令参数数组（存在性检测用）。 */
export function buildWindowsQueryArgs(): string[] {
  return ["/Query", "/TN", SERVICE_NAME];
}

/**
 * 判断当前系统是否为 systemd 管理的用户级会话。
 *
 * systemd 激活时会挂载 /run/systemd/system，容器与无 systemd 发行版没有该目录。
 */
export function systemdAvailable(): boolean {
  if (process.platform !== "linux") return false;
  try {
    return existsSync("/run/systemd/system");
  } catch {
    return false;
  }
}

/**
 * 各平台对应的系统服务注册机制。
 *
 * @param platform 运行平台（process.platform 取值）
 * @returns systemd（Linux 且有 systemd）/ launchd（macOS）/ windows / unsupported
 */
export function platformServiceKind(
  platform = process.platform,
): "systemd" | "launchd" | "windows" | "unsupported" {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "launchd";
  if (platform === "linux" && systemdAvailable()) return "systemd";
  return "unsupported";
}

/** service 子命令的解析结果。 */
export interface ServiceArgs {
  /** 动作：install / uninstall / help。 */
  action: "install" | "uninstall" | "help";
  /** 安装时快照的服务端口。 */
  port: number;
  /** 安装时快照的绑定地址。 */
  hostname: string;
  /** 跳过「已存在」交互确认，直接覆盖。 */
  force: boolean;
  /** 非交互模式：不读 stdin，遇需确认的场合直接报错。 */
  noInput: boolean;
}

/**
 * 解析 `pi-web-x service <action> [options]` 子命令参数。
 *
 * 解析失败时抛出带用户可读消息的 Error（不含调用堆栈语义）。
 *
 * @param args argv 中 service 之后的参数
 * @param env 环境变量（PORT / PI_WEB_X_HOSTNAME 提供默认快照）
 * @returns 解析结果
 * @throws 参数缺失、非法端口或未知参数时抛出 Error
 */
export function parseServiceArgs(
  args: string[],
  env: Record<string, string | undefined> = process.env,
): ServiceArgs {
  const [action, ...rest] = args;
  if (action === undefined) {
    throw new Error(
      "Missing action for service.\nUsage: pi-web-x service <install|uninstall> [options]\nUse --help to see available options.",
    );
  }
  if (action === "-h" || action === "--help") {
    return {
      action: "help",
      port: DEFAULT_PORT,
      hostname: DEFAULT_HOSTNAME,
      force: false,
      noInput: false,
    };
  }
  if (action !== "install" && action !== "uninstall") {
    throw new Error(
      `Unknown service action: ${action}\nUse --help to see available options.`,
    );
  }
  let port: number | undefined = undefined;
  let hostname: string | undefined = undefined;
  let force = false;
  let noInput = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "-h" || arg === "--help") {
      return {
        action: "help",
        port: 0,
        hostname: "",
        force,
        noInput,
      };
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--no-input") {
      noInput = true;
      continue;
    }
    if ((arg === "-p" || arg === "--port") && action === "install") {
      const value = rest[++index];
      if (value === undefined || !/^\d+$/.test(value)) {
        throw new Error("Port must be a non-negative integer.");
      }
      const parsedPort = Number(value);
      if (!Number.isSafeInteger(parsedPort) || parsedPort > 65535) {
        throw new Error("Port must be between 0 and 65535.");
      }
      port = parsedPort;
      continue;
    }
    if ((arg === "-H" || arg === "--hostname") && action === "install") {
      const value = rest[++index];
      if (value === undefined) {
        throw new Error(
          "Missing value for --hostname.\nUse --help to see available options.",
        );
      }
      hostname = value;
      continue;
    }
    throw new Error(
      `Unexpected argument: ${arg}\nUse --help to see available options.`,
    );
  }
  // 命令行参数优先，其次环境变量，最后默认值（与主 CLI 的 flag ?? env ?? default 一致）
  const resolvedPort = port ?? env.PORT ?? DEFAULT_PORT;
  if (!/^\d+$/.test(String(resolvedPort))) {
    throw new Error("Port must be a non-negative integer.");
  }
  const numericPort = Number(resolvedPort);
  if (!Number.isSafeInteger(numericPort) || numericPort > 65535) {
    throw new Error("Port must be between 0 and 65535.");
  }
  return {
    action,
    port: numericPort,
    hostname: hostname ?? env.PI_WEB_X_HOSTNAME ?? DEFAULT_HOSTNAME,
    force,
    noInput,
  };
}

/** 返回 `pi-web-x service --help` 的帮助文本。 */
export function serviceHelpText(): string {
  return `Usage: pi-web-x service <install|uninstall> [options]

Manage the pi-web-x system service (per-user, starts at login).

Commands:
  install       Register and start the pi-web-x system service
  uninstall     Stop and remove the pi-web-x system service

Options for install:
  -p, --port <port>          Service port snapshot (default: 30141, or PORT)
  -H, --hostname <host>      Bind hostname snapshot (default: 127.0.0.1, or PI_WEB_X_HOSTNAME)
      --force                Overwrite an existing service without asking
      --no-input             Never prompt; fail when confirmation is required

Options for uninstall:
      --no-input             Never prompt

Environment:
  PI_WEB_X_PASSWORD          Snapshot into the service config (username is "pi")

Platforms:
  Linux (systemd)   installs a per-user unit; no root required
  macOS (launchd)   installs a per-user LaunchAgent; no root required
  Windows (Task Scheduler)  registers an ONLOGON task
  Other Linux       unsupported (no systemd); see the error message for manual steps
`;
}
