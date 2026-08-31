/// <reference types="bun" />
/// <reference types="node" />

/**
 * 项目运行时类型边界。
 *
 * Bun 是服务端、测试和构建运行时；Node.js 类型用于 Bun 兼容的 `node:*` API。
 * 可选 npm launcher 独立运行于 Node.js，发布的原生二进制不依赖系统 Node.js。
 */

/** Bun 编译期 HTML manifest。 */
declare module "*.html" {
 const manifest: Bun.HTMLBundle;
 export default manifest;
}

/** CSS Module 的类名映射。 */
declare module "*.module.css" {
 const classes: Record<string, string>;
 export default classes;
}
