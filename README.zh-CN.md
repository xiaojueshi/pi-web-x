# Pi Web X

[English](./README.md) · [简体中文](./README.zh-CN.md) · [日本語](./README.ja.md) · [Русский](./README.ru.md)

Pi Web X 是 [pi coding agent](https://github.com/earendil-works/pi) 的 Bun 原生本地浏览器界面。它以平台原生可执行文件运行，并复用 pi 已有的会话、模型、凭据、扩展、skills、prompts 和 themes。

> Pi Web X 是基于 `pi-web@0.8.11`（`28bab3c`）的独立兼容实现。产品命名空间已主动断裂，不读取或迁移旧 `pi-web:*` 浏览器偏好与 session custom entries。

## 主要能力

- 为 macOS、Linux（glibc/musl）和 Windows 的 x64/arm64 提供单个原生可执行文件。
- 浏览器内运行 React 19 CSR；不使用 Next.js、RSC、SSR 或 Node.js 服务端运行时。
- 支持会话浏览、Agent 流式输出、文件、Git/worktree、模型与凭据设置、plugins、skills、prompts、themes、subagents 和 PWA。
- 默认仅监听 loopback，并执行 Host/Origin 校验与浏览器密码认证。
- Pi 通用数据位于 `~/.pi/agent`，Pi Web X 自有数据位于 `~/.pi-web-x`。

## 安装

### 一键安装

macOS 或 Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/xiaojueshi/pi-web-x/main/install.sh | sh
```

Windows PowerShell 5.1 或更高版本：

```powershell
irm https://raw.githubusercontent.com/xiaojueshi/pi-web-x/main/install.ps1 | iex
```

安装脚本会检测操作系统、架构与 Linux libc，从 GitHub Release 下载匹配产物，校验 `SHA256SUMS`，并为当前用户安装命令。如果安全策略不允许管道执行脚本，请先下载并审阅脚本。

### 手动下载

从 [GitHub Releases](https://github.com/xiaojueshi/pi-web-x/releases) 下载当前平台的可执行文件，然后运行：

```bash
./pi-web-x
# 打开 http://127.0.0.1:30141
```

| 使用方式 | 需要 Bun | 需要 Node.js |
| --- | --- | --- |
| GitHub Release 原生二进制 | 否 | 否 |
| 从源码开发和构建 | Bun 1.4.0 | 否 |
| 可选 npm launcher | 否 | 是，仅 launcher 需要 |
| 安装 plugin/skill、部分 worktree 操作 | 否 | 被调用功能可能需要 `git` 和 `npm`/`npx` |

编译产物已内嵌 Bun runtime。`node:path` 等 imports 使用 Bun 的 Node.js compatibility APIs，并不代表服务端改由 Node.js 运行。

离线资产、镜像、自更新与平台细节见[安装与更新指南](./docs/guides/installation.md)。

## 首次启动与安全

首次启动时，服务会向 stderr 输出一次性 setup token。打开浏览器、输入该 token 并创建密码。后续浏览器访问使用 HttpOnly session Cookie。认证数据保存在 `~/.pi-web-x/auth/`，与 `~/.pi/agent` 下的 pi 数据分离。

服务默认只监听 `127.0.0.1`。使用 `-H 0.0.0.0` 会把可执行高权限项目操作的服务暴露到网络。请启用浏览器认证或设置长随机 `PI_WEB_X_PASSWORD`，并使用 HTTPS 或可信 VPN。网络部署前请阅读 [SECURITY.md](./SECURITY.md)。

## 运行与配置

```text
pi-web-x [-p <port>] [-H <hostname>] [--no-open]
pi-web-x service install|uninstall
pi-web-x update [--check]
pi-web-x assets status
pi-web-x assets install <archive>
```

常用环境变量：

| 变量 | 作用 |
| --- | --- |
| `PORT` | 端口，默认 `30141` |
| `PI_WEB_X_HOSTNAME` | 监听地址，默认 `127.0.0.1` |
| `PI_WEB_X_NO_OPEN` | 为 `1/true/yes/on` 时不打开浏览器 |
| `PI_WEB_X_PASSWORD` | 用户名为 `pi` 的 HTTP Basic Auth 回退 |
| `PI_WEB_X_ALLOWED_HOSTS` | 额外可信 Host，逗号分隔 |
| `PI_WEB_X_SKIP_VERSION_CHECK` | 禁用版本检查 |

详细说明见[配置](./docs/guides/configuration.md)、[浏览器认证](./docs/guides/authentication.md)、[系统服务](./docs/guides/system-service.md)、[PWA](./docs/guides/pwa.md)和 [Git worktree](./docs/guides/worktrees.zh-CN.md) 指南。

## 开发

源码开发、测试与发布构建统一使用 **Bun 1.4.0**：

```bash
bun install --frozen-lockfile
bun run dev
bun test
bun run typecheck
bun run lint
bun run build
```

`bun run build` 构建 Linux x64 二进制；`bun run build:all` 构建八个平台产物。TypeScript 显式加载 `bun` 与 `node` 两组声明：Bun 类型描述真实运行时，Node 类型描述 Bun 兼容的 `node:*` 模块。可选 npm launcher 是项目中唯一实际运行于 Node.js 的路径。

修改代码前请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)、[架构概览](./docs/development/architecture.md)、[Bun/Node 运行时与类型边界](./docs/development/bun-and-node.md)和[测试指南](./docs/development/testing.md)。

## 文档与支持

[文档索引](./docs/README.md)按用户指南、开发参考、架构决策、迁移历史和维护流程组织全部文档。

- 使用问题与可复现缺陷：[GitHub Issues](https://github.com/xiaojueshi/pi-web-x/issues)
- 贡献流程：[CONTRIBUTING.md](./CONTRIBUTING.md)
- 安全漏洞：[SECURITY.md](./SECURITY.md)，请勿公开提交凭据
- 版本历史：[CHANGELOG.md](./CHANGELOG.md)
- 社区行为准则：[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

## 许可证与来源

[MIT](./LICENSE)。保留上游 pi-web 的版权和许可声明。历史迁移过程见 [`docs/history/bun-migration.md`](./docs/history/bun-migration.md)；当前依赖决策与等待上游后可移除的临时实现统一记录在 [`docs/maintainers/`](./docs/maintainers/)。
