import assert from "node:assert/strict";
import { test } from "bun:test";

const {
  preferHostAskExtension,
  createAskUserExtension,
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
  assert.equal(third!.tools.has("other_tool"), true, "第三方其它工具不受影响");
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
  assert.match(def.description, /MUST use this tool/i);
  assert.match(def.promptSnippet ?? "", /MUST use ask_user/i);
  const schema = def.parameters;
  assert.equal(schema.type, "object");
  assert.ok(schema.properties.question, "单题 question 存在");
  assert.ok(schema.properties.questions, "批量 questions 存在");
  assert.ok(schema.properties.options, "options 存在");
  assert.ok(schema.properties.allowMultiple, "allowMultiple 存在");
  assert.ok(schema.properties.allowFreeform, "allowFreeform 存在");
  assert.ok(schema.properties.context, "context 存在");
  const required = (schema as { required?: string[] }).required;
  assert.ok(
    !required?.includes("question"),
    "question 与 questions 二选一，由运行时校验",
  );
  assert.deepEqual(def.promptGuidelines, [
    "When user input is required before continuing, you MUST call ask_user instead of asking in assistant text or guessing. Batch independent clarifications in one questions call rather than asking one at a time.",
  ]);
});

test("批量问题通过一次 askUser 调用收集答案与可选补充", async () => {
  const def = createAskUserToolDefinition();
  let receivedQuestions: unknown;
  const result = await def.execute(
    "tool-call",
    {
      questions: [
        {
          tab: "Runtime",
          question: "Choose a runtime",
          options: [{ label: "Bun" }],
        },
        {
          tab: "Packages",
          question: "Choose a package manager",
          options: [{ label: "pnpm" }],
        },
      ],
    } as never,
    undefined,
    undefined,
    {
      ui: {
        askUser: async (questions: unknown) => {
          receivedQuestions = questions;
          return {
            answers: ["Bun", "pnpm"],
            supplement: "Keep the setup minimal.",
          };
        },
        input: () => {
          throw new Error("批量提问不能逐题调用 input");
        },
        select: () => {
          throw new Error("批量提问不能逐题调用 select");
        },
      },
    } as never,
  );

  assert.deepEqual(receivedQuestions, [
    {
      tab: "Runtime",
      question: "Choose a runtime",
      options: [{ label: "Bun" }],
    },
    {
      tab: "Packages",
      question: "Choose a package manager",
      options: [{ label: "pnpm" }],
    },
  ]);
  assert.deepEqual(result.content, [
    {
      type: "text",
      text: `User answer to "Choose a runtime": Bun
User answer to "Choose a package manager": pnpm
User additional context: Keep the setup minimal.`,
    },
  ]);
});

test("启用 ask_user 时向每轮 system prompt 注入严格工具化提问协议", () => {
  const extension = createAskUserExtension();
  assert.notEqual(typeof extension, "function");
  if (typeof extension === "function") return;

  let beforeAgentStart:
    | ((event: { systemPrompt: string }) => unknown)
    | undefined;
  extension.factory({
    registerTool: () => {},
    getActiveTools: () => ["ask_user"],
    on: (event: string, handler: unknown) => {
      if (event === "before_agent_start")
        beforeAgentStart = handler as (event: {
          systemPrompt: string;
        }) => unknown;
    },
  } as never);

  assert.ok(beforeAgentStart, "注册 before_agent_start 钩子");
  assert.deepEqual(beforeAgentStart({ systemPrompt: "base prompt" }), {
    systemPrompt: `base prompt

## Mandatory user-input protocol
- When you need an answer, preference, choice, approval, or clarification from the user before continuing, you MUST call the ask_user tool before sending any assistant text that asks for it.
- Do not ask the user questions, present choices, request confirmation, or leave a decision for them to answer in normal assistant text. Use ask_user instead, then wait for its tool result before continuing.
- Do not silently choose or guess when the missing input could materially change the work, create an irreversible or high-impact outcome, or select between materially different options.
- Ask one focused question when possible. When several independent answers are required, make one ask_user call with questions so the user can answer them in one tabbed flow.
- Do not call ask_user for information you can safely infer, for a status update, or for confirmation that is not genuinely required.`,
  });
});

test("未启用 ask_user 时不注入澄清策略", () => {
  const extension = createAskUserExtension();
  assert.notEqual(typeof extension, "function");
  if (typeof extension === "function") return;

  let beforeAgentStart:
    | ((event: { systemPrompt: string }) => unknown)
    | undefined;
  extension.factory({
    registerTool: () => {},
    getActiveTools: () => [],
    on: (event: string, handler: unknown) => {
      if (event === "before_agent_start")
        beforeAgentStart = handler as (event: {
          systemPrompt: string;
        }) => unknown;
    },
  } as never);

  assert.ok(beforeAgentStart, "注册 before_agent_start 钩子");
  assert.equal(beforeAgentStart({ systemPrompt: "base prompt" }), undefined);
});
