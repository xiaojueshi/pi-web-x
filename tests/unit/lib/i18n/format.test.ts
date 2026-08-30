import assert from "node:assert/strict";
import { test } from "bun:test";

import {
  formatRelativeTime,
  interpolateMessage,
  translateMessage,
} from "../../../../lib/i18n/format.ts";

/** 去除空白，用于忽略不同平台 ICU 的空格差异。 */
function onlySpacesRemoved(value: string): string {
  return value.replace(/\s/g, "");
}

test("interpolates string and numeric parameters", () => {
  assert.equal(
    interpolateMessage("Hello, {name} ({count})", { name: "Pi", count: 2 }),
    "Hello, Pi (2)",
  );
});

test("falls back to English and returns the key when both are missing", () => {
  assert.equal(
    translateMessage("zh-CN", "common.ok", {
      en: { "common.ok": "OK" },
      "zh-CN": {},
    }),
    "OK",
  );
  assert.equal(
    translateMessage("zh-CN", "missing.key", { en: {}, "zh-CN": {} }),
    "missing.key",
  );
});

test("formats relative time using the selected locale", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  // Intl.RelativeTimeFormat 的空白随平台 ICU 不同（如 zh-TW 在 macOS 为
  // “1小時前”、Linux 为 “1 小時前”），断言去掉空白差异只比较语义内容。
  assert.equal(
    formatRelativeTime(new Date("2026-01-01T00:05:00.000Z"), "en", now),
    "in 5 minutes",
  );
  assert.equal(
    onlySpacesRemoved(formatRelativeTime(new Date("2025-12-31T23:00:00.000Z"), "zh-CN", now)),
    "1小时前",
  );
  assert.equal(
    onlySpacesRemoved(formatRelativeTime(new Date("2025-12-31T23:00:00.000Z"), "zh-TW", now)),
    "1小時前",
  );
});
