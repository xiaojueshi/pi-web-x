import assert from "node:assert/strict";
import { test } from "bun:test";

const {
  extractLatestTodoDetails,
  isTodoToolDetails,
  TODO_TOOL_NAME,
} = await import("../../../lib/todo-details.ts");

const todoResult = (
  toolCallId: string,
  details: unknown,
): { role: string; toolName?: string; details?: unknown } => ({
  role: "toolResult",
  toolName: TODO_TOOL_NAME,
  toolCallId,
  content: [],
  details,
});

test("extractLatestTodoDetails 返回最后一条 todo 结果", () => {
  const messages = [
    { role: "user", content: [] },
    todoResult("call-1", {
      action: "add",
      todos: [{ id: 1, text: "旧任务", done: false }],
      nextId: 2,
    }),
    { role: "assistant", content: [] },
    todoResult("call-2", {
      action: "toggle",
      todos: [
        { id: 1, text: "旧任务", done: true },
        { id: 2, text: "新任务", done: false },
      ],
      nextId: 3,
    }),
  ];
  const latest = extractLatestTodoDetails(messages as never);
  assert.ok(latest);
  assert.equal(latest.action, "toggle");
  assert.equal(latest.todos.length, 2);
  assert.equal(latest.todos[0]!.done, true);
});

test("details 结构非法的 todo 结果被跳过，继续向前扫描", () => {
  const messages = [
    todoResult("call-1", {
      action: "add",
      todos: [{ id: 1, text: "合法", done: false }],
      nextId: 2,
    }),
    todoResult("call-2", { action: "bogus", todos: [], nextId: 1 }),
  ];
  const latest = extractLatestTodoDetails(messages as never);
  assert.ok(latest);
  assert.equal(latest.todos[0]!.text, "合法");
});

test("非 todo 工具结果与空列表返回 null", () => {
  assert.equal(extractLatestTodoDetails([] as never), null);
  assert.equal(
    extractLatestTodoDetails([
      { role: "toolResult", toolName: "bash", details: {} },
    ] as never),
    null,
  );
  // todo 结果但 details 缺失（旧版纯文本结果）→ null
  assert.equal(
    extractLatestTodoDetails([
      { role: "toolResult", toolName: TODO_TOOL_NAME, details: undefined },
    ] as never),
    null,
  );
});

test("isTodoToolDetails 拒识纯文本占位 details", () => {
  // 服务端 textResult 无 details 时的占位（EMPTY_DETAILS）不应被识别
  assert.equal(isTodoToolDetails({}), false);
  assert.equal(isTodoToolDetails({ todos: "not-array", nextId: 1 }), false);
});
