import { useI18n } from "@/hooks/useI18n";
import type { TodoDetails } from "@/lib/todo-details";
import { TodoListBody } from "./TodoListBody";

/**
 * 顶部工具栏 TODO 下拉面板的内容：展示最新 todo 快照；尚未使用过 todo
 * 时显示空态提示。容器样式（背景/边框/定位）由 AppShell 的统一下拉
 * 面板负责，本组件只负责内容。
 *
 * @param details 最新一条 todo 工具结果快照；null 表示当前会话无待办
 */
export function TodoPanel({ details }: { details: TodoDetails | null }) {
  const { t } = useI18n();
  return (
    <div style={{ padding: 8, minWidth: 280, maxWidth: 480 }}>
      {details ? (
        <TodoListBody details={details} variant="panel" />
      ) : (
        <div style={{ color: "var(--text-dim)", fontSize: 12 }}>
          {t("chat.todoEmpty")}
        </div>
      )}
    </div>
  );
}
