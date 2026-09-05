import { Type } from "typebox";
import type { Static } from "typebox";
import type {
  AgentToolResult,
  InlineExtension,
  LoadExtensionsResult,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { ExtensionUiContextLike } from "./pi-types";

/** 内置提问工具名（与第三方同名 ask_user 扩展冲突时以内置为准）。 */
export const ASK_USER_TOOL_NAME = "ask_user";
/** 内置扩展名，用于在扩展加载结果中识别宿主扩展。 */
export const HOST_ASK_EXTENSION_NAME = "pi-web-ask-user";
/** 内置扩展在加载结果中的虚拟路径（沿用 pi 的 <inline:...> 约定）。 */
export const HOST_ASK_EXTENSION_PATH = `<inline:${HOST_ASK_EXTENSION_NAME}>`;

/** 用户关闭提问时返回给模型的提示文本。 */
const DISMISSED_MESSAGE = "User dismissed the question (no answer provided)";

const askUserParameters = Type.Object({
  question: Type.String({
    description: "The question to ask the user, concise and clear.",
  }),
  context: Type.Optional(
    Type.String({
      description: "Background: why this information is needed and how it will be used.",
    }),
  ),
  options: Type.Optional(
    Type.Array(
      Type.Object({
        label: Type.String({ description: "Option text shown to the user." }),
        description: Type.Optional(
          Type.String({ description: "Optional supplementary description for the option." }),
        ),
      }),
      { description: "Suggested options; omit to show a plain-text input question." },
    ),
  ),
  allowMultiple: Type.Optional(
    Type.Boolean({
      description: "Whether multiple selection is allowed. Default false (single-select).",
    }),
  ),
  allowFreeform: Type.Optional(
    Type.Boolean({
      description: "Whether the user may type a custom answer (the \"Other\" input). Default true.",
    }),
  ),
});

type AskUserParameters = Static<typeof askUserParameters>;

/** 构造纯文本工具结果。 */
function textResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: "text", text }], details: {} };
}

/**
 * 创建内置 ask_user 工具定义。
 *
 * 工具通过 pi-web 的内置扩展 UI 通道向用户提问：提供 options 时走增强
 * 选择（多选、自定义答案、上下文说明），否则走纯文本输入。它是 pi-web
 * 内置能力，无需安装第三方插件；同名冲突时 preferHostAskExtension()
 * 会保留内置版本（因为 UI 实现在内置侧）。
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
      "Ask the user a question when clarification, a choice, or preference/context gathering is needed. "
      + "Supports single/multi-choice, custom answers, and plain-text questions. "
      + "Use only when user input is genuinely required; never for confirmations you could infer yourself.",
    promptSnippet:
      "Ask the user one focused question with optional multiple-choice answers to gather information interactively.",
    parameters: askUserParameters,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const {
        question,
        context,
        options = [],
        allowMultiple = false,
        allowFreeform = true,
      } = params as AskUserParameters;
      // SAFETY: ctx.ui 在运行时由 rpc-manager 的 createExtensionUiContext()
      // 提供，实际形态与 ExtensionUiContextLike 兼容；SDK 的扩展 UI 上下文
      // 类型较宽，此处断言只做收窄，不改运行时行为。
      const ui = ctx.ui as unknown as ExtensionUiContextLike;

      if (options.length === 0) {
        const answer = await ui.input(question, undefined, { signal });
        if (answer === undefined || answer.trim() === "") {
          return textResult(`${DISMISSED_MESSAGE} Original question: ${question}`);
        }
        return textResult(`User answer to "${question}": ${answer.trim()}`);
      }

      const selected = await ui.select(question, options, {
        signal,
        multiSelect: allowMultiple,
        allowFreeform,
        ...(context !== undefined ? { context } : {}),
      });
      if (selected === undefined) {
        return textResult(`${DISMISSED_MESSAGE} Original question: ${question}`);
      }
      const answers = (Array.isArray(selected) ? selected : [selected])
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      if (answers.length === 0) {
        return textResult(`${DISMISSED_MESSAGE} Original question: ${question}`);
      }
      return textResult(`User answer to "${question}": ${answers.join(", ")}`);
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
