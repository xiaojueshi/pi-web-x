/**
 * todo 工具结果 details 的共享类型与类型守卫。
 *
 * 该模块零依赖（不引入 pi SDK / typebox 运行时代码），供服务端扩展
 * （lib/todo-extension.ts）与 web 端渲染（components/MessageView.tsx）
 * 共用，避免把 SDK 运行时代码打进客户端包。
 */

/** 内置 todo 工具名（服务端扩展与客户端提取逻辑共用）。 */
export const TODO_TOOL_NAME = "todo";

/**
 * 从消息列表中提取最后一条 todo 工具结果的 details 快照。
 *
 * 用作常驻面板的数据源：从会话尾部反向扫描，历史消息（会话文件里的
 * details）同样适用，分支/回溯后列表变化自动反映最新状态。
 *
 * @param messages 会话消息列表（AgentMessage[]，按需收窄避免耦合）
 * @returns 最后一条 todo details；列表从未使用过 todo 时返回 null
 */
export function extractLatestTodoDetails(
  messages: readonly { role?: string; toolName?: string; details?: unknown }[],
): TodoDetails | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message) continue;
    if (message.role !== "toolResult") continue;
    if (message.toolName !== TODO_TOOL_NAME) continue;
    if (isTodoToolDetails(message.details)) return message.details;
  }
  return null;
}

/** 单条待办。 */
export interface TodoItem {
  id: number;
  text: string;
  done: boolean;
}

/**
 * todo 工具结果 details：完整列表快照随每次操作持久化到会话，
 * web 端据此在消息流中渲染可视化进度卡片；分支/回溯自动正确。
 */
export interface TodoDetails {
  action: "list" | "add" | "toggle" | "clear";
  todos: TodoItem[];
  nextId: number;
  error?: string;
}

/**
 * 判断未知值是否为 todo 工具结果 details。
 *
 * @param value 工具结果上的 details 字段
 * @returns 是 todo details 时收窄类型
 */
export function isTodoToolDetails(value: unknown): value is TodoDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<TodoDetails>;
  if (
    candidate.action !== "list" &&
    candidate.action !== "add" &&
    candidate.action !== "toggle" &&
    candidate.action !== "clear"
  ) {
    return false;
  }
  if (typeof candidate.nextId !== "number") return false;
  if (!Array.isArray(candidate.todos)) return false;
  return candidate.todos.every(
    (item) =>
      !!item &&
      typeof item === "object" &&
      typeof (item as TodoItem).id === "number" &&
      typeof (item as TodoItem).text === "string" &&
      typeof (item as TodoItem).done === "boolean",
  );
}
