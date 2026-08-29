/** Bun 编译期 HTML manifest 与 CSS Module 的最小声明。 */
declare module "*.html" {
  const manifest: Bun.HTMLBundle;
  export default manifest;
}
declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}
