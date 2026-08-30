import { initTheme } from "@earendil-works/pi-coding-agent";
import { PLAIN_TEXT_THEME } from "./plain-text-theme";

// pi-coding-agent 用 Symbol.for 全局注册表存放主题实例（theme.js），
// 这样 tsx / jiti / 编译产物等各模块实例能共享同一个主题。
// 兜底分支直接写入该 key，保证降级主题对全局 theme proxy 可见。
const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");

declare global {
 /** 全局主题初始化状态：ready=真实主题可用；failed=已降级为无样式主题。 */
 var __piWebXThemeState: "ready" | "failed" | undefined;
 /** 降级告警是否已输出（只告警一次，避免刷屏）。 */
 var __piWebXThemeWarned: boolean | undefined;
}

/**
 * 在 Web 模式下初始化 pi-coding-agent 的全局主题（尽力而为，不阻断会话）。
 *
 * ## 背景
 * pi-web-x 以单文件二进制发布，而 pi-coding-agent 的内置主题是目录级资产
 * （`getThemesDir()` 在 Bun 二进制下解析为 `dirname(process.execPath)/theme`）。
 * 正常情况下 `src/server/bootstrap-assets.ts` 会在启动时把资产包自举到该目录；
 * 若自举失败（离线、内网被墙、资产被删），直接调用 `initTheme()` 会抛 ENOENT，
 * 进而让「创建会话」整体 500。
 *
 * ## 策略
 * - 成功：与 CLI 行为一致，扩展可访问真实内置主题。
 * - 失败：记一次告警（不刷屏），并把无样式主题写入底层的全局注册表，
 *   使扩展访问全局 `theme` proxy 时拿到一个结构完整的 { @link Theme }
 *   而不是抛 "Theme not initialized"。Web UI 本身不依赖终端配色，
 *   因此这是安全的降级，代价仅是终端主题色在极端情况下不可用。
 *
 * @returns true 表示全局主题可用（真实内置主题或降级主题）；false 表示降级注入也失败
 */
export function initWebTheme(): boolean {
 if (globalThis.__piWebXThemeState === "ready") return true;
 if (globalThis.__piWebXThemeState === "failed") {
  injectFallbackTheme();
  return false;
 }
 try {
  initTheme();
  globalThis.__piWebXThemeState = "ready";
  return true;
 } catch (error) {
  globalThis.__piWebXThemeState = "failed";
  if (!globalThis.__piWebXThemeWarned) {
   globalThis.__piWebXThemeWarned = true;
   console.warn(
    "[pi-web-x] 全局主题初始化失败（内置主题资产缺失或自举未生效），已降级为无样式主题：",
    error instanceof Error ? error.message : String(error),
   );
  }
  injectFallbackTheme();
  return false;
 }
}

/**
 * 把无样式主题写入底层全局注册表，替代真实的终端主题。
 * 底层通过 `globalThis[Symbol.for("@earendil-works/pi-coding-agent:theme")]`
 * 读取，该 key 非 TS 可索引类型，故用 PropertyKey 断言写入。
 *
 * SAFETY: globalThis 无条件可写任意 PropertyKey；断言只是为了绕过
 * TS 对全局对象的索引签名限制，写入值为结构完整的 Theme 实例，
 * 底层 proxy get 仅要求该值存在。
 */
function injectFallbackTheme(): void {
 // SAFETY: 见函数 JSDoc——globalThis 索引写入无需额外约束。
 (globalThis as unknown as Record<PropertyKey, unknown>)[THEME_KEY] =
  PLAIN_TEXT_THEME;
}
