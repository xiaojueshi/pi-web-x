import assert from "node:assert/strict";
import { test } from "bun:test";

const {
  preferHostAskExtension,
  createAskUserToolDefinition,
  HOST_ASK_EXTENSION_PATH,
} = await import("../../../lib/ask-user-extension.ts");

/** 构造带指定工具名集合的伪扩展加载项。 */
const ext = (path: string, tools: string[]) => ({
  path,
  tools: new Map(tools.map((tool) => [tool, { name: tool }])),
});

test("内置 ask_user 胜出：移除第三方同名工具，保留其余工具", () => {
  const base = {
    extensions: [
      ext("/path/to/pi-ask-user", ["ask_user", "other_tool"]),
      ext(HOST_ASK_EXTENSION_PATH, ["ask_user"]),
    ],
    errors: [
      {
        path: HOST_ASK_EXTENSION_PATH,
        error: 'Tool "ask_user" conflicts with /path/to/pi-ask-user',
      },
    ],
    runtime: {},
  };
  const result = preferHostAskExtension(base as never);
  const host = result.extensions.find(
    (e) => e.path === HOST_ASK_EXTENSION_PATH,
  );
  const third = result.extensions.find(
    (e) => e.path === "/path/to/pi-ask-user",
  );
  assert.ok(host, "内置扩展保留");
  assert.equal(host!.tools.has("ask_user"), true, "内置 ask_user 保留");
  assert.ok(third, "第三方扩展整体保留");
  assert.equal(third!.tools.has("ask_user"), false, "第三方 ask_user 被移除");
  assert.equal(
    third!.tools.has("other_tool"),
    true,
    "第三方其它工具不受影响",
  );
  assert.equal(result.errors.length, 0, "内置冲突诊断被清除");
});

test("无第三方冲突时原样返回（不复制）", () => {
  const base = {
    extensions: [ext(HOST_ASK_EXTENSION_PATH, ["ask_user"])],
    errors: [],
    runtime: {},
  };
  assert.equal(preferHostAskExtension(base as never), base);
});

test("内置扩展缺席时原样返回", () => {
  const base = {
    extensions: [ext("/path/to/pi-ask-user", ["ask_user"])],
    errors: [{ path: "/path/to/pi-ask-user", error: "boom" }],
    runtime: {},
  };
  assert.equal(preferHostAskExtension(base as never), base);
});

test("工具定义暴露名称与完整参数 schema", () => {
  const def = createAskUserToolDefinition();
  assert.equal(def.name, "ask_user");
  assert.match(def.description, /ask the user/i);
  const schema = def.parameters;
  assert.equal(schema.type, "object");
  assert.ok(schema.properties.question, "question 必填");
  assert.ok(schema.properties.options, "options 存在");
  assert.ok(schema.properties.allowMultiple, "allowMultiple 存在");
  assert.ok(schema.properties.allowFreeform, "allowFreeform 存在");
  assert.ok(schema.properties.context, "context 存在");
  assert.ok(schema.required.includes("question"), "question 在 required 中");
});
