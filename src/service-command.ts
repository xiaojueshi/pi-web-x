/**
 * `pi-web-x service` 子命令的执行层。
 *
 * 负责平台分派、已存在时的交互确认、服务定义文件的写入/删除与
 * systemctl / launchctl / schtasks 的命令调用。文件系统与进程调用都
 * 通过依赖注入（FileOps / CommandRunner），便于在其他平台单测。
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";

import {
  LAUNCHD_LABEL,
  SERVICE_NAME,
  buildEnvFileContent,
  buildLaunchdPlist,
  buildSystemdUnit,
  buildWindowsCreateArgs,
  buildWindowsDeleteArgs,
  buildWindowsQueryArgs,
  buildWindowsRunArgs,
  buildWindowsTaskCommand,
  launchdPlistPath,
  parseServiceArgs,
  platformServiceKind,
  serviceHelpText,
  systemdEnvFilePath,
  systemdUserUnitPath,
  windowsLogPath,
  type ServiceSnapshot,
} from "@/lib/service-config";

/** 文件系统操作抽象，默认实现走 node:fs，测试时可注入内存版。 */
export interface FileOps {
  /** 路径是否存在。 */
  exists(path: string): boolean;
  /** 递归创建目录（含父目录）。 */
  mkdir(path: string): void;
  /** 写入文件并设置权限（新文件生效）。 */
  writeFile(path: string, content: string, mode: number): void;
  /** 删除文件（不存在时静默）。 */
  rm(path: string): void;
}

/** 外部命令调用抽象，默认走 spawnSync，测试时可注入记录版。 */
export interface CommandRunner {
  /**
   * 同步执行命令。
   *
   * @param command 可执行文件
   * @param args 参数数组
   * @returns 退出码与输出
   */
  run(
    command: string,
    args: string[],
  ): { status: number; stdout: string; stderr: string };
}

/** 交互（stdin / stdout / stderr）抽象，测试时可注入假终端。 */
export interface Io {
  /** 当前是否交互式终端（决定可否提示确认）。 */
  isTTY(): boolean;
  /** 打印到标准输出。 */
  stdout(text: string): void;
  /** 打印到标准错误。 */
  stderr(text: string): void;
  /** 以 y/N 形式提问，返回是否确认。 */
  prompt(question: string): Promise<boolean>;
}

/** 实际文件系统实现，跟随 node:fs 语义。 */
export const fsFileOps: FileOps = {
  exists(path) {
    try {
      return existsSync(path);
    } catch {
      return false;
    }
  },
  mkdir(path) {
    try {
      mkdirSync(path, { recursive: true });
    } catch {
      // 目录已存在或不可创建时静默，后续写出会给出真实错误
    }
  },
  writeFile(path, content, mode) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, { mode });
    chmodSync(path, mode);
  },
  rm(path) {
    try {
      rmSync(path, { force: true });
    } catch {
      // 文件不存在等场景静默
    }
  },
};

/** 实际进程实现：Bun/Node 通用 spawnSync。 */
export const processCommandRunner: CommandRunner = {
  run(command, args) {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      windowsHide: true,
    });
    return {
      status: result.status ?? -1,
      stdout: typeof result.stdout === "string" ? result.stdout : "",
      stderr: typeof result.stderr === "string" ? result.stderr : "",
    };
  },
};

/**
 * 构造基于 node:readline 的真实交互终端。
 *
 * @returns Io 实现；stdout/stderr 直连进程输出，prompt 读 stdin
 */
export function terminalIo(): Io {
  return {
    isTTY() {
      return Boolean(process.stdin.isTTY && process.stdout.isTTY);
    },
    stdout(text) {
      process.stdout.write(text);
    },
    stderr(text) {
      process.stderr.write(text);
    },
    prompt(question) {
      return new Promise((resolve) => {
        const rl = createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        rl.question(`${question} (y/N) `, (answer) => {
          rl.close();
          resolve(/^(y|yes)$/i.test(answer.trim()));
        });
      });
    },
  };
}

/**
 * 解析服务将要启动的完整命令参数。
 *
 * 编译二进制为 [可执行文件]；通过 bun/node 解释器运行时把脚本路径一并
 * 固化（[解释器, 脚本]）并给出警告，提示改用发布二进制可获得自包含服务。
 *
 * @param execPath 当前可执行文件路径
 * @param argv 当前进程参数
 * @returns 启动命令参数数组
 */
export function resolveExecutableArgs(
  execPath = process.execPath,
  argv = process.argv,
): string[] {
  const name = basename(execPath).toLowerCase();
  const interpreterNames = new Set(["bun", "bun.exe", "node", "node.exe"]);
  if (interpreterNames.has(name) && argv.length > 1) {
    const scriptPath = resolve(argv[1]);
    process.stderr.write(
      `Warning: registering through the ${name} interpreter — the service will run "${execPath} ${scriptPath}".\n` +
        "For a self-contained system service, re-run after installing the compiled pi-web-x binary.\n",
    );
    return [execPath, scriptPath];
  }
  return [execPath];
}

/**
 * 判断服务是否已注册（按平台检查定义文件或计划任务存在性）。
 *
 * @param kind 平台服务类型
 * @param deps.files 文件操作
 * @param deps.runner 命令调用
 * @param deps.home 用户主目录（测试注入）
 * @returns 是否已注册
 */
export function isServiceRegistered(
  kind: "systemd" | "launchd" | "windows" | "unsupported",
  deps: {
    files: FileOps;
    runner: CommandRunner;
    home?: string;
  },
): boolean {
  const home = deps.home ?? homedir();
  if (kind === "systemd") {
    return deps.files.exists(systemdUserUnitPath(home));
  }
  if (kind === "launchd") {
    return deps.files.exists(launchdPlistPath(home));
  }
  if (kind === "windows") {
    return deps.runner.run("schtasks", buildWindowsQueryArgs()).status === 0;
  }
  return false;
}

/** 自动维护已注册服务时所需的最小文件操作集合。 */
export interface ServiceMaintenanceFileOps {
  /** 判断文件是否存在。 */
  exists(path: string): boolean;
  /** 读取 UTF-8 文本文件。 */
  readFile(path: string): string;
  /** 写入 UTF-8 文本文件。 */
  writeFile(path: string, content: string): void;
  /** 复制配置文件，并保留仅所有者可读写的权限。 */
  copyPrivateFile(source: string, destination: string): void;
}

/** 已注册服务自动维护的依赖项，供单测注入。 */
export interface ServiceRefreshDeps {
  /** 文件操作；缺省使用真实文件系统。 */
  files?: ServiceMaintenanceFileOps;
  /** 服务管理器命令调用；缺省使用真实进程。 */
  runner?: CommandRunner;
  /** 用户主目录；缺省使用当前用户主目录。 */
  home?: string;
  /** 平台服务类型；缺省自动探测。 */
  kind?: "systemd" | "launchd" | "windows" | "unsupported";
  /** 当前用户 UID，仅 launchd 使用。 */
  uid?: string;
}

/** 已注册服务自动维护的结果。 */
export interface ServiceRefreshResult {
  /** 是否检测到已注册服务。 */
  registered: boolean;
  /** 服务管理器种类。 */
  kind: "systemd" | "launchd" | "windows" | "unsupported";
}

const serviceMaintenanceFileOps: ServiceMaintenanceFileOps = {
  exists: existsSync,
  readFile(path) {
    return readFileSync(path, "utf8");
  },
  writeFile: writeFileSync,
  copyPrivateFile(source, destination) {
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
    chmodSync(destination, 0o600);
  },
};

/** 将 XML 文本节点内容转义，供 launchd plist 路径替换使用。 */
function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 执行服务管理器命令，失败时抛出带 stderr 的错误。 */
function runServiceMaintenanceCommand(
  runner: CommandRunner,
  command: string,
  args: string[],
  action: string,
): void {
  const result = runner.run(command, args);
  if (result.status !== 0) {
    throw new Error(
      `${action}失败：${result.stderr.trim() || result.stdout.trim() || `退出码 ${result.status}`}`,
    );
  }
}

/**
 * 在二进制更新后修复并重启已注册的用户级服务。
 *
 * 原地更新只重启原服务；安装根迁移时会同时更新 systemd/launchd 中固化的
 * 可执行路径。systemd 的旧配置快照会复制到新位置，保留端口、主机与密码。
 * Windows 的运行中 exe 无法原地替换，因此只在二进制已成功替换后重启任务。
 *
 * @param previousExecPath 更新前的二进制绝对路径
 * @param currentExecPath 更新后的二进制绝对路径
 * @param deps 可选的文件、命令和平台依赖
 * @returns 服务注册状态与平台类型
 * @throws 服务定义无法安全迁移，或重启/健康检查失败时抛出错误
 */
export function refreshRegisteredServiceAfterUpdate(
  previousExecPath: string,
  currentExecPath: string,
  deps: ServiceRefreshDeps = {},
): ServiceRefreshResult {
  const files = deps.files ?? serviceMaintenanceFileOps;
  const runner = deps.runner ?? processCommandRunner;
  const home = deps.home ?? homedir();
  const kind = deps.kind ?? platformServiceKind();
  const migrated = previousExecPath !== currentExecPath;

  if (kind === "unsupported") return { registered: false, kind };
  if (kind === "systemd") {
    const unitPath = systemdUserUnitPath(home);
    if (!files.exists(unitPath)) return { registered: false, kind };
    if (migrated) {
      const oldEnvPath = join(home, ".config", "pi-web-x", "env");
      const newEnvPath = systemdEnvFilePath(home);
      if (files.exists(oldEnvPath) && !files.exists(newEnvPath)) {
        files.copyPrivateFile(oldEnvPath, newEnvPath);
      }
      const unit = files.readFile(unitPath);
      if (!unit.includes(previousExecPath)) {
        throw new Error(`无法在 systemd unit 中找到旧二进制路径：${previousExecPath}`);
      }
      files.writeFile(
        unitPath,
        unit
          .replaceAll(previousExecPath, currentExecPath)
          .replaceAll(oldEnvPath, newEnvPath),
      );
      runServiceMaintenanceCommand(
        runner,
        "systemctl",
        ["--user", "daemon-reload"],
        "重载 systemd 用户单元",
      );
    }
    runServiceMaintenanceCommand(
      runner,
      "systemctl",
      ["--user", "restart", SERVICE_NAME],
      "重启 systemd 服务",
    );
    const status = runner.run("systemctl", [
      "--user",
      "is-active",
      SERVICE_NAME,
    ]);
    if (!/^active\b/.test(status.stdout)) {
      throw new Error(
        `systemd 服务重启后未保持 active：${status.stdout.trim() || status.stderr.trim() || "未知状态"}`,
      );
    }
    return { registered: true, kind };
  }

  if (kind === "launchd") {
    const plistPath = launchdPlistPath(home);
    if (!files.exists(plistPath)) return { registered: false, kind };
    const uid = deps.uid ?? String(process.getuid?.() ?? 0);
    const domain = `gui/${uid}`;
    if (migrated) {
      const oldEntry = `<string>${escapeXmlText(previousExecPath)}</string>`;
      const newEntry = `<string>${escapeXmlText(currentExecPath)}</string>`;
      const plist = files.readFile(plistPath);
      if (!plist.includes(oldEntry)) {
        throw new Error(`无法在 LaunchAgent 中找到旧二进制路径：${previousExecPath}`);
      }
      files.writeFile(plistPath, plist.replace(oldEntry, newEntry));
      // 已加载的 job 不会自动读取修改后的 plist，需先卸载再加载。
      runner.run("launchctl", ["bootout", `${domain}/${LAUNCHD_LABEL}`]);
      runServiceMaintenanceCommand(
        runner,
        "launchctl",
        ["bootstrap", domain, plistPath],
        "重新加载 LaunchAgent",
      );
    }
    runServiceMaintenanceCommand(
      runner,
      "launchctl",
      ["kickstart", "-k", `${domain}/${LAUNCHD_LABEL}`],
      "重启 LaunchAgent",
    );
    runServiceMaintenanceCommand(
      runner,
      "launchctl",
      ["print", `${domain}/${LAUNCHD_LABEL}`],
      "检查 LaunchAgent 状态",
    );
    return { registered: true, kind };
  }

  if (!isServiceRegistered("windows", {
    files: {
      exists: files.exists,
      mkdir: () => undefined,
      writeFile: () => undefined,
      rm: () => undefined,
    },
    runner,
    home,
  })) {
    return { registered: false, kind };
  }
  // /End 在任务暂未运行时会失败；此时仍可直接 /Run，因此忽略该退出码。
  runner.run("schtasks", ["/End", "/TN", SERVICE_NAME]);
  runServiceMaintenanceCommand(
    runner,
    "schtasks",
    buildWindowsRunArgs(),
    "启动 Windows 计划任务",
  );
  return { registered: true, kind };
}

/**
 * 已存在服务时的覆盖决策：询问用户或依 force/no-input 直接裁定。
 *
 * @param registered 是否已存在
 * @param force --force 标志
 * @param noInput --no-input 标志
 * @param io 交互抽象
 * @returns 确认覆盖（true）、未确认（false）或终止安装（null，需提示用户先卸载）
 */
export async function decideOverwrite(
  registered: boolean,
  force: boolean,
  noInput: boolean,
  io: Io,
): Promise<boolean | null> {
  if (!registered) return true;
  if (force) return true;
  if (noInput || !io.isTTY()) {
    io.stderr(
      `${SERVICE_NAME} service is already registered.\n` +
        "Run `pi-web-x service install --force` to overwrite it, " +
        "or `pi-web-x service uninstall` to remove it first.\n",
    );
    return null;
  }
  return io.prompt(`${SERVICE_NAME} service is already registered. Overwrite?`);
}

/** systemd 用户级会话当前是否未启用 linger（登录自启但无登录不自启）。 */
function isLingerDisabled(home: string, runner: CommandRunner): boolean {
  const user = home.split("/").pop() ?? "";
  const result = runner.run("loginctl", [
    "show-user",
    user,
    "--property=Linger",
  ]);
  return !/Linger=yes/i.test(result.stdout);
}

/**
 * 安装 systemd 用户级服务。
 *
 * 步骤：写 unit → 写 0600 快照 → daemon-reload → enable → 尝试开启
 * linger（实现无登录自启）→ start。
 *
 * @param snapshot 配置快照
 * @param execArgs 启动命令参数（编译二进制为 [路径]；解释器为 [bun, 脚本]）
 * @param deps 文件/进程/交互依赖
 * @returns 0 成功；非 0 失败
 */
export function installSystemdService(
  snapshot: ServiceSnapshot,
  execArgs: string[],
  deps: {
    files: FileOps;
    runner: CommandRunner;
    io: Io;
    home?: string;
  },
): number {
  const home = deps.home ?? homedir();
  const unitPath = systemdUserUnitPath(home);
  const envPath = systemdEnvFilePath(home);
  deps.files.mkdir(dirname(unitPath));
  deps.files.writeFile(unitPath, buildSystemdUnit(execArgs, envPath), 0o644);
  deps.files.mkdir(dirname(envPath));
  deps.files.writeFile(envPath, buildEnvFileContent(snapshot), 0o600);

  const reload = deps.runner.run("systemctl", ["--user", "daemon-reload"]);
  if (reload.status !== 0) {
    deps.io.stderr(
      `Failed to reload systemd user units: ${reload.stderr.trim()}\n`,
    );
    return 1;
  }
  const enable = deps.runner.run("systemctl", [
    "--user",
    "enable",
    SERVICE_NAME,
  ]);
  if (enable.status !== 0) {
    deps.io.stderr(
      `Failed to enable the service for autostart: ${enable.stderr.trim()}\n`,
    );
    return 1;
  }
  deps.io.stdout(`Enabled for autostart via systemctl --user.\n`);

  // 无登录自启：linger 未开启则尝试开启；loginctl 不可用（容器等）时降级为提示
  if (isLingerDisabled(home, deps.runner)) {
    const user = home.split("/").pop() ?? "";
    const linger = deps.runner.run("loginctl", ["enable-linger", user]);
    if (linger.status === 0) {
      deps.io.stdout(
        "Enabled loginctl linger: the service will also start without a login session.\n",
      );
    } else {
      deps.io.stderr(
        "Note: the service autostarts at login. For login-less autostart, run:\n" +
          `  loginctl enable-linger ${user}\n`,
      );
    }
  }

  const start = deps.runner.run("systemctl", ["--user", "start", SERVICE_NAME]);
  if (start.status !== 0) {
    deps.io.stderr(
      `Failed to start the service: ${start.stderr.trim()}\n` +
        "If this is an SSH session without a systemd user bus, run it from a login session.\n",
    );
    return 1;
  }
  // systemctl start 对 Type=simple 只保证 exec 成功，进程可能随即因端口占用等失败；
  // 探测一次活性，非 active 时提示查日志而不是静默返回成功
  const active = deps.runner.run("systemctl", [
    "--user",
    "is-active",
    SERVICE_NAME,
  ]);
  if (!/^active\b/.test(active.stdout)) {
    deps.io.stderr(
      `Note: the service did not stay active after start (${active.stdout.trim() || "unknown state"}).\n` +
        `  Check its status:   systemctl --user status ${SERVICE_NAME}\n` +
        `  Follow the logs:    journalctl --user -u ${SERVICE_NAME} -f\n`,
    );
    return 1;
  }
  deps.io.stdout(
    `System service "${SERVICE_NAME}" installed and started (http://${snapshot.hostname}:${snapshot.port}).\n` +
      `  unit:   ~/.config/systemd/user/${SERVICE_NAME}.service\n` +
      `  config: ${envPath}\n` +
      `  logs:   journalctl --user -u ${SERVICE_NAME}\n`,
  );
  // ADR 0006：旧 env 快照路径 ~/.config/pi-web-x/env 已在本次安装中被新路径取代；
  // 旧文件保留（含此前手动写入的密码），提示用户自行清理或迁移。
  if (deps.files.exists(join(home, ".config", "pi-web-x", "env"))) {
    deps.io.stderr(
      "Note: legacy env snapshot at ~/.config/pi-web-x/env was superseded by " +
        `${envPath}; the old file is kept — remove it manually if no longer needed.\n`,
    );
  }
  return 0;
}

/**
 * 安装 macOS launchd 服务（LaunchAgent）。
 *
 * 步骤：写 plist（0600）→ bootout 旧实例（覆盖场景）→ bootstrap → kickstart。
 *
 * @param snapshot 配置快照
 * @param execArgs 启动命令参数（编译二进制为 [路径]；解释器为 [bun, 脚本]）
 * @param deps 文件/进程/交互依赖
 * @returns 0 成功；非 0 失败
 */
export function installLaunchdService(
  snapshot: ServiceSnapshot,
  execArgs: string[],
  deps: {
    files: FileOps;
    runner: CommandRunner;
    io: Io;
    home?: string;
  },
): number {
  const home = deps.home ?? homedir();
  const plistPath = launchdPlistPath(home);
  const uid = String(process.getuid?.() ?? 0);
  // 覆盖场景判定必须在写文件之前：写完后 plist 必然存在，会误判为已注册
  const registered = isServiceRegistered("launchd", {
    files: deps.files,
    runner: deps.runner,
    home,
  });
  deps.files.mkdir(dirname(plistPath));
  deps.files.writeFile(
    plistPath,
    buildLaunchdPlist(execArgs, snapshot, home),
    0o600,
  );

  if (registered) {
    // 覆盖场景：先卸载已加载的 job，失败可忽略（未必已加载）
    deps.runner.run("launchctl", ["bootout", `gui/${uid}/${LAUNCHD_LABEL}`]);
  }
  const bootstrap = deps.runner.run("launchctl", [
    "bootstrap",
    `gui/${uid}`,
    plistPath,
  ]);
  if (bootstrap.status !== 0) {
    deps.io.stderr(
      `Failed to load the LaunchAgent: ${bootstrap.stderr.trim()}\n`,
    );
    return 1;
  }
  deps.runner.run("launchctl", ["kickstart", `gui/${uid}/${LAUNCHD_LABEL}`]);
  deps.io.stdout(
    `System service "${SERVICE_NAME}" installed and started (http://${snapshot.hostname}:${snapshot.port}).\n` +
      `  agent:  ${plistPath}\n` +
      `  logs:   ~/Library/Logs/pi-web-x.out.log\n` +
      "  stop:   launchctl bootout gui/$(id -u)/com.pi-web-x\n",
  );
  return 0;
}

/**
 * 安装 Windows 计划任务（ONLOGON）。
 *
 * 步骤：建日志目录 → schtasks create（/F 覆盖）→ run。
 *
 * @param snapshot 配置快照
 * @param execArgs 启动命令参数（编译二进制为 [路径]；解释器为 [bun, 脚本]）
 * @param deps 文件/进程/交互依赖
 * @returns 0 成功；非 0 失败
 */
export function installWindowsService(
  snapshot: ServiceSnapshot,
  execArgs: string[],
  deps: {
    files: FileOps;
    runner: CommandRunner;
    io: Io;
    home?: string;
  },
): number {
  const home = deps.home ?? homedir();
  const logPath = windowsLogPath(home);
  deps.files.mkdir(dirname(logPath));
  const taskCommand = buildWindowsTaskCommand(execArgs, snapshot, logPath);
  if (snapshot.password !== undefined) {
    deps.io.stderr(
      "Warning: PI_WEB_X_PASSWORD is stored in plaintext in the scheduled task definition.\n",
    );
  }
  const create = deps.runner.run(
    "schtasks",
    buildWindowsCreateArgs(taskCommand),
  );
  if (create.status !== 0) {
    deps.io.stderr(
      `Failed to create the scheduled task: ${create.stderr.trim()}\n`,
    );
    return 1;
  }
  const run = deps.runner.run("schtasks", buildWindowsRunArgs());
  if (run.status !== 0) {
    deps.io.stderr(`Failed to start the task: ${run.stderr.trim()}\n`);
    return 1;
  }
  deps.io.stdout(
    `System service "${SERVICE_NAME}" installed and started (http://${snapshot.hostname}:${snapshot.port}).\n` +
      `  task:   ${SERVICE_NAME} (Task Scheduler, ONLOGON autostart)\n` +
      `  logs:   ${logPath}\n` +
      "  note:   logs are redirected at task start; there is no crash-restart on Windows.\n",
  );
  return 0;
}

/**
 * 卸载 systemd 用户级服务（停止 → 禁用 → 删 unit → 重载），保留配置快照。
 *
 * @param deps 文件/进程/交互依赖
 * @returns 0 成功；非 0 失败
 */
export function uninstallSystemdService(deps: {
  files: FileOps;
  runner: CommandRunner;
  io: Io;
  home?: string;
}): number {
  const home = deps.home ?? homedir();
  const unitPath = systemdUserUnitPath(home);
  deps.runner.run("systemctl", ["--user", "stop", SERVICE_NAME]);
  deps.runner.run("systemctl", ["--user", "disable", SERVICE_NAME]);
  deps.files.rm(unitPath);
  deps.runner.run("systemctl", ["--user", "daemon-reload"]);
  deps.io.stdout(
    `System service "${SERVICE_NAME}" removed. The config file ${systemdEnvFilePath(home)} was kept.\n`,
  );
  return 0;
}

/**
 * 卸载 macOS launchd 服务（bootout → 删 plist）。
 *
 * @param deps 文件/进程/交互依赖
 * @returns 0 成功；非 0 失败
 */
export function uninstallLaunchdService(deps: {
  files: FileOps;
  runner: CommandRunner;
  io: Io;
  home?: string;
}): number {
  const home = deps.home ?? homedir();
  const uid = String(process.getuid?.() ?? 0);
  const registered = isServiceRegistered("launchd", {
    files: deps.files,
    runner: deps.runner,
    home,
  });
  if (registered) {
    deps.runner.run("launchctl", ["bootout", `gui/${uid}/${LAUNCHD_LABEL}`]);
  }
  deps.files.rm(launchdPlistPath(home));
  deps.io.stdout(`System service "${SERVICE_NAME}" removed.\n`);
  return 0;
}

/**
 * 卸载 Windows 计划任务（End → Delete，force）。
 *
 * @param deps 文件/进程/交互依赖
 * @returns 0 成功；非 0 失败
 */
export function uninstallWindowsService(deps: {
  files: FileOps;
  runner: CommandRunner;
  io: Io;
  home?: string;
}): number {
  deps.runner.run("schtasks", ["/End", "/TN", SERVICE_NAME]);
  const result = deps.runner.run("schtasks", buildWindowsDeleteArgs());
  if (result.status !== 0) {
    deps.io.stderr(
      `Failed to delete the scheduled task: ${result.stderr.trim()}\n`,
    );
    return 1;
  }
  deps.io.stdout(`System service "${SERVICE_NAME}" removed.\n`);
  return 0;
}

/** 无可用服务管理器平台（如 musl/OpenRC Linux）的报错指引。 */
function unsupportedPlatformMessage(): string {
  return (
    `This platform has no supported service manager for ${SERVICE_NAME}.\n` +
    "Run it in the foreground instead:\n" +
    "  pi-web-x\n" +
    "For manual autostart on Linux without systemd (e.g. Alpine/OpenRC), see\n" +
    "  https://wiki.alpinelinux.org/wiki/Writing_Init_Scripts\n"
  );
}

/** runServiceCommand 的依赖注入集合（缺省全部用真实实现）。 */
export interface ServiceCommandDeps {
  /** 文件系统操作。 */
  files?: FileOps;
  /** 外部命令调用。 */
  runner?: CommandRunner;
  /** 交互。 */
  io?: Io;
  /** 平台服务类型（测试注入，覆盖 platformServiceKind() 检测）。 */
  kind?: "systemd" | "launchd" | "windows" | "unsupported";
  /** 可执行文件路径（测试注入，覆盖 process.execPath）。 */
  execPath?: string;
  /** 进程参数（测试注入）。 */
  argv?: string[];
  /** 用户主目录（测试注入）。 */
  home?: string;
}

/**
 * 按平台类型分发卸载逻辑。
 *
 * @param kind 平台服务类型
 * @param deps 文件/进程/交互依赖
 * @returns 进程退出码
 */
function uninstallByKind(
  kind: "systemd" | "launchd" | "windows",
  deps: { files: FileOps; runner: CommandRunner; io: Io; home: string },
): number {
  if (kind === "systemd") {
    return uninstallSystemdService(deps);
  }
  if (kind === "launchd") {
    return uninstallLaunchdService(deps);
  }
  return uninstallWindowsService(deps);
}

/**
 * 按平台类型分发安装逻辑。
 *
 * @param kind 平台服务类型
 * @param snapshot 配置快照
 * @param execArgs 启动命令参数
 * @param deps 文件/进程/交互依赖
 * @returns 进程退出码
 */
function installByKind(
  kind: "systemd" | "launchd" | "windows",
  snapshot: ServiceSnapshot,
  execArgs: string[],
  deps: { files: FileOps; runner: CommandRunner; io: Io; home: string },
): number {
  if (kind === "systemd") {
    return installSystemdService(snapshot, execArgs, deps);
  }
  if (kind === "launchd") {
    return installLaunchdService(snapshot, execArgs, deps);
  }
  return installWindowsService(snapshot, execArgs, deps);
}

/**
 * 执行 `pi-web-x service` 子命令。
 *
 * @param args argv 中 service 之后的参数
 * @param env 环境变量（配置快照来源）
 * @param deps 依赖注入（缺省用真实实现）
 * @returns 进程退出码
 */
export async function runServiceCommand(
  args: string[],
  env: Record<string, string | undefined> = process.env,
  deps: ServiceCommandDeps = {},
): Promise<number> {
  const files = deps.files ?? fsFileOps;
  const runner = deps.runner ?? processCommandRunner;
  const io = deps.io ?? terminalIo();
  const home = deps.home ?? homedir();
  const kind = deps.kind ?? platformServiceKind();

  let parsed;
  try {
    parsed = parseServiceArgs(args, env);
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  if (parsed.action === "help") {
    io.stdout(serviceHelpText());
    return 0;
  }

  if (kind === "unsupported") {
    io.stderr(unsupportedPlatformMessage());
    return 1;
  }
  if (parsed.action === "uninstall") {
    return uninstallByKind(kind, { files, runner, io, home });
  }

  const snapshot: ServiceSnapshot = {
    port: parsed.port,
    hostname: parsed.hostname,
    password: env.PI_WEB_X_PASSWORD,
  };
  const registered = isServiceRegistered(kind, { files, runner, home });
  const overwrite = await decideOverwrite(
    registered,
    parsed.force,
    parsed.noInput,
    io,
  );
  if (overwrite === null) return 1;
  if (overwrite === false) {
    io.stdout("Installation cancelled.\n");
    return 1;
  }

  const execArgs = resolveExecutableArgs(deps.execPath, deps.argv);
  return installByKind(kind, snapshot, execArgs, { files, runner, io, home });
}
