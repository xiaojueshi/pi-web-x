import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "bun:test";

const source = await readFile(
  new URL("../../../components/PluginsConfig.tsx", import.meta.url),
  "utf8",
);

test("single plugin updates require explicit confirmation", () => {
  // Update 按钮不再直接调用 onAction("update")，而是先打开确认对话框
  const detail = source.slice(
    source.indexOf("function PackageDetail"),
    source.indexOf("/**\n * 插件更新确认对话框"),
  );
  assert.doesNotMatch(detail, /onAction\("update"/);
  assert.match(detail, /onUpdateRequest\(pkg\)/);

  // 单项确认目标经由对话框状态而不是直接请求
  assert.match(source, /setConfirmTarget\(\{ kind: "single", pkg: target \}\)/);
  assert.match(
    source,
    /confirmTarget\.kind === "single"\s*\?\s*\(async \(\) => \{/,
  );
  assert.match(source, /await runAction\("update", target\.pkg\)/);
});

test("batch updates show the full list and require a second confirmation", () => {
  // 页脚按钮在有可用更新时先展示清单对话框
  assert.match(source, /setConfirmTarget\(\{\s*kind: "all",/);
  // 批量执行仅由对话框确认触发，且执行前关闭对话框
  assert.match(
    source,
    /const updateAllPlugins = useCallback\(async \(\) => \{/,
  );
  assert.match(
    source,
    /setConfirmTarget\(null\);\s*\n\s*setUpdatingAll\(true\);/,
  );
  // 批量更新走不带 source 的 action: update
  assert.match(source, /body: JSON\.stringify\(\{ action: "update", cwd \}\),/);
});

test("update confirmation dialog renders the pending list", () => {
  const dialog = source.slice(
    source.indexOf("function UpdateConfirmDialog"),
    source.indexOf("export function PluginsConfig({"),
  );
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /t\("i18n\.confirmUpdateTitle"\)/);
  assert.match(dialog, /t\("i18n\.confirmUpdateAllBody"\)/);
  // 对话框列表展示每个待更新插件
  assert.match(dialog, /items\.map\(\(item\) => \(/);
  // 取消按钮不会执行更新
  assert.match(dialog, /onClick=\{onCancel\}/);
});

test("check-for-updates writes statuses into the per-package state", () => {
  const check = source.slice(
    source.indexOf("const checkForUpdates = useCallback("),
    source.indexOf("const updateAllPlugins = useCallback("),
  );
  assert.match(check, /\/api\/plugins\/check/);
  assert.match(check, /setUpdateStatuses\(\(current\) => \{/);
  // 单包检查只发送该插件的 source + scope
  assert.match(check, /source: pkg\?\.source,\s*\n\s*scope: pkg\?\.scope,/);
});

test("the plugins panel auto-checks silently after data loads", () => {
  assert.match(
    source,
    /checkForUpdates\(undefined, checkable, \{ silent: true \}\)/,
  );
  // 自动检查静默：过滤 error 状态且不设置 updateError
  assert.match(
    source,
    /accepted = options\.silent\n\s*\? \(next\.updates \?\? \[\]\)\.filter\(\(update\) => update\.state !== "error"\)/,
  );
  assert.match(source, /mergePluginUpdateResults\(cwd, accepted\)/);
});

test("panel display merges the global store with fresher local results", () => {
  assert.match(source, /const effectiveStatuses = useMemo\(\(\) => \{/);
  assert.match(source, /\{ \.\.\.stored, \.\.\.updateStatuses \}/);
  // 页脚计数与对话框清单均基于合并后的展示状态
  assert.match(source, /Object\.values\(effectiveStatuses\)\.filter/);
  // 更新成功后同步清理全局 store
  assert.match(source, /clearPluginUpdateResults\(cwd\)/);
  assert.match(source, /removePluginUpdateResult\(cwd, key\)/);
});
