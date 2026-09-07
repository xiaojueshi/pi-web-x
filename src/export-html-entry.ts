// 编译期内嵌 pi-coding-agent 的 HTML 导出逻辑，供 export route 兜底使用。
//
// 背景：HTML 导出（app/api/sessions/[id]/export/route.ts）优先用独立 pi CLI
// （dist/cli.js）子进程执行；无 CLI 时（Bun 编译二进制等形态）退化为直接
// 调用 exportFromFile。pi-coding-agent 的 package.json exports 不开放
// dist/core/export-html 子路径，包名深导入会被拒绝，故用 node_modules 相对
// 路径绕过 exports 边界，让 bun build 把该模块及其依赖树打包进二进制。
// 运行时不依赖磁盘上的 pi-coding-agent 包；目录级模板/主题资产另行自举
// （src/bootstrap-assets.ts），exportFromFile 内部通过 getExportTemplateDir()
// 在二进制下解析为二进制旁的 export-html/。

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { exportFromFile } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/index.js";

export { exportFromFile };

/** promisify 后的 execFile（export route 跑 pi CLI 子进程用）。 */
export const execFileAsync = promisify(execFile);