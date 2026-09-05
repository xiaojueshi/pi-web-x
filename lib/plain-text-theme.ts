import { Theme } from "@earendil-works/pi-coding-agent";

/**
 * 无样式主题：pi-web-x 是 Web UI，终端配色对扩展 UI 无意义。
 *
 * 扩展要求注入一个结构完整的 { @link Theme }，而 Web 端自行负责样式，
 * 因此这里提供一个所有着色方法都原样返回文本的极简实现：
 * 扩展组件能安全调用 fg/bg/bold 等 API，但不会产生终端 ANSI 序列。
 */
export class PlainTextTheme extends Theme {
  constructor() {
    // 0.85.0 起 Theme 构造函数会计算 fallback 色（scrollbarTrack ?? muted、
    // scrollbarThumb ?? text），缺键会在 fgAnsi(undefined) 处抛错，
    // 因此除空串占位外还需补齐 muted/text 两个被引用的基础键。
    super(
      {
        thinkingXhigh: "",
        searchMatchText: "",
        muted: "",
        text: "",
      } as ConstructorParameters<typeof Theme>[0],
      { selectedBg: "" } as ConstructorParameters<typeof Theme>[1],
      "truecolor",
    );
  }

  override fg(...[, text]: Parameters<Theme["fg"]>): string {
    return text;
  }
  override bg(...[, text]: Parameters<Theme["bg"]>): string {
    return text;
  }
  override bold(text: string): string {
    return text;
  }
  override italic(text: string): string {
    return text;
  }
  override underline(text: string): string {
    return text;
  }
  override inverse(text: string): string {
    return text;
  }
  override strikethrough(text: string): string {
    return text;
  }
  override getFgAnsi(): string {
    return "";
  }
  override getBgAnsi(): string {
    return "";
  }
  override getThinkingBorderColor(): (text: string) => string {
    return (text) => text;
  }
  override getBashModeBorderColor(): (text: string) => string {
    return (text) => text;
  }
}

/** 供 pi-web-x 扩展 UI 上下文注入的全局无样式主题实例。 */
export const PLAIN_TEXT_THEME = new PlainTextTheme();
