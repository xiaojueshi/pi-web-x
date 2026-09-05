import { useI18n } from "@/hooks/useI18n";
import type { TodoDetails } from "@/lib/todo-details";

/**
 * todo 工具的进度列表：消息流卡片（card）与顶部工具栏下拉面板（panel）
 * 两种形态共用。展示进度条 + 逐项勾选状态；数据来自工具结果的 details
 * 快照，历史消息（会话文件里的旧工具结果）同样可渲染。
 *
 * @param details 最新一条 todo 工具结果快照
 * @param variant 形态：card 默认，白底 + 绿色分隔线（消息流卡片内）；
 *   panel 透明背景（由外层面板提供 --bg-panel 底色），无分隔线
 */
export function TodoListBody({
  details,
  variant = "card",
}: {
  details: TodoDetails;
  variant?: "card" | "panel";
}) {
  const { t } = useI18n();
  const todos = details.todos;
  const doneCount = todos.filter((item) => item.done).length;
  const percent =
    todos.length === 0 ? 0 : Math.round((doneCount / todos.length) * 100);
  const isPanel = variant === "panel";

  return (
    <div
      style={{
        borderTop: isPanel ? "none" : "1px solid rgba(34,197,94,0.2)",
        background: isPanel ? "transparent" : "var(--bg)",
        padding: isPanel ? 0 : "8px 10px",
      }}
    >
      {details.error ? (
        <div style={{ color: "#f87171", fontSize: 12, lineHeight: 1.5 }}>
          ⚠ {details.error}
        </div>
      ) : todos.length === 0 ? (
        <div style={{ color: "var(--text-dim)", fontSize: 12 }}>
          {details.action === "clear"
            ? t("chat.todoCleared")
            : t("chat.todoEmpty")}
        </div>
      ) : (
        <>
          {/* 进度：n/m 已完成 + 进度条 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 5,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--text-muted)",
                fontVariantNumeric: "tabular-nums",
                flexShrink: 0,
              }}
            >
              {t("chat.todoProgress", { done: doneCount, total: todos.length })}
            </span>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={todos.length}
              aria-valuenow={doneCount}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                background: "var(--border)",
                overflow: "hidden",
                minWidth: 0,
              }}
            >
              <div
                style={{
                  width: `${percent}%`,
                  height: "100%",
                  background: "#16a34a",
                  borderRadius: 2,
                  transition: "width 0.25s ease",
                }}
              />
            </div>
          </div>
          {/* 逐项勾选状态 */}
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {todos.map((item) => (
              <li
                key={item.id}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 7,
                  padding: "2px 0",
                  fontSize: 12,
                  lineHeight: 1.55,
                }}
              >
                <span
                  style={{
                    color: item.done ? "#16a34a" : "var(--text-dim)",
                    flexShrink: 0,
                    fontFamily: "var(--font-mono)",
                  }}
                  aria-hidden="true"
                >
                  {item.done ? "✓" : "○"}
                </span>
                <span
                  style={{
                    color: item.done ? "var(--text-dim)" : "var(--text)",
                    textDecoration: item.done ? "line-through" : "none",
                    overflowWrap: "anywhere",
                  }}
                >
                  {item.text}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
