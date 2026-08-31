import assert from "node:assert/strict";
import { test } from "bun:test";

class MemorySessionStorage {
  #entries = new Map<string, string>();

  getItem(key: string): string | null {
    return this.#entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#entries.set(key, value);
  }
}

test("persists unsent drafts only in sessionStorage", async () => {
  const storage = new MemorySessionStorage();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { sessionStorage: storage },
  });

  try {
    // 变量路径保留此测试的浏览器环境初始化顺序。
    const modulePath = "../../../lib/draft-store.ts";
    const subject = await import(modulePath);
    subject.setDraft("session-1", { value: "Continue this task", images: [] });

    assert.deepEqual(
      JSON.parse(storage.getItem("pi-web-x:chat-drafts") ?? "{}"),
      { "session-1": { value: "Continue this task", images: [] } },
    );

    subject.clearDraft("session-1");
    assert.deepEqual(
      JSON.parse(storage.getItem("pi-web-x:chat-drafts") ?? "{}"),
      {},
    );
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
