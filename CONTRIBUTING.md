# 贡献指南（Contributing）

感谢参与 Pi Web X。提交 issue 或代码前，请先阅读 [README](./README.md)、[行为准则](./CODE_OF_CONDUCT.md)和[文档索引](./docs/README.md)。安全漏洞不得通过公开 issue 报告，请遵循 [SECURITY.md](./SECURITY.md)。

## 开发环境

Pi Web X 的源码运行时、包管理器、测试运行器、bundler 和二进制编译器统一使用 **Bun 1.4.0**。

```bash
bun --version
bun install --frozen-lockfile
```

不要使用 npm、pnpm 或 yarn 接管依赖安装，也不要引入 nvm/fnm/sdkman 等版本管理流程。项目环境统一由 mise 管理时，仍以仓库声明的 Bun 版本为准。

Node.js 不是应用服务端运行时。`node:*` imports 使用 Bun compatibility APIs；`@types/node` 只提供类型；`bin/pi-web-x.js` 是 npm 发布渠道的可选 Node launcher。完整边界见 [Bun 与 Node.js 说明](./docs/development/bun-and-node.md)。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `bun run dev` | 本地开发，监听 `127.0.0.1:30141` |
| `bun run dev:lan` | 显式监听 `0.0.0.0`；只用于受保护网络 |
| `bun test` | 全部非 E2E Bun 测试 |
| `bun run test:bun` | `tests/` 下的测试 |
| `bun run typecheck` | TypeScript 类型检查 |
| `bun run lint` | ESLint 与 React hooks 检查 |
| `bun run build` | 构建 Linux x64 单文件二进制 |
| `bun run build:all` | 构建八个平台发布物 |
| `bun run test:e2e` | 构建产物上的 Playwright 黑盒测试 |

测试分层、隔离要求和平台门槛见[测试指南](./docs/development/testing.md)。

## 项目结构

```text
app/api/              Web-standard Request/Response API handlers
components/           React UI
hooks/                Client state and side effects
lib/                  Domain, SDK, security, and compatibility modules
src/cli.ts            CLI entry
src/server.ts         Bun server entry
src/server/           Routing, HTTP adapter, security, public assets
src/client/           Bun HTML import and React CSR entry
scripts/              Bun build/release helpers
tests/unit/           Bun unit/contract/compiled-binary tests
tests/e2e/            Playwright tests against compiled output
docs/guides/          User guides
docs/development/     Contributor-facing technical documentation
docs/maintainers/     Release and dependency maintenance records
docs/history/         Completed migration records
docs/adr/, CONTEXT.md Established Agent/architecture dependencies; do not reorganize casually
```

架构请求链和运行时资源边界见[架构概览](./docs/development/architecture.md)。

## 开发不变量

- 不引入 Next.js、RSC、SSR 或 Node.js 服务端运行时。
- 所有 `/api/*` 路径、方法、状态码、JSON 字段与 SSE 事件语义保持兼容；新增字段必须向后兼容。
- 公开服务必须先执行 Host、Origin 与认证校验，不得绕过 `lib/request-security.ts`。
- 默认仅监听 loopback。非 loopback 必须显式启用，并使用认证、HTTPS 或可信 VPN。
- Host Runtime Environment 与 Project Command Environment 必须隔离，不得把 `PI_WEB_X_*` 等服务端变量泄露给项目命令。
- 文件访问只能覆盖会话 cwd、项目根、授权根与受支持的临时根；必须处理 symlink/canonical path。
- Pi 通用数据位于 `~/.pi/agent`；Pi Web X 自有数据位于 `~/.pi-web-x`。
- 测试必须使用隔离 `HOME`，不得读取或写入真实凭据、会话和认证文件。
- 新产品标识只能使用 `pi-web-x`、`PI_WEB_X_*` 和 `pi-web-x:*`；不读取或迁移旧 `pi-web:*`。
- `AgentSessionWrapper` 保存在 `globalThis.__piSessions`；`fork()` 原地改变底层 id 后必须销毁旧 wrapper。
- route imports 保持静态，确保 `bun build --compile` 能收集依赖。
- `mammoth` 等运行时依赖必须在真实编译二进制中验证。

Agent/ADR 依赖文件只有在专门的架构变更中修改；一般文档整理不得移动 `docs/adr/**`、`CONTEXT.md` 或 `.pi/**`。

## 文档变更

行为变更必须同步更新对应权威文档。目录归属、语言、多 README 同步和兼容链接规则见[文档规范](./docs/development/documentation.md)。

新增或修改：

- CLI/环境变量 → `docs/guides/configuration.md`
- 安装/更新 → `docs/guides/installation.md`
- 认证/暴露面 → `SECURITY.md` 与认证指南
- 测试/构建 → 测试指南
- 依赖替代 → `docs/maintainers/runtime-substitution-matrix.md`
- 等待上游的临时实现 → `docs/maintainers/upstream-workarounds.md`
- 发布流程 → `docs/maintainers/release.md`

运行 `bun test tests/unit/docs-links.test.ts` 检查相对链接。

## 提交规范

提交信息使用简体中文，推荐 `<type>: <描述>`：`feat`、`fix`、`docs`、`test`、`refactor`、`build`、`chore` 等。

一次提交只处理一个明确主题。格式化或历史清扫与功能改动分开提交。提交前运行：

```bash
git diff --check
bun run typecheck
bun run lint
bun test
bun run build
```

按改动范围补充 `build:all` 和 E2E。未执行的验证必须在 PR 中如实说明。

## Pull Request 流程

1. 从 `main` 创建分支或 fork。
2. 先添加/更新测试，再完成实现和文档。
3. 填写 PR 模板的动机、影响面、验证结果、兼容与安全检查。
4. 保持改动聚焦，并响应 review。
5. 合并前确保 CI 通过并与 `main` 同步。

涉及认证、网络暴露、凭据、文件访问、命令执行、环境隔离或发布物的改动会接受额外安全审查。

## 发布

发布由维护者执行。权威流程见 [`docs/maintainers/release.md`](./docs/maintainers/release.md)。不要在普通 PR 中创建 tag、发布 Release 或提交构建产物，除非维护者明确要求。
