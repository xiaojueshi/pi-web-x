// 插件更新检查的全局共享 store：每次前端页面加载（或切换项目 cwd）时由
// AppShell 触发一次只读的后台检查；插件设置面板通过 useSyncExternalStore
// 读取最新结果并在面板自身检查完成后合并覆盖。
import type { PluginUpdateResult } from "./api-types";

/** 全局插件更新检查状态的快照。 */
export interface PluginUpdateStoreState {
  /** 检查结果对应的项目 cwd；与本 cwd 不匹配的结果不应展示。 */
  cwd: string;
  /** 是否有进行中的后台检查。 */
  checking: boolean;
  /** 检查结果，键为 `${scope}\0${source}`（与插件面板的 packageKey 一致）。 */
  statuses: Record<string, PluginUpdateResult>;
  /** 最近一次完成检查的时间戳（毫秒），0 表示从未检查。 */
  checkedAt: number;
}

const initial: PluginUpdateStoreState = {
  cwd: "",
  checking: false,
  statuses: {},
  checkedAt: 0,
};

let state: PluginUpdateStoreState = initial;
const listeners = new Set<() => void>();

declare global {
  // 保存于 globalThis 上以跨 dev 热重载存续
  var __piPluginUpdateStoreState: PluginUpdateStoreState | undefined;
}
if (globalThis.__piPluginUpdateStoreState) {
  state = globalThis.__piPluginUpdateStoreState;
}

function setState(next: Partial<PluginUpdateStoreState>) {
  state = { ...state, ...next };
  globalThis.__piPluginUpdateStoreState = state;
  for (const listener of listeners) listener();
}

/**
 * 订阅全局插件更新状态变化。
 *
 * @param listener 状态变更时的回调
 * @returns 取消订阅函数
 */
export function subscribePluginUpdates(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 返回当前全局插件更新状态快照（供 useSyncExternalStore 使用）。 */
export function getPluginUpdateSnapshot(): PluginUpdateStoreState {
  return state;
}

/** 将一批检查结果合并进全局 store（相同键覆盖）。 */
export function mergePluginUpdateResults(
  cwd: string,
  updates: PluginUpdateResult[],
) {
  const statuses = { ...state.statuses };
  for (const update of updates) {
    statuses[`${update.scope}\0${update.source}`] = update;
  }
  setState({ cwd, statuses, checkedAt: Date.now() });
}

/** 标记后台检查进行中（含目标 cwd，便于面板区分过期结果）。 */
export function markPluginUpdateCheckStarted(cwd: string) {
  setState({ cwd, checking: true });
}

/** 后台检查结束（成功或失败）时清除进行中标记。 */
export function markPluginUpdateCheckFinished() {
  if (state.checking) setState({ checking: false });
}

/** 清空指定 cwd 的全局检查结果（如批量更新成功后）。 */
export function clearPluginUpdateResults(cwd: string) {
  if (state.cwd !== cwd) return;
  setState({ statuses: {}, checkedAt: Date.now() });
}

/** 清除指定 cwd 中单个插件的全局检查结果（单项更新/移除成功后）。 */
export function removePluginUpdateResult(cwd: string, key: string) {
  if (state.cwd !== cwd || !(key in state.statuses)) return;
  const statuses = { ...state.statuses };
  delete statuses[key];
  setState({ statuses });
}

/**
 * 发起一次只读的全局插件更新检查，并把结果写入全局 store。
 *
 * @param cwd 项目工作目录
 * @param options.silent 为 true 时不记录 error 状态的结果（自动检查使用，
 *   避免页面加载时弹出一堆网络失败信息；用户手动检查仍能看到错误）
 * @returns 写入 store 的结果数组（fetch 失败时为空数组）
 */
export async function requestPluginUpdateCheck(
  cwd: string,
  options: { silent?: boolean } = {},
): Promise<PluginUpdateResult[]> {
  markPluginUpdateCheckStarted(cwd);
  try {
    const res = await fetch("/api/plugins/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd }),
    });
    const body = (await res.json()) as {
      updates?: PluginUpdateResult[];
      error?: string;
    };
    if (!res.ok || body.error)
      throw new Error(body.error ?? `HTTP ${res.status}`);
    const updates = body.updates ?? [];
    mergePluginUpdateResults(
      cwd,
      options.silent
        ? updates.filter((update) => update.state !== "error")
        : updates,
    );
    return updates;
  } catch {
    // 后台检查失败不打扰用户；面板内手动检查会展示错误
    return [];
  } finally {
    markPluginUpdateCheckFinished();
  }
}
