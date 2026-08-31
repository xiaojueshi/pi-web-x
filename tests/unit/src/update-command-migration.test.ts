import assert from "node:assert/strict";
import { test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateLegacyInstallRoot } from "../../../src/update-command";

// 迁移会把 HOME 下的 pi-web-x 搬到 .pi-web-x；用临时 HOME + 注入 execPath 验证。

function withTempHome(fn: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), "pi-web-migrate-test-"));
  const oldHome = process.env.HOME;
  process.env.HOME = home;
  try {
    fn(home);
  } finally {
    process.env.HOME = oldHome;
    rmSync(home, { recursive: true, force: true });
  }
}

test("旧 ~/pi-web-x 二进制迁移到 ~/.pi-web-x 并重建符号链接", () => {
  withTempHome((home) => {
    const legacyRoot = join(home, "pi-web-x");
    mkdirSync(legacyRoot, { recursive: true });
    writeFileSync(join(legacyRoot, "pi-web-x"), "binary", { mode: 0o755 });
    writeFileSync(join(legacyRoot, "assets.txt"), "assets");
    const binDir = join(home, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    symlinkSync(join(legacyRoot, "pi-web-x"), join(binDir, "pi-web-x"));

    const messages: string[] = [];
    const newExec = migrateLegacyInstallRoot(
      join(legacyRoot, "pi-web-x"),
      (m) => messages.push(m),
    );

    assert.equal(newExec, join(home, ".pi-web-x", "pi-web-x"));
    assert.equal(existsSync(legacyRoot), false);
    assert.equal(existsSync(join(home, ".pi-web-x", "pi-web-x")), true);
    assert.equal(existsSync(join(home, ".pi-web-x", "assets.txt")), true);
    // 符号链接重建指向新位置（悬空时 lstatSync 仍可判符号链接本身）
    assert.equal(lstatSync(join(binDir, "pi-web-x")).isSymbolicLink(), true);
    assert.ok(messages.some((m) => m.includes("迁移安装根")));
  });
});

test("新根已存在非空时不迁移", () => {
  withTempHome((home) => {
    const legacyRoot = join(home, "pi-web-x");
    mkdirSync(legacyRoot, { recursive: true });
    writeFileSync(join(legacyRoot, "pi-web-x"), "binary");
    const newRoot = join(home, ".pi-web-x");
    mkdirSync(newRoot, { recursive: true });
    writeFileSync(join(newRoot, "other"), "keep");

    const messages: string[] = [];
    const newExec = migrateLegacyInstallRoot(
      join(legacyRoot, "pi-web-x"),
      (m) => messages.push(m),
    );

    assert.equal(newExec, join(legacyRoot, "pi-web-x"));
    assert.equal(existsSync(legacyRoot), true);
    assert.equal(existsSync(join(newRoot, "other")), true);
    assert.ok(messages.some((m) => m.includes("跳过自动迁移")));
  });
});

test("非旧根布局的 execPath 不迁移", () => {
  withTempHome((home) => {
    const custom = join(home, "custom-install", "pi-web-x");
    const messages: string[] = [];
    const result = migrateLegacyInstallRoot(custom, (m) => messages.push(m));
    assert.equal(result, custom);
    assert.equal(messages.length, 0);
  });
});