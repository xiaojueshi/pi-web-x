import { beforeEach, expect, mock, test } from "bun:test";

// mock 底层 pi-coding-agent，只保留 theme-init/plain-text-theme 需要的导出：
// initTheme（行为由可变闭包控制）与 Theme（供 PlainTextTheme extends / super）。
let themeError: Error | undefined;
let themeCalls = 0;

mock.module("@earendil-works/pi-coding-agent", () => ({
  initTheme: () => {
    themeCalls += 1;
    if (themeError) throw themeError;
  },
  // PlainTextTheme 只调用 super(fgColors, bgColors, mode) 并覆写方法，父类可空实现。
  Theme: class {
    constructor() {}
  } as unknown as typeof import("@earendil-works/pi-coding-agent").Theme,
}));

const { initWebTheme } = await import("../../../lib/theme-init.ts");

// 与 lib/theme-init.ts 保持一致的底层全局注册表 key。
const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");

/** 重置 initWebTheme 的模块级缓存与注入状态，保证测试相互隔离。 */
function resetGlobalState(): void {
  globalThis.__piWebXThemeState = undefined;
  globalThis.__piWebXThemeWarned = undefined;
  // SAFETY: 清理 mock 场景下可能写入的降级主题，写入值类型无关紧要。
  delete (globalThis as Record<PropertyKey, unknown>)[THEME_KEY];
}

beforeEach(() => {
  resetGlobalState();
  themeError = undefined;
  themeCalls = 0;
});

test("initTheme 抛错（模拟编译二进制下资产缺失）时返回 false 且注入降级主题", () => {
  themeError = new Error(
    "ENOENT: no such file or directory, open '/x/theme/dark.json'",
  );

  expect(initWebTheme()).toBe(false);
  expect(themeCalls).toBe(1);
  // SAFETY: 断言注入写入的降级主题存在；写入值类型为 PlainTextTheme。
  expect((globalThis as Record<PropertyKey, unknown>)[THEME_KEY]).toBeDefined();
});

test("失败后再次调用保持幂等：不重复执行 initTheme", () => {
  themeError = new Error("ENOENT");

  expect(initWebTheme()).toBe(false);
  const callsAfterFirst = themeCalls;
  expect(initWebTheme()).toBe(false);
  expect(themeCalls).toBe(callsAfterFirst);
});

test("initTheme 成功时返回 true 且不覆盖全局主题", () => {
  expect(initWebTheme()).toBe(true);
  expect(themeCalls).toBe(1);
  // SAFETY: mock 的 initTheme 不在全局写入主题，这里验证成功路径不会注入降级实例。
  expect(
    (globalThis as Record<PropertyKey, unknown>)[THEME_KEY],
  ).toBeUndefined();
});

test("缓存后再次调用直接返回，不重复触发 initTheme", () => {
  expect(initWebTheme()).toBe(true);
  const callsAfterFirst = themeCalls;
  expect(initWebTheme()).toBe(true);
  expect(themeCalls).toBe(callsAfterFirst);
});
