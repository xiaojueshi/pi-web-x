import { expect, test } from "bun:test";
import { findRoute } from "@/src/server/routes";

/** 验证编译入口静态注册的文件系统路由可提取动态参数。 */
test("matches dynamic and catch-all API routes", () => {
  const session = findRoute("/api/sessions/session-123/context");
  expect(session?.params).toEqual({ id: "session-123" });

  const file = findRoute("/api/files/a%20directory/notes.md");
  expect(file?.params).toEqual({ path: ["a directory", "notes.md"] });

  expect(findRoute("/api/does-not-exist")).toBeNull();
});

/** 字面路由必须优先于 /api/agent/[id] 等动态模式，否则 new/running 被当 id 抢占。 */
test("literal routes win over dynamic segments", () => {
  const direct = findRoute("/api/agent/new");
  expect(direct?.params).toEqual({});
  // 路由表里 { pattern: "/api/agent/[id]" } 排在 /api/agent/new 之前，
  // 若 findRoute 仍按首匹配返回，说明字面优先逻辑被破坏。
  const dynamic = findRoute("/api/agent/abc123");
  expect(dynamic?.params).toEqual({ id: "abc123" });
});
