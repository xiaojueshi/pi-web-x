/**
 * service-command 执行层测试：平台分派、覆盖决策、命令序列与文件写入。
 *
 * 所有系统命令通过 fake runner 记录，文件系统用内存 Map，不触碰真实环境。
 */

import { test, expect } from "bun:test";
import type { CommandRunner, FileOps, Io } from "../../../src/service-command";
import {
  decideOverwrite,
  resolveExecutableArgs,
  runServiceCommand,
} from "../../../src/service-command";
import {
  SERVICE_NAME,
  systemdEnvFilePath,
  systemdUserUnitPath,
  launchdPlistPath,
} from "../../../lib/service-config";

const HOME = "/home/tester";

/** 内存版 FileOps，同时记录写入的 mode。 */
function memoryFileOps(): {
  ops: FileOps;
  files: Map<string, string>;
  modes: Map<string, number>;
} {
  const files = new Map<string, string>();
  const modes = new Map<string, number>();
  return {
    ops: {
      exists: (path) => files.has(path),
      mkdir: () => undefined,
      writeFile: (path, content, mode) => {
        files.set(path, content);
        modes.set(path, mode);
      },
      rm: (path) => {
        files.delete(path);
      },
    },
    files,
    modes,
  };
}

/** 记录型 CommandRunner；可按命令定制返回值。 */
function recordingRunner(
  overrides: Record<
    string,
    (args: string[]) => { status: number; stdout: string; stderr: string }
  > = {},
): {
  runner: CommandRunner;
  calls: Array<{ command: string; args: string[] }>;
} {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runner: CommandRunner = {
    run(command, args) {
      calls.push({ command, args });
      const override = overrides[command];
      if (override !== undefined) return override(args);
      return { status: 0, stdout: "", stderr: "" };
    },
  };
  return { runner, calls };
}

/** 收集输出的假终端；prompt 可预设答案，tty 可关闭。 */
function collectingIo(options: { tty?: boolean; answer?: boolean } = {}): {
  io: Io;
  stdout: string[];
  stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: Io = {
    isTTY: () => options.tty ?? true,
    stdout: (text) => {
      stdout.push(text);
    },
    stderr: (text) => {
      stderr.push(text);
    },
    prompt: async () => options.answer ?? true,
  };
  return { io, stdout, stderr };
}

test("decideOverwrite：注册状态 / force / no-input / 交互四象限", async () => {
  const io = collectingIo();
  expect(await decideOverwrite(false, false, false, io.io)).toBe(true);
  expect(await decideOverwrite(true, true, false, io.io)).toBe(true);
  expect(await decideOverwrite(true, false, true, io.io)).toBeNull();
  expect(
    await decideOverwrite(true, false, false, { ...io.io, isTTY: () => false }),
  ).toBeNull();
  expect(await decideOverwrite(true, false, false, io.io)).toBe(true);
  expect(
    await decideOverwrite(
      true,
      false,
      false,
      collectingIo({ answer: false }).io,
    ),
  ).toBe(false);
});

test("resolveExecutableArgs：编译二进制单元素，解释器固化脚本并警告", () => {
  const warned: string[] = [];
  const original = process.stderr.write;
  process.stderr.write = (text: string | Uint8Array) => {
    warned.push(String(text));
    return true;
  };
  let interpreterArgs: string[] = [];
  let binaryArgs: string[] = [];
  try {
    interpreterArgs = resolveExecutableArgs("/usr/bin/bun", [
      "/usr/bin/bun",
      "/app/cli.ts",
    ]);
    binaryArgs = resolveExecutableArgs("/opt/pi-web-x/pi-web-x", [
      "/opt/pi-web-x/pi-web-x",
    ]);
  } finally {
    process.stderr.write = original;
  }
  expect(binaryArgs).toEqual(["/opt/pi-web-x/pi-web-x"]);
  expect(interpreterArgs.length).toBe(2);
  expect(interpreterArgs[0]).toBe("/usr/bin/bun");
  expect(interpreterArgs[1]).toMatch(/cli\.ts$/);
  expect(warned.length).toBe(1);
  expect(warned[0]).toContain("interpreter");
});

test("help 输出到 stdout 且退出码 0", async () => {
  const { io } = collectingIo();
  const code = await runServiceCommand(
    ["--help"],
    {},
    {
      io,
      kind: "unsupported",
    },
  );
  expect(code).toBe(0);
});

test("无 systemd 平台给出手动指引并退出 1", async () => {
  const { io, stderr } = collectingIo();
  const code = await runServiceCommand(
    ["install"],
    {},
    {
      io,
      kind: "unsupported",
    },
  );
  expect(code).toBe(1);
  expect(stderr.join("")).toContain("no supported service manager");
});

test("systemd install：写 unit 与 0600 env、enable、linger、start 全流程", async () => {
  const mem = memoryFileOps();
  const { runner, calls } = recordingRunner({
    systemctl: (args) =>
      args[1] === "is-active"
        ? { status: 0, stdout: "active", stderr: "" }
        : { status: 0, stdout: "", stderr: "" },
    loginctl: () => ({ status: 0, stdout: "Linger=no", stderr: "" }),
  });
  const { io, stdout } = collectingIo();
  const code = await runServiceCommand(
    ["install", "-p", "8080", "-H", "0.0.0.0"],
    { PI_WEB_X_PASSWORD: "secret" },
    {
      files: mem.ops,
      runner,
      io,
      kind: "systemd",
      home: HOME,
      execPath: "/opt/pi-web-x/pi-web-x",
    },
  );
  expect(code).toBe(0);
  const unitPath = systemdUserUnitPath(HOME);
  const envPath = systemdEnvFilePath(HOME);
  expect(mem.files.has(unitPath)).toBe(true);
  expect(mem.files.get(unitPath)).toContain(
    'ExecStart="/opt/pi-web-x/pi-web-x" --no-open',
  );
  expect(mem.modes.get(unitPath)).toBe(0o644);
  expect(mem.files.get(envPath)).toBe(
    "PORT=8080\nPI_WEB_X_HOSTNAME=0.0.0.0\nPI_WEB_X_PASSWORD=secret\n",
  );
  expect(mem.modes.get(envPath)).toBe(0o600);
  const commands = calls.map(
    (call) => `${call.command} ${call.args.join(" ")}`,
  );
  expect(commands).toContain("systemctl --user daemon-reload");
  expect(commands).toContain(`systemctl --user enable ${SERVICE_NAME}`);
  expect(commands).toContain("loginctl show-user tester --property=Linger");
  expect(commands).toContain("loginctl enable-linger tester");
  expect(commands).toContain(`systemctl --user start ${SERVICE_NAME}`);
  expect(stdout.join("")).toContain(
    "installed and started (http://0.0.0.0:8080)",
  );
});

test("systemd install：linger 已开启时不再 enable-linger", async () => {
  const mem = memoryFileOps();
  const { runner, calls } = recordingRunner({
    systemctl: (args) =>
      args[1] === "is-active"
        ? { status: 0, stdout: "active", stderr: "" }
        : { status: 0, stdout: "", stderr: "" },
    loginctl: () => ({ status: 0, stdout: "Linger=yes", stderr: "" }),
  });
  const { io } = collectingIo();
  const code = await runServiceCommand(
    ["install"],
    {},
    {
      files: mem.ops,
      runner,
      io,
      kind: "systemd",
      home: HOME,
      execPath: "/opt/pi-web-x/pi-web-x",
    },
  );
  expect(code).toBe(0);
  expect(
    calls.some(
      (call) => call.command === "loginctl" && call.args[0] === "enable-linger",
    ),
  ).toBe(false);
});

test("systemd install：start 后非 active 时提示查日志并返回 1", async () => {
  const mem = memoryFileOps();
  const { runner } = recordingRunner({
    systemctl: (args) =>
      args[1] === "is-active"
        ? { status: 0, stdout: "failed", stderr: "" }
        : { status: 0, stdout: "", stderr: "" },
    loginctl: () => ({ status: 0, stdout: "Linger=yes", stderr: "" }),
  });
  const { io, stderr } = collectingIo();
  const code = await runServiceCommand(
    ["install"],
    {},
    {
      files: mem.ops,
      runner,
      io,
      kind: "systemd",
      home: HOME,
      execPath: "/opt/pi-web-x/pi-web-x",
    },
  );
  expect(code).toBe(1);
  expect(stderr.join("")).toContain("did not stay active");
  expect(stderr.join("")).toContain("journalctl");
});

test("systemd install：已注册 + no-input → 退出 1 且不覆盖", async () => {
  const mem = memoryFileOps();
  mem.files.set(systemdUserUnitPath(HOME), "[Unit]\n");
  const { runner } = recordingRunner();
  const { io, stderr } = collectingIo();
  const code = await runServiceCommand(
    ["install", "--no-input"],
    {},
    {
      files: mem.ops,
      runner,
      io,
      kind: "systemd",
      home: HOME,
      execPath: "/opt/pi-web-x/pi-web-x",
    },
  );
  expect(code).toBe(1);
  expect(stderr.join("")).toContain("already registered");
  expect(stderr.join("")).toContain("--force");
});

test("systemd install：已注册 + 交互拒绝 → 取消且退出 1", async () => {
  const mem = memoryFileOps();
  mem.files.set(systemdUserUnitPath(HOME), "[Unit]\n");
  const { runner } = recordingRunner();
  const { io } = collectingIo({ answer: false });
  const code = await runServiceCommand(
    ["install"],
    {},
    {
      files: mem.ops,
      runner,
      io,
      kind: "systemd",
      home: HOME,
      execPath: "/opt/pi-web-x/pi-web-x",
    },
  );
  expect(code).toBe(1);
  expect(mem.files.get(systemdUserUnitPath(HOME))).toBe("[Unit]\n");
});

test("systemd uninstall：stop → disable → 删 unit → reload，保留 env 快照", async () => {
  const mem = memoryFileOps();
  mem.files.set(systemdUserUnitPath(HOME), "[Unit]\n");
  mem.files.set(systemdEnvFilePath(HOME), "PORT=8080\n");
  const { runner, calls } = recordingRunner();
  const { io } = collectingIo();
  const code = await runServiceCommand(
    ["uninstall"],
    {},
    {
      files: mem.ops,
      runner,
      io,
      kind: "systemd",
      home: HOME,
    },
  );
  expect(code).toBe(0);
  const commands = calls.map(
    (call) => `${call.command} ${call.args.join(" ")}`,
  );
  expect(commands).toContain(`systemctl --user stop ${SERVICE_NAME}`);
  expect(commands).toContain(`systemctl --user disable ${SERVICE_NAME}`);
  expect(commands).toContain("systemctl --user daemon-reload");
  expect(mem.files.has(systemdUserUnitPath(HOME))).toBe(false);
  expect(mem.files.has(systemdEnvFilePath(HOME))).toBe(true);
});

test("launchd install：写 plist、bootstrap、kickstart", async () => {
  const mem = memoryFileOps();
  const { runner, calls } = recordingRunner();
  const { io } = collectingIo();
  const code = await runServiceCommand(
    ["install"],
    {},
    {
      files: mem.ops,
      runner,
      io,
      kind: "launchd",
      home: HOME,
      execPath: "/opt/pi-web-x/pi-web-x",
    },
  );
  expect(code).toBe(0);
  const plistPath = launchdPlistPath(HOME);
  expect(mem.files.has(plistPath)).toBe(true);
  expect(mem.modes.get(plistPath)).toBe(0o600);
  expect(mem.files.get(plistPath)).toContain("com.pi-web-x");
  const commands = calls.map(
    (call) => `${call.command} ${call.args.join(" ")}`,
  );
  expect(commands.some((c) => c.startsWith("launchctl bootstrap gui/"))).toBe(
    true,
  );
  expect(commands.some((c) => c.startsWith("launchctl kickstart gui/"))).toBe(
    true,
  );
  // 首次安装不触发 bootout
  expect(commands.some((c) => c.startsWith("launchctl bootout"))).toBe(false);
});

test("launchd install：已注册覆盖时先 bootout", async () => {
  const mem = memoryFileOps();
  mem.files.set(launchdPlistPath(HOME), "<plist/>");
  const { runner, calls } = recordingRunner();
  const { io } = collectingIo();
  const code = await runServiceCommand(
    ["install", "--force"],
    {},
    {
      files: mem.ops,
      runner,
      io,
      kind: "launchd",
      home: HOME,
      execPath: "/opt/pi-web-x/pi-web-x",
    },
  );
  expect(code).toBe(0);
  expect(
    calls.some(
      (call) => call.command === "launchctl" && call.args[0] === "bootout",
    ),
  ).toBe(true);
});

test("launchd uninstall：bootout 并删除 plist", async () => {
  const mem = memoryFileOps();
  mem.files.set(launchdPlistPath(HOME), "<plist/>");
  const { runner, calls } = recordingRunner();
  const { io } = collectingIo();
  const code = await runServiceCommand(
    ["uninstall"],
    {},
    {
      files: mem.ops,
      runner,
      io,
      kind: "launchd",
      home: HOME,
    },
  );
  expect(code).toBe(0);
  expect(
    calls.some(
      (call) => call.command === "launchctl" && call.args[0] === "bootout",
    ),
  ).toBe(true);
  expect(mem.files.has(launchdPlistPath(HOME))).toBe(false);
});

test("windows install：建日志目录、schtasks create + run、密码明文警告", async () => {
  const mem = memoryFileOps();
  const { runner, calls } = recordingRunner({
    schtasks: () => ({ status: 0, stdout: "", stderr: "" }),
  });
  const { io, stderr } = collectingIo();
  const code = await runServiceCommand(
    ["install"],
    { PI_WEB_X_PASSWORD: "plain" },
    {
      files: mem.ops,
      runner,
      io,
      kind: "windows",
      home: HOME,
      execPath: "C:\\pi-web-x.exe",
    },
  );
  expect(code).toBe(0);
  const create = calls.find((call) => call.args[0] === "/Create");
  expect(create).toBeDefined();
  expect(create!.args).toContain("/SC");
  expect(create!.args).toContain("ONLOGON");
  const trValue = create!.args[create!.args.indexOf("/TR") + 1];
  expect(trValue).toContain("cmd /c ");
  expect(stderr.join("")).toContain("plaintext");
  const run = calls.find((call) => call.args[0] === "/Run");
  expect(run).toBeDefined();
});

test("windows uninstall：End + Delete", async () => {
  const { runner, calls } = recordingRunner({
    schtasks: (args) =>
      args[0] === "/Query"
        ? { status: 0, stdout: "", stderr: "" }
        : { status: 0, stdout: "", stderr: "" },
  });
  const { io } = collectingIo();
  const code = await runServiceCommand(
    ["uninstall"],
    {},
    {
      runner,
      io,
      kind: "windows",
      home: HOME,
      files: memoryFileOps().ops,
    },
  );
  expect(code).toBe(0);
  expect(calls.some((call) => call.args[0] === "/End")).toBe(true);
  expect(calls.some((call) => call.args[0] === "/Delete")).toBe(true);
});

test("启动失败（systemctl start 非零）时返回 1 并给出提示", async () => {
  const mem = memoryFileOps();
  const { runner } = recordingRunner({
    systemctl: (args) =>
      args[1] === "start"
        ? {
            status: 1,
            stdout: "",
            stderr: "Failed to start the service: Connection refused",
          }
        : { status: 0, stdout: "", stderr: "" },
  });
  const { io, stderr } = collectingIo();
  const code = await runServiceCommand(
    ["install"],
    {},
    {
      files: mem.ops,
      runner,
      io,
      kind: "systemd",
      home: HOME,
      execPath: "/opt/pi-web-x/pi-web-x",
    },
  );
  expect(code).toBe(1);
  expect(stderr.join("")).toContain("login session");
});

test("service 参数解析错误输出可读消息并返回 1", async () => {
  const { io, stderr } = collectingIo();
  const code = await runServiceCommand(
    ["frobnicate"],
    {},
    {
      io,
      kind: "systemd",
    },
  );
  expect(code).toBe(1);
  expect(stderr.join("")).toContain("Unknown service action");
});
