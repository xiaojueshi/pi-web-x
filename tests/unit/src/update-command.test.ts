import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  getPlatformAssetName,
  releaseDownloadUrl,
  replaceCurrentBinary,
  runAssetsCommand,
  runUpdateCommand,
} from "../../../src/update-command";
import { APP_VERSION } from "../../../src/version";

/** 临时可执行文件根（模拟二进制所在目录）。 */
function makeExecRoot(): string {
  const root = resolve(
    import.meta.dir,
    "../../.tmp",
    `update-${Math.random().toString(36).slice(2)}`,
  );
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  return root;
}

function collectOutput(): { messages: string[]; out: (m: string) => void } {
  const messages: string[] = [];
  return {
    messages,
    out: (m) => {
      messages.push(m);
    },
  };
}

test("getPlatformAssetName：darwin/windows 资产名正确", () => {
  expect(getPlatformAssetName("darwin", "x64")).toBe("pi-web-x-darwin-x64");
  expect(getPlatformAssetName("darwin", "arm64")).toBe(
    "pi-web-x-darwin-arm64",
  );
  expect(getPlatformAssetName("win32", "x64")).toBe(
    "pi-web-x-windows-x64.exe",
  );
  expect(getPlatformAssetName("linux", "x64")).toBe("pi-web-x-linux-x64");
  expect(getPlatformAssetName("freebsd", "x64")).toBeNull();
  expect(getPlatformAssetName("linux", "ia32")).toBeNull();
});

test("releaseDownloadUrl：默认 GitHub 路径与镜像覆盖", () => {
  expect(releaseDownloadUrl("0.9.0", "pi-web-x-linux-x64", {})).toBe(
    "https://github.com/xiaojueshi/pi-web-x/releases/download/v0.9.0/pi-web-x-linux-x64",
  );
  expect(
    releaseDownloadUrl("0.9.0", "pi-web-x-linux-x64", {
      PI_WEB_X_RELEASE_BASE: "https://mirror.example/rel",
    }),
  ).toBe("https://mirror.example/rel/v0.9.0/pi-web-x-linux-x64");
});

test("runUpdateCommand：help 直接返回并打印用法", async () => {
  const { messages, out } = collectOutput();
  const code = await runUpdateCommand(["--help"], { out });
  expect(code).toBe(0);
  expect(messages.join("\n")).toContain("pi-web-x update");
});

test("runUpdateCommand：开发模式（非二进制）给出明确提示", async () => {
  const { messages, out } = collectOutput();
  const code = await runUpdateCommand([], { out });
  expect(code).toBe(1);
  expect(messages.join("\n")).toContain("开发模式");
});

test("runUpdateCommand：无新版本时 --check 返回 0 并提示已是最新", async () => {
  const { messages, out } = collectOutput();
  const fakeFetch = (async (url: string | URL | Request) => {
    expect(String(url)).toContain("releases/latest");
    return new Response(
      JSON.stringify({ tag_name: `v${APP_VERSION}` }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;

  const code = await runUpdateCommand(["--check"], {
    out,
    isBinary: () => true,
    fetchFn: fakeFetch,
  });
  expect(code).toBe(0);
  expect(messages.join("\n")).toContain("已是最新");
});

test("runUpdateCommand：完整更新流——下载→校验→备份→替换", async () => {
  const root = makeExecRoot();
  const execPath = join(root, "pi-web-x");
  // 预置「当前二进制」内容
  writeFileSync(execPath, "old-binary-bytes");

  const newBytes = "new-binary-bytes-v999";
  const newSha = createHash("sha256").update(newBytes).digest("hex");
  const platformAsset = "pi-web-x-linux-x64";

  const fakeFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/latest")) {
      return new Response(JSON.stringify({ tag_name: "v9.9.9" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/SHA256SUMS")) {
      return new Response(`${newSha}  ${platformAsset}\n`, { status: 200 });
    }
    if (url.endsWith(`/v9.9.9/${platformAsset}`)) {
      return new Response(newBytes, { status: 200 });
    }
    throw new Error(`unexpected url: ${url}`);
  }) as unknown as typeof fetch;

  const { messages, out } = collectOutput();
  const code = await runUpdateCommand([], {
    execPath,
    out,
    isBinary: () => true,
    fetchFn: fakeFetch,
  });

  expect(code).toBe(0);
  const joined = messages.join("\n");
  expect(joined).toContain("发现新版本");
  expect(joined).toContain("更新完成");
  // 新二进制已替换到位
  expect(readFileSync(execPath, "utf8")).toBe("new-binary-bytes-v999");
  // 旧二进制备份存在
  expect(existsSync(join(root, `pi-web-x.bak.9.9.9`))).toBe(true);
  expect(readFileSync(join(root, "pi-web-x.bak.9.9.9"), "utf8")).toBe(
    "old-binary-bytes",
  );
});

test("runUpdateCommand：SHA256SUMS 缺失条目时中止", async () => {
  const root = makeExecRoot();
  const execPath = join(root, "pi-web-x");
  writeFileSync(execPath, "old");

  const fakeFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/latest")) {
      return new Response(JSON.stringify({ tag_name: "v9.9.9" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/SHA256SUMS")) {
      return new Response("", { status: 200 });
    }
    return new Response("bytes", { status: 200 });
  }) as unknown as typeof fetch;

  const { messages, out } = collectOutput();
  const code = await runUpdateCommand([], {
    execPath,
    out,
    isBinary: () => true,
    fetchFn: fakeFetch,
  });
  expect(code).toBe(1);
  expect(messages.join("\n")).toContain("SHA256SUMS 中未找到");
});

test("replaceCurrentBinary：单独替换也产生备份", () => {
  const root = makeExecRoot();
  const execPath = join(root, "pi-web-x");
  const staged = join(root, "new");
  writeFileSync(execPath, "old");
  writeFileSync(staged, "new-content");

  const backup = replaceCurrentBinary(staged, "9.9.9", { execPath });
  expect(readFileSync(execPath, "utf8")).toBe("new-content");
  expect(existsSync(backup)).toBe(true);
  expect(readFileSync(backup, "utf8")).toBe("old");
});

test("runAssetsCommand：缺失资产报状态并给修复指引", async () => {
  const root = makeExecRoot();
  const { messages, out } = collectOutput();
  const code = await runAssetsCommand(["status"], {
    execPath: join(root, "missing", "pi-web-x"),
    out,
  });
  expect(code).toBe(1);
  expect(messages.join("\n")).toContain("缺失或校验不通过");
});

test("runAssetsCommand：install 不存在的包路径友好失败", async () => {
  const root = makeExecRoot();
  const { messages, out } = collectOutput();
  const code = await runAssetsCommand(
    ["install", join(root, "no-such.tar.gz")],
    { execPath: join(root, "pi-web-x"), out },
  );
  expect(code).toBe(1);
  expect(messages.join("\n")).toContain("资产安装失败");
});