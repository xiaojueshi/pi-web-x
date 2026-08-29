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
