/**
 * todo 工具结果 details 的共享类型与类型守卫。
 *
 * 该模块零依赖（不引入 pi SDK / typebox 运行时代码），供服务端扩展
 * （lib/todo-extension.ts）与 web 端渲染（components/MessageView.tsx）
 * 共用，避免把 SDK 运行时代码打进客户端包。
 */

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
