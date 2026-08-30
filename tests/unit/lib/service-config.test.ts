/**
 * service-config 纯函数的单元测试：服务定义生成、路径、参数解析。
 */

import { test, expect } from "bun:test";
import {
  DEFAULT_HOSTNAME,
  DEFAULT_PORT,
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
  macLogPath,
  platformServiceKind,
  serviceHelpText,
  systemdEnvFilePath,
  systemdUserUnitPath,
  windowsLogPath,
} from "../../../lib/service-config";

const HOME = "/home/tester";

test("systemd unit 固化了二进制路径、固定 --no-open 与 EnvironmentFile", () => {
  const envFile = systemdEnvFilePath(HOME);
  const unit = buildSystemdUnit(["/opt/pi-web-x/pi-web-x"], envFile);
  expect(unit).toContain('ExecStart="/opt/pi-web-x/pi-web-x" --no-open');
  expect(unit).toContain(`EnvironmentFile=-${envFile}`);
  expect(unit).toContain("Restart=on-failure");
  expect(unit).toContain("WantedBy=default.target");
  expect(unit).toContain("After=network.target");
  expect(unit).not.toContain("-p");
  expect(unit).not.toContain("PI_WEB_X_PASSWORD");
});

test("env 快照按环境变量命名写入，密码缺省时不出现", () => {
  const content = buildEnvFileContent({ port: 8080, hostname: "0.0.0.0" });
  expect(content).toBe("PORT=8080\nPI_WEB_X_HOSTNAME=0.0.0.0\n");
  const withPassword = buildEnvFileContent({
    port: 8080,
    hostname: "127.0.0.1",
    password: "s3cret",
  });
  expect(withPassword).toContain("PI_WEB_X_PASSWORD=s3cret");
});

test("launchd plist 内联快照参数、密码进 EnvironmentVariables、日志显式指定", () => {
  const plist = buildLaunchdPlist(
    ["/usr/local/bin/pi-web-x"],
    { port: 9000, hostname: "127.0.0.1", password: "pw&<x>" },
    HOME,
  );
  expect(plist).toContain(`<string>${LAUNCHD_LABEL}</string>`);
  expect(plist).toContain("<string>/usr/local/bin/pi-web-x</string>");
  expect(plist).toContain("<string>9000</string>");
  expect(plist).toContain("PI_WEB_X_PASSWORD");
  expect(plist).toContain("<string>pw&amp;&lt;x&gt;</string>");
  expect(plist).toContain("<key>RunAtLoad</key>");
  expect(plist).toContain("<key>KeepAlive</key>");
  expect(plist).toContain(`<string>${macLogPath(HOME, "out")}</string>`);
  expect(plist).toContain(`<string>${macLogPath(HOME, "err")}</string>`);
});

test("Windows 任务命令：cmd /c 包装 + 日志重定向 + 密码内联", () => {
  const logPath = windowsLogPath("C:\\Users\\tester");
  expect(logPath).toBe("C:\\Users\\tester\\.pi-web-x\\service.log");
  const plain = buildWindowsTaskCommand(
    ["C:\\pi-web-x.exe"],
    { port: 30141, hostname: "127.0.0.1" },
    logPath,
  );
  expect(plain).toContain("cmd /c ");
  expect(plain).toMatch(/\\"C:\\pi-web-x\.exe\\"/);
  expect(plain).toContain("--no-open -p 30141 -H 127.0.0.1");
  expect(plain).toMatch(
    />> \\"C:\\Users\\tester\\.pi-web-x\\service\.log\\" 2>&1/,
  );
  expect(plain).not.toContain("PI_WEB_X_PASSWORD");

  const withPassword = buildWindowsTaskCommand(
    ["C:\\pi-web-x.exe"],
    { port: 30141, hostname: "127.0.0.1", password: "p w" },
    logPath,
  );
  expect(withPassword).toContain("set PI_WEB_X_PASSWORD=");
  expect(withPassword).toContain('\\"p w\\"');
  expect(withPassword).toMatch(/^cmd \/c "/);
});

test("schtasks 参数数组固定服务名与动作", () => {
  expect(buildWindowsCreateArgs("/TR-value")).toEqual([
    "/Create",
    "/F",
    "/TN",
    SERVICE_NAME,
    "/SC",
    "ONLOGON",
    "/TR",
    "/TR-value",
  ]);
  expect(buildWindowsDeleteArgs()).toEqual([
    "/Delete",
    "/F",
    "/TN",
    SERVICE_NAME,
  ]);
  expect(buildWindowsRunArgs()).toEqual(["/Run", "/TN", SERVICE_NAME]);
  expect(buildWindowsQueryArgs()).toEqual(["/Query", "/TN", SERVICE_NAME]);
});

test("platformServiceKind 对 win32/darwin 固定映射", () => {
  expect(platformServiceKind("win32")).toBe("windows");
  expect(platformServiceKind("darwin")).toBe("launchd");
  // linux 分支取决于 /run/systemd/system 是否存在，只断言返回值合法
  const linuxKind = platformServiceKind("linux");
  expect(["systemd", "unsupported"]).toContain(linuxKind);
});

test("parseServiceArgs：install 快照参数与默认值", () => {
  expect(parseServiceArgs(["install"], {})).toEqual({
    action: "install",
    port: DEFAULT_PORT,
    hostname: DEFAULT_HOSTNAME,
    force: false,
    noInput: false,
  });
  expect(
    parseServiceArgs(
      ["install", "-p", "8080", "-H", "0.0.0.0", "--force", "--no-input"],
      {},
    ),
  ).toEqual({
    action: "install",
    port: 8080,
    hostname: "0.0.0.0",
    force: true,
    noInput: true,
  });
  expect(
    parseServiceArgs(["install"], {
      PORT: "9000",
      PI_WEB_X_HOSTNAME: "10.0.0.2",
    }),
  ).toMatchObject({
    port: 9000,
    hostname: "10.0.0.2",
  });
  // 命令行参数优先于环境变量（与主 CLI 语义一致）
  expect(
    parseServiceArgs(["install", "-p", "8080", "-H", "0.0.0.0"], {
      PORT: "9000",
      PI_WEB_X_HOSTNAME: "10.0.0.2",
    }),
  ).toMatchObject({ port: 8080, hostname: "0.0.0.0" });
});

test("parseServiceArgs：uninstall 不接受 -p/-H，且 --no-input 可用", () => {
  expect(parseServiceArgs(["uninstall", "--no-input"], {})).toMatchObject({
    action: "uninstall",
    noInput: true,
  });
  expect(() => parseServiceArgs(["uninstall", "-p", "8080"], {})).toThrow(
    /Unexpected argument/,
  );
});

test("parseServiceArgs：帮助与错误路径", () => {
  expect(parseServiceArgs(["--help"], {})).toMatchObject({ action: "help" });
  expect(parseServiceArgs(["install", "--help"], {})).toMatchObject({
    action: "help",
  });
  expect(() => parseServiceArgs(["install", "-p", "abc"], {})).toThrow(
    /non-negative integer/,
  );
  expect(() => parseServiceArgs(["install", "-p", "70000"], {})).toThrow(
    /65535/,
  );
  expect(() => parseServiceArgs(["install", "-H"], {})).toThrow(
    /Missing value/,
  );
  expect(() => parseServiceArgs([], {})).toThrow(/Missing action/);
  expect(() => parseServiceArgs(["restart"], {})).toThrow(
    /Unknown service action/,
  );
  expect(() => parseServiceArgs(["install", "--bogus"], {})).toThrow(
    /Unexpected argument/,
  );
});

test("serviceHelpText 覆盖核心内容", () => {
  const text = serviceHelpText();
  expect(text).toContain("Usage: pi-web-x service");
  expect(text).toContain("install");
  expect(text).toContain("uninstall");
  expect(text).toContain("--force");
  expect(text).toContain("PI_WEB_X_PASSWORD");
  expect(text).toContain("systemd");
  expect(text).toContain("launchd");
  expect(text).toContain("ONLOGON");
});

test("路径函数符合平台约定", () => {
  expect(systemdUserUnitPath(HOME)).toBe(
    `${HOME}/.config/systemd/user/${SERVICE_NAME}.service`,
  );
  expect(launchdPlistPath(HOME)).toBe(
    `${HOME}/Library/LaunchAgents/${LAUNCHD_LABEL}.plist`,
  );
});
