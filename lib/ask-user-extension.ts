import { Type } from "typebox";
import type { Static } from "typebox";
import type {
  AgentToolResult,
  InlineExtension,
  LoadExtensionsResult,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { ExtensionUiContextLike } from "./pi-types";
import type { AskUserAnswer, AskUserQuestion } from "./types";

/** 内置提问工具名（与第三方同名 ask_user 扩展冲突时以内置为准）。 */
export const ASK_USER_TOOL_NAME = "ask_user";
/** 内置扩展名，用于在扩展加载结果中识别宿主扩展。 */
export const HOST_ASK_EXTENSION_NAME = "pi-web-ask-user";
/** 内置扩展在加载结果中的虚拟路径（沿用 pi 的 <inline:...> 约定）。 */
export const HOST_ASK_EXTENSION_PATH = `<inline:${HOST_ASK_EXTENSION_NAME}>`;

/** 用户关闭提问时返回给模型的提示文本。 */
const DISMISSED_MESSAGE = "User dismissed the question (no answer provided)";

/**
 * 注入每轮 system prompt 的提问策略。
 *
 * 工具描述本身不足以让部分模型主动澄清需求；将这条策略置于系统提示词末尾，
 * 让模型在需要用户决定时优先调用 ask_user，而不是擅自假设。
 */
const ASK_USER_SYSTEM_GUIDANCE = `## Mandatory user-input protocol
- When you need an answer, preference, choice, approval, or clarification from the user before continuing, you MUST call the ask_user tool before sending any assistant text that asks for it.
- Do not ask the user questions, present choices, request confirmation, or leave a decision for them to answer in normal assistant text. Use ask_user instead, then wait for its tool result before continuing.
- Do not silently choose or guess when the missing input could materially change the work, create an irreversible or high-impact outcome, or select between materially different options.
- Ask one focused question when possible. When several independent answers are required, make one ask_user call with questions so the user can answer them in one tabbed flow.
- Do not call ask_user for information you can safely infer, for a status update, or for confirmation that is not genuinely required.`;

const askUserQuestionParameters = Type.Object({
  question: Type.String({
    description: "The question to ask the user, concise and clear.",
  }),
  tab: Type.Optional(
    Type.String({
      description:
        "Short label for this question's tab. Omit to use the localized question number.",
    }),
  ),
  context: Type.Optional(
    Type.String({
      description:
        "Background: why this information is needed and how it will be used.",
    }),
  ),
  options: Type.Optional(
    Type.Array(
      Type.Object({
        label: Type.String({ description: "Option text shown to the user." }),
        description: Type.Optional(
          Type.String({
            description: "Optional supplementary description for the option.",
          }),
        ),
      }),
      {
        description:
          "Suggested options; omit to show a plain-text input question.",
      },
    ),
  ),
  allowMultiple: Type.Optional(
    Type.Boolean({
      description:
        "Whether multiple selection is allowed. Default false (single-select).",
    }),
  ),
  allowFreeform: Type.Optional(
    Type.Boolean({
      description:
        'Whether the user may type a custom answer (the "Other" input). Default true.',
    }),
  ),
});

const askUserParameters = Type.Object({
  question: Type.Optional(askUserQuestionParameters.properties.question),
  context: Type.Optional(askUserQuestionParameters.properties.context),
  options: Type.Optional(askUserQuestionParameters.properties.options),
  allowMultiple: Type.Optional(
    askUserQuestionParameters.properties.allowMultiple,
  ),
  allowFreeform: Type.Optional(
    askUserQuestionParameters.properties.allowFreeform,
  ),
  questions: Type.Optional(
    Type.Array(askUserQuestionParameters, {
      minItems: 2,
      maxItems: 8,
      description:
        "Ask multiple independent questions in one tabbed flow. Use instead of calling ask_user repeatedly.",
    }),
  ),
});

type AskUserParameters = Static<typeof askUserParameters>;

/** 构造纯文本工具结果。 */
function textResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: "text", text }], details: {} };
}

/** 将单选或多选答案整理为适合返回给模型的文本。 */
function formatAnswer(answer: AskUserAnswer): string {
  return (Array.isArray(answer) ? answer : [answer])
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .join(", ");
}

/**
 * 为启用了 ask_user 的会话追加主动澄清策略。
 *
 * @param systemPrompt 当前轮已组装的 system prompt
 * @returns 包含主动澄清策略的 system prompt
 */
function appendAskUserSystemGuidance(systemPrompt: string): string {
  return systemPrompt.includes(ASK_USER_SYSTEM_GUIDANCE)
    ? systemPrompt
    : `${systemPrompt}\n\n${ASK_USER_SYSTEM_GUIDANCE}`;
}

/**
 * 创建内置 ask_user 工具定义。
 *
 * 工具通过 pi-web 的内置扩展 UI 通道向用户提问：提供 options 时走增强
 * 选择（多选、自定义答案、上下文说明），否则走纯文本输入。需要多个独立
 * 澄清项时传入 questions（2–8 题），前端会用单个 Tab 流依次收集回答，
 * 最后提供一个可选补充文本框。它是 pi-web 内置能力，无需安装第三方插件；
 * 同名冲突时 preferHostAskExtension() 会保留内置版本（因为 UI 实现在内置侧）。
 *
 * @returns 注册进扩展运行时的工具定义
 */
export function createAskUserToolDefinition(): ToolDefinition<
  typeof askUserParameters
> {
  return {
    name: ASK_USER_TOOL_NAME,
    label: "Ask user",
    description:
      "When user input is required before continuing, you MUST use this tool rather than ask in normal assistant text. " +
      "Use question for one question, or questions (2–8) to collect independent answers in one tabbed flow with an optional final supplement. " +
      "Each batch question supports tab (a short custom tab label), single/multi-choice, custom answers, or plain-text input. " +
      "Use only when user input is genuinely required; never for confirmations you could infer yourself.",
    promptSnippet:
      "MUST use ask_user for required user decisions or clarifications; never ask for them in assistant text. Batch independent clarifications with questions.",
    promptGuidelines: [
      "When user input is required before continuing, you MUST call ask_user instead of asking in assistant text or guessing. Batch independent clarifications in one questions call rather than asking one at a time.",
    ],
    parameters: askUserParameters,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const input = params as AskUserParameters;
      // SAFETY: ctx.ui 在运行时由 rpc-manager 的 createExtensionUiContext()
      // 提供，实际形态与 ExtensionUiContextLike 兼容；SDK 的扩展 UI 上下文
      // 类型较宽，此处断言只做收窄，不改运行时行为。
      const ui = ctx.ui as unknown as ExtensionUiContextLike;
      const questions = input.questions as AskUserQuestion[] | undefined;

      if (questions && questions.length > 0) {
        const response = await ui.askUser(questions, { signal });
        if (!response) {
          return textResult(
            "User dismissed the questions (no answers provided)",
          );
        }
        const answers = questions.map((item, index) => {
          const answer = response.answers[index];
          return `User answer to "${item.question}": ${answer ? formatAnswer(answer) : "(no answer)"}`;
        });
        if (response.supplement)
          answers.push(`User additional context: ${response.supplement}`);
        return textResult(answers.join("\n"));
      }

      const question = input.question;
      if (!question)
        return textResult("Error: question or questions is required");
      const {
        context,
        options = [],
        allowMultiple = false,
        allowFreeform = true,
      } = input;
      if (options.length === 0) {
        const answer = await ui.input(question, undefined, { signal });
        if (answer === undefined || answer.trim() === "") {
          return textResult(
            `${DISMISSED_MESSAGE} Original question: ${question}`,
          );
        }
        return textResult(`User answer to "${question}": ${answer.trim()}`);
      }

      const selected = await ui.select(question, options, {
        signal,
        multiSelect: allowMultiple,
        allowFreeform,
        ...(context !== undefined ? { context } : {}),
      });
      if (selected === undefined || formatAnswer(selected) === "") {
        return textResult(
          `${DISMISSED_MESSAGE} Original question: ${question}`,
        );
      }
      return textResult(
        `User answer to "${question}": ${formatAnswer(selected)}`,
      );
    },
  };
}

/**
 * 创建内置 ask_user 内联扩展。
 *
 * 与 createProjectCommandBashExtension() 一样以 extensionFactory 注入：
 * 每个会话、每个模型都可见，用户无需安装任何插件。
 *
 * @returns 注册 ask_user 工具的内联扩展
 */
export function createAskUserExtension(): InlineExtension {
  return {
    name: HOST_ASK_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      pi.registerTool(createAskUserToolDefinition());
      pi.on("before_agent_start", (event) => {
        if (!pi.getActiveTools().includes(ASK_USER_TOOL_NAME)) return;
        return {
          systemPrompt: appendAskUserSystemGuidance(event.systemPrompt),
        };
      });
    },
  };
}

/**
 * 后处理扩展加载结果，让内置 ask_user 在与第三方同名工具冲突时胜出。
 *
 * pi 会先加载用户扩展再执行内联工厂；工具名先到先得，后来者产生冲突
 * 诊断。内置 ask_user 承载完整 UI 实现，因此这里：
 * - 从冲突的第三方扩展中剥离 ask_user 工具（保留其其它工具），并且
 * - 清除归因于内置扩展的冲突诊断。
 *
 * @param base 扩展加载器返回的原始结果
 * @returns 处理后的加载结果（无冲突时原样返回）
 */
export function preferHostAskExtension(
  base: LoadExtensionsResult,
): LoadExtensionsResult {
  const hostAsk = base.extensions.find(
    (extension) => extension.path === HOST_ASK_EXTENSION_PATH,
  );
  if (!hostAsk) return base;

  const conflicting = base.extensions.filter(
    (extension) =>
      extension.path !== HOST_ASK_EXTENSION_PATH &&
      extension.tools.has(ASK_USER_TOOL_NAME),
  );
  if (conflicting.length === 0) return base;

  const conflictingPaths = new Set(
    conflicting.map((extension) => extension.path),
  );
  return {
    ...base,
    extensions: base.extensions.map((extension) => {
      if (!conflictingPaths.has(extension.path)) return extension;
      return {
        ...extension,
        tools: new Map(
          [...extension.tools].filter(
            ([toolName]) => toolName !== ASK_USER_TOOL_NAME,
          ),
        ),
      };
    }),
    errors: base.errors.filter(
      (error) =>
        error.path !== HOST_ASK_EXTENSION_PATH ||
        !error.error.includes(`Tool "${ASK_USER_TOOL_NAME}" conflicts`),
    ),
  };
}
