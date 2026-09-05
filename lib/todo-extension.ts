import { StringEnum } from "@earendil-works/pi-ai";
import type {
  AgentToolResult,
  InlineExtension,
  LoadExtensionsResult,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Static } from "typebox";
import { isTodoToolDetails } from "./todo-details";
import type { TodoDetails, TodoItem } from "./todo-details";

/** 内置待办工具名（与第三方同名 todo 扩展冲突时以内置为准）。 */
export const TODO_TOOL_NAME = "todo";
/** 内置扩展名，用于在扩展加载结果中识别宿主扩展。 */
export const HOST_TODO_EXTENSION_NAME = "pi-web-todo";
/** 内置扩展在加载结果中的虚拟路径（沿用 pi 的 <inline:...> 约定）。 */
export const HOST_TODO_EXTENSION_PATH = `<inline:${HOST_TODO_EXTENSION_NAME}>`;

export type {
  TodoDetails,
  TodoItem,
} from "./todo-details";
export { isTodoToolDetails } from "./todo-details";

const todoParameters = Type.Object({
  action: StringEnum(["list", "add", "toggle", "clear"] as const, {
    description: "The action to perform on the todo list.",
  }),
  text: Type.Optional(
    Type.String({ description: "Todo text (required for action=add)." }),
  ),
  id: Type.Optional(
    Type.Number({ description: "Todo ID (required for action=toggle)." }),
  ),
});

type TodoParameters = Static<typeof todoParameters>;

/** 会话条目的最小结构视图（SDK SessionEntry 过宽，按需收窄）。 */
interface SessionEntryView {
  type: string;
  message?: { role?: string; toolName?: string; details?: unknown };
}

/** 执行上下文中重建状态所需的最小视图。 */
interface ReconstructContext {
  sessionManager: { getBranch(): unknown[] };
}

/** 纯文本结果的 details 占位（不参与 web 端渲染，isTodoToolDetails 会拒识）。 */
export type TodoToolDetails = TodoDetails | Record<string, never>;

const EMPTY_DETAILS: Record<string, never> = {};

/** 构造纯文本工具结果。 */
function textResult(
  text: string,
  details?: TodoDetails,
): AgentToolResult<TodoToolDetails> {
  return { content: [{ type: "text", text }], details: details ?? EMPTY_DETAILS };
}

/**
 * 创建内置 todo 工具定义。
 *
 * 与社区 todo 插件保持相同的参数与 details 结构（{id, text, done} 完整
 * 快照存进工具结果 details），因此：
 * - 旧会话里的 todo 工具结果可直接用于状态重建与 web 端渲染；
 * - preferHostTodoExtension() 会自动让内置版顶掉已安装的第三方插件。
 *
 * 状态保存在会话的工具结果里而非外部文件，分支/回溯自动正确。
 *
 * @param state 可变状态引用（每个会话一份，由 createTodoExtension 创建）
 * @returns 注册进扩展运行时的工具定义
 */
export function createTodoToolDefinition(state: {
  todos: TodoItem[];
  nextId: number;
}): ToolDefinition<typeof todoParameters, TodoToolDetails> {
  return {
    name: TODO_TOOL_NAME,
    label: "Todo",
    description:
      "Manage a todo list for the current task. Actions: list, add (text), toggle (id), clear. "
      + "Use it to track multi-step work so the user can follow progress.",
    promptSnippet:
      "Track multi-step tasks with a todo list; add items when starting work and toggle them done as you finish.",
    parameters: todoParameters,
    executionMode: "sequential",

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { action } = params as TodoParameters;

      switch (action) {
        case "list": {
          const details: TodoDetails = {
            action,
            todos: [...state.todos],
            nextId: state.nextId,
          };
          return textResult(
            state.todos.length
              ? state.todos
                  .map((t) => `[${t.done ? "x" : " "}] #${t.id}: ${t.text}`)
                  .join("\n")
              : "No todos",
            details,
          );
        }

        case "add": {
          const text = (params as TodoParameters).text;
          if (!text) {
            return textResult("Error: text required for add", {
              action,
              todos: [...state.todos],
              nextId: state.nextId,
              error: "text required",
            });
          }
          const newTodo: TodoItem = {
            id: state.nextId++,
            text,
            done: false,
          };
          state.todos.push(newTodo);
          return textResult(`Added todo #${newTodo.id}: ${newTodo.text}`, {
            action,
            todos: [...state.todos],
            nextId: state.nextId,
          });
        }

        case "toggle": {
          const id = (params as TodoParameters).id;
          if (id === undefined) {
            return textResult("Error: id required for toggle", {
              action,
              todos: [...state.todos],
              nextId: state.nextId,
              error: "id required",
            });
          }
          const todo = state.todos.find((t) => t.id === id);
          if (!todo) {
            return textResult(`Todo #${id} not found`, {
              action,
              todos: [...state.todos],
              nextId: state.nextId,
              error: `#${id} not found`,
            });
          }
          todo.done = !todo.done;
          return textResult(
            `Todo #${todo.id} ${todo.done ? "completed" : "uncompleted"}`,
            {
              action,
              todos: [...state.todos],
              nextId: state.nextId,
            },
          );
        }

        case "clear": {
          const count = state.todos.length;
          state.todos = [];
          state.nextId = 1;
          return textResult(`Cleared ${count} todos`, {
            action,
            todos: [],
            nextId: 1,
          });
        }
      }
    },
  };
}

/**
 * 创建内置 todo 内联扩展。
 *
 * 以 extensionFactory 注入（每个会话独立状态实例）。工具执行期间（会话
 * 加载/分支切换）从会话分支扫描历史 todo 工具结果重建状态，因此重启、
 * 恢复会话、分支跳转后列表与进度都保持正确。
 *
 * @returns 注册 todo 工具的内联扩展
 */
export function createTodoExtension(): InlineExtension {
  return {
    name: HOST_TODO_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      const state = { todos: [] as TodoItem[], nextId: 1 };

      /**
       * 从当前分支的 todo 工具结果重建列表状态。
       *
       * @param ctx 扩展执行上下文（提供 sessionManager）
       */
      const reconstructState = (ctx: ReconstructContext) => {
        state.todos = [];
        state.nextId = 1;

        for (const entry of ctx.sessionManager.getBranch()) {
          const view = entry as SessionEntryView;
          if (view.type !== "message") continue;
          const message = view.message;
          if (!message || message.role !== "toolResult") continue;
          if (message.toolName !== TODO_TOOL_NAME) continue;
          const details: unknown = message.details;
          if (!isTodoToolDetails(details)) continue;
          state.todos = details.todos.map((item) => ({ ...item }));
          state.nextId = details.nextId;
        }
      };

      pi.on("session_start", async (_event, ctx) => {
        // SAFETY: SDK 的 ExtensionContext 联合过宽（TUI/RPC/Print 各自的 ui
        // 实现无法静态收窄），但重建状态只读 sessionManager.getBranch()，
        // 该字段在所有模式下都存在且结构一致，断言仅做类型收窄。
        reconstructState(ctx as unknown as ReconstructContext);
      });
      pi.on("session_tree", async (_event, ctx) => {
        // SAFETY: 同上，只读 sessionManager.getBranch()，各模式结构一致。
        reconstructState(ctx as unknown as ReconstructContext);
      });

      pi.registerTool(createTodoToolDefinition(state));
    },
  };
}

/**
 * 后处理扩展加载结果，让内置 todo 在与第三方同名工具冲突时胜出。
 *
 * pi 会先加载用户扩展再执行内联工厂；工具名先到先得，后来者产生冲突
 * 诊断。内置 todo 承载 web 端可视化实现，因此这里：
 * - 从冲突的第三方扩展中剥离 todo 工具（保留其其它工具），并且
 * - 清除归因于内置扩展的冲突诊断。
 *
 * @param base 扩展加载器返回的原始结果
 * @returns 处理后的加载结果（无冲突时原样返回）
 */
export function preferHostTodoExtension(
  base: LoadExtensionsResult,
): LoadExtensionsResult {
  const hostTodo = base.extensions.find(
    (extension) => extension.path === HOST_TODO_EXTENSION_PATH,
  );
  if (!hostTodo) return base;

  const conflicting = base.extensions.filter(
    (extension) =>
      extension.path !== HOST_TODO_EXTENSION_PATH &&
      extension.tools.has(TODO_TOOL_NAME),
  );
  if (conflicting.length === 0) return base;

  const conflictingPaths = new Set(conflicting.map((extension) => extension.path));
  return {
    ...base,
    extensions: base.extensions.map((extension) => {
      if (!conflictingPaths.has(extension.path)) return extension;
      return {
        ...extension,
        tools: new Map(
          [...extension.tools].filter(([toolName]) => toolName !== TODO_TOOL_NAME),
        ),
      };
    }),
    errors: base.errors.filter(
      (error) =>
        error.path !== HOST_TODO_EXTENSION_PATH ||
        !error.error.includes(`Tool "${TODO_TOOL_NAME}" conflicts`),
    ),
  };
}
