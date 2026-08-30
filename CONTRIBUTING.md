# 贡献指南（Contributing）

欢迎参与 Pi Web X 的开发。请先阅读 [README.md](./README.md) 了解项目定位，以及
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)（若存在）中的社区约定。

## 环境准备

- 语言版本管理统一使用 **mise**，Bun 固定 **1.4.0**。不要引入 nvm/fnm/sdkman 等其它版本管理器。
- 不要引入 Next.js、RSC、SSR 或 Node 服务端运行时；`bun build --compile` 是发布门槛。
- 包管理器使用 Bun 自带安装（`bun install`），不要使用 pnpm 接管依赖。

```bash
mise install
bun install
```

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `bun run dev` | 本地开发（127.0.0.1:30141，自动打开浏览器） |
| `bun test` | 单元测试（Bun 原生测试运行器） |
| `bun run test:bun` | 仅 `tests/` 目录路由测试 |
| `bun run typecheck` | TypeScript 类型检查 |
| `bun run build` | 构建本机 Linux x64 单文件二进制 |
| `bun run build:all` | 构建八个平台二进制（发布物） |
| `bun run test:e2e` | 在编译产物上跑 Playwright 端到端测试 |

## 开发约束（不变量）

- 所有 `/api/*` 路径、方法、状态码、JSON 字段与 SSE 事件语义保持兼容；允许新增字段。
- 默认只监听 loopback；LAN 必须显式 `-H`，并配合 `PI_WEB_X_PASSWORD`、HTTPS 或可信 VPN。
- Host/API 来源校验位于 `lib/request-security.ts`，不得绕过。
- Host Runtime Environment 与 Project Command Environment 必须分离；运行项目命令时不得
  泄露服务端变量。
- Pi 数据位于 `~/.pi/agent`；**测试必须设置隔离 `HOME`，不得写真实凭据**。
- 新写入的产品标识一律使用 `pi-web-x` / `PI_WEB_X_*` / `pi-web-x:*`，不读写旧 `pi-web:*`
  命名空间。
- `AgentSessionWrapper` 必须以 `globalThis.__piSessions` 保存；`fork()` 会原地变更底层
  session id，fork 后必须销毁旧 wrapper。
- `mammoth` 是生产运行时依赖；DOCX 预览必须在编译二进制验证。
- 依赖替代决策必须同步记录到 `docs/runtime-substitution-matrix.md`。

## 提交规范

提交信息使用简体中文，推荐 `<type>: <描述>` 前缀（`feat` / `fix` / `build` / `chore` /
`docs` / `test` / `refactor` / `防御` / `文档` 等，沿用仓库现状即可）。

合理拆分提交：一次提交只做一件事。引入 lint/格式化的历史清扫类改动单独提交，便于 review。

## 发布流程

见 [docs/release.md](./docs/release.md)：发布前检查、八平台制品、签名/公证要求、
版本检查与发布说明。发布由维护者推送 `v*` tag 触发 GitHub Actions（`.github/workflows/release.yml`）。

## Pull Request 流程

1. 从 `main` 开分支，或在 fork 中开发；
2. 通过 GitHub Actions 的 CI（单元测试 + 类型检查 + 八平台构建）；
3. 在 PR 描述中说明变更动机、影响面与测试方式；
4. 维护者 review 后合并；合并前保持分支与 `main` 同步。

涉及安全边界（暴露面、凭据、文件访问、命令执行）的变更会被格外仔细地 review。
