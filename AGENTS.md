# Pi Web X 开发说明

## 运行命令

```bash
bun run dev             # Bun 监听 127.0.0.1:30141
bun test               # Bun 原生测试运行器（830 单测 + 3 expect）
bun run test:bun       # 仅 tests/ 目录路由测试
bun run typecheck
bun run build          # 当前 Linux x64 单文件二进制
bun run build:all       # 八个平台二进制
```

使用 `bun ...`，不要引入 Next.js、RSC、SSR 或 Node 服务端运行时。`bun build --compile` 是发布门槛。

## 架构

```text
浏览器 ── HTTP/SSE ── src/server.ts ── app/api/**/route.ts ── AgentSession
                     │
                     ├─ src/server/http.ts：最小 HTTP 响应/请求兼容层
                     ├─ src/server/routes.ts：45 个静态导入的 API 路由
                     ├─ src/server/security.ts：Host、Origin、Basic Auth
                     └─ src/client/index.html + main.tsx：Bun HTML import React CSR
```

- `src/server.ts` 启动公开 Bun 服务和仅 loopback 的 HTML asset 服务；公开服务必须先执行安全校验。
- `src/server/routes.ts` 的 route import 必须保持静态，保证编译二进制可收集所有 API 依赖。
- `src/server/public-assets.ts` 只读取 `public/` 内嵌资产，禁止从 `import.meta.dir` 写入。
- API 使用 Web 标准 `Request`/`Response`；`src/server/http.ts` 只提供遗留业务模块需要的 JSON/`nextUrl` 最小适配，不可扩展成 Next.js 模拟层。
- React 客户端通过 `src/client/navigation.ts` 的 `useSyncExternalStore` location store 替换导航；`history.replaceState()` 后必须发出 `pi-web-x:navigation`。

## 兼容与安全不变量

- 所有 `/api/*` 路径、方法、状态码、JSON 字段和 SSE 事件语义保持兼容。
- 默认只监听 loopback。LAN 必须显式 `-H`，并使用 `PI_WEB_X_PASSWORD`、HTTPS 或可信 VPN。
- Host/API 来源校验位于 `lib/request-security.ts`，不得绕过。
- Host Runtime Environment 与 Project Command Environment 必须分离；运行 git/npm/npx/项目命令时不得泄露服务端变量。
- Pi 数据仍位于 `~/.pi/agent`；测试必须设置隔离 `HOME`，不得写真实凭据。
- plugins、skills、prompts、themes 从用户目录动态发现；它们不是编译资产。

## pi-web-x 断裂命名

新写入的产品标识一律使用 `pi-web-x`、`PI_WEB_X_*` 和 `pi-web-x:*`。不读取或迁移旧 `pi-web:*` custom type/localStorage/浏览器事件。Pi 通用 session 消息和配置格式仍保持兼容。

## 关键领域行为

- `AgentSessionWrapper` 必须以 `globalThis.__piSessions` 保存；热重载或重复启动不能丢失会话。
- `fork()` 会原地变更底层 session id，fork 后必须销毁旧 wrapper。
- `entryIds[]` 与展示消息并行，用于 fork 与 in-session branch。
- 文件访问边界仅允许会话 cwd、项目根、已授权根和 `~/pi-cwd-*`。
- built-in subagents 默认关闭；设置损坏时 fail closed。
- `mammoth` 是生产运行时依赖；DOCX 预览必须在编译二进制验证。

## 发布

主交付是八个原生二进制：darwin x64/arm64、linux glibc x64/arm64、linux musl x64/arm64、windows x64/arm64。npm wrapper 仅为已安装 Node 的用户提供启动入口，不得宣称 npm 路径无需 Node。

所有依赖替代决策记录在 [`docs/runtime-substitution-matrix.md`](docs/runtime-substitution-matrix.md)。
