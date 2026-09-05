import assert from "node:assert/strict";
import { test } from "bun:test";

const {
  createTodoExtension,
  preferHostTodoExtension,
  HOST_TODO_EXTENSION_PATH,
} = await import("../../../lib/todo-extension.ts");
const { isTodoToolDetails } = await import("../../../lib/todo-details.ts");

/** 伪扩展 API：捕获注册的工具与事件处理器。 */
function createHarness() {
  const tools: Array<Record<string, unknown>> = [];
  const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> =
    {};
  const pi = {
    registerTool: (tool: Record<string, unknown>) => tools.push(tool),
    on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
      handlers[event] = handler;
    },
  };
  createTodoExtension().factory(pi as never);
  assert.equal(tools.length, 1, "工厂注册了 1 个工具");
  return { tool: tools[0]!, handlers };
}

/** 构造一条 todo 工具结果会话条目。 */
const entry = (details: unknown) => ({
  type: "message",
  message: {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "todo",
    content: [{ type: "text", text: "" }],
    details,
  },
});

test("isTodoToolDetails 校验结构完整性", () => {
  assert.equal(
    isTodoToolDetails({
      action: "add",
      todos: [{ id: 1, text: "x", done: false }],
      nextId: 2,
    }),
    true,
  );
  assert.equal(isTodoToolDetails(null), false);
  assert.equal(isTodoToolDetails({}), false);
  assert.equal(
    isTodoToolDetails({ action: "bogus", todos: [], nextId: 1 }),
    false,
  );
  assert.equal(
    isTodoToolDetails({ action: "add", todos: [{ id: "x" }], nextId: 1 }),
    false,
  );
  // 旧版第三方插件/纯文本工具结果不带 details，不应误判
  assert.equal(isTodoToolDetails(undefined), false);
});

test("内置 todo 胜出：剥离第三方同名工具并清除冲突诊断", () => {
  const ext = (path: string, tools: string[]) => ({
    path,
    tools: new Map(tools.map((tool) => [tool, { name: tool }])),
  });
  const base = {
    extensions: [
      { ...ext("/path/to/todo-plugin", ["todo", "other_tool"]), errors: [] },
      { ...ext(HOST_TODO_EXTENSION_PATH, ["todo"]), errors: [] },
    ],
    errors: [
      {
        path: HOST_TODO_EXTENSION_PATH,
        error: 'Tool "todo" conflicts with /path/to/todo-plugin',
      },
    ],
    runtime: {},
  };
  const result = preferHostTodoExtension(base as never);
  const host = result.extensions.find(
    (e) => e.path === HOST_TODO_EXTENSION_PATH,
  );
  const third = result.extensions.find(
    (e) => e.path === "/path/to/todo-plugin",
  );
  assert.ok(host);
  assert.equal(host!.tools.has("todo"), true, "内置 todo 保留");
  assert.ok(third, "第三方扩展整体保留");
  assert.equal(third!.tools.has("todo"), false, "第三方 todo 被移除");
  assert.equal(third!.tools.has("other_tool"), true, "第三方其它工具不受影响");
  assert.equal(result.errors.length, 0, "内置冲突诊断被清除");
});

test("无第三方冲突或内置缺席时原样返回", () => {
  const base = {
    extensions: [{ path: HOST_TODO_EXTENSION_PATH, tools: new Map() }],
    errors: [],
    runtime: {},
  };
  assert.equal(preferHostTodoExtension(base as never), base);

  const noHost = {
    extensions: [{ path: "/plugin", tools: new Map([["todo", {}]]) }],
    errors: [],
    runtime: {},
  };
  assert.equal(preferHostTodoExtension(noHost as never), noHost);
});

test("session_start 从会话分支重建 todo 状态", async () => {
  const { tool, handlers } = createHarness();
  const ctx = {
    sessionManager: {
      getBranch: () => [
        entry({
          action: "add",
          todos: [
            { id: 1, text: "搭框架", done: true },
            { id: 2, text: "写测试", done: false },
          ],
          nextId: 3,
        }),
      ],
    },
  };
  await handlers["session_start"]!({ type: "session_start" }, ctx);

  const result = (await tool.execute!(
    "call-x",
    { action: "list" },
    undefined,
    undefined,
    {},
  )) as { content: Array<{ text: string }>; details: unknown };

  assert.match(result.content[0]!.text, /\[x\] #1: 搭框架/);
  assert.match(result.content[0]!.text, /\[ \] #2: 写测试/);
  const details = result.details as { todos: Array<Record<string, unknown>> };
  assert.equal(details.todos.length, 2);
  assert.equal(details.todos[0]!.done, true);
});

test("execute 支持 add / toggle / clear，details 携带完整快照", async () => {
  const { tool } = createHarness();
  const exec = (params: Record<string, unknown>) =>
    tool.execute!(
      "call-x",
      params as never,
      undefined,
      undefined,
      {},
    ) as Promise<{
      content: Array<{ text: string }>;
      details: Record<string, unknown> & {
        todos: Array<{ id: number; text: string; done: boolean }>;
        nextId: number;
        error?: string;
      };
    }>;

  const added = await exec({ action: "add", text: "实现登录" });
  assert.match(added.content[0]!.text, /#1: 实现登录/);
  assert.equal(added.details.todos.length, 1);
  assert.equal(added.details.nextId, 2);

  const toggled = await exec({ action: "toggle", id: 1 });
  assert.match(toggled.content[0]!.text, /completed/);
  assert.equal(toggled.details.todos[0]!.done, true);

  const toggledBack = await exec({ action: "toggle", id: 1 });
  assert.match(toggledBack.content[0]!.text, /uncompleted/);

  const missingId = await exec({ action: "toggle" });
  assert.match(missingId.content[0]!.text, /Error/);
  assert.equal(missingId.details.error, "id required");

  const cleared = await exec({ action: "clear" });
  assert.equal(cleared.details.todos.length, 0);
  assert.equal(cleared.details.nextId, 1);
});
