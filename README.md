# Pi Web X

Pi Web X 是 [pi coding agent](https://github.com/earendil-works/pi) 的 Bun 原生本地浏览器界面。它以单文件二进制运行，并读取 pi 的通用本机会话、模型、认证与扩展数据。

> 基于 `pi-web@0.8.11` (`28bab3c`) 的独立兼容实现。产品命名空间已断裂：pi-web-x 不读取 `pi-web:*` 浏览器偏好或 session custom type。

## 安装与运行

### 一键安装（自动探测平台 + 最新版本）

macOS / Linux（需要 curl 或 wget）：

```bash
curl -fsSL https://raw.githubusercontent.com/xiaojueshi/pi-web-x/main/install.sh | sh
```

Windows（PowerShell 5.1+）：

```powershell
irm https://raw.githubusercontent.com/xiaojueshi/pi-web-x/main/install.ps1 | iex
```

脚本行为：

- 自动探测 OS / 架构 / libc（glibc vs musl），选择对应的 GitHub Release 二进制
- 默认安装**最新版本**（也可 `sh install.sh --version v0.9.0` 固定版本）
- 交互终端下显示实时进度条与下载大小预估，分步输出每一步的完成状态；下载失败会给出明确提示与重试建议
- 下载后校验 `SHA256SUMS`，哈希不符即中止
- macOS/Linux 安装到 `~/.pi-web-x`（真实安装根，二进制与内置资产同目录；`--dir` 可覆盖），
  并在 `~/.local/bin` 建立命令入口符号链接；Windows 默认安装到 `%USERPROFILE%\pi-web-x` 并注册进用户 PATH。macOS/Linux 的旧 `~/pi-web-x` 安装会自动迁移
- 已安装同版本时跳过（幂等），`--force` 强制重装
- 首次启动自动获取内置资产（主题等目录级资产）；内网离线可用
  `pi-web-x assets install <包路径>` 手动安装；`pi-web-x update` 一键自更新。若已注册系统服务，更新后会自动重启；旧安装根迁移时还会修复服务中的二进制路径。服务恢复失败会以非零码报告，但已验证的新二进制会保留，可检查日志后重试更新。

> 安全提示：脚本经 HTTPS 从本仓库拉取，二进制哈希与 Release 内 `SHA256SUMS` 交叉校验。不信任管道安装时，可先下载 `install.sh` 审阅后再执行，或直接下载二进制 `sha256sum -c SHA256SUMS` 手动安装。

### 手动下载

从对应平台的 GitHub Release 下载二进制后执行：

```bash
./pi-web-x
# 浏览器打开 http://127.0.0.1:30141
```

二进制自身不需要 Node.js 或 Bun。git、npm/npx 仅在使用 worktree、插件或 skills 安装功能时按需需要。

### 浏览器访问认证

首次启动且尚未初始化认证时，服务会在**启动日志**输出一次性设置令牌。打开浏览器页面后输入该令牌并设置密码，即可启用浏览器访问认证。设置令牌只在当前服务进程中有效，不能通过 HTTP 接口读取；请勿将其写入终端录屏、日志收集或聊天记录。

初始化后，浏览器使用 HttpOnly 会话 Cookie 登录。可在“设置 → 安全”中修改密码（会使所有设备重新登录）或退出当前设备。认证配置保存在 `~/.pi-web-x/auth/`；它与 Pi 通用数据目录 `~/.pi/agent` 分离。

`PI_WEB_X_PASSWORD` 保留为 Basic Auth 回退，用于脚本化客户端或反向代理场景；它不迁移、不读取旧 `PI_WEB_*` 变量。

### PWA Companion

支持的浏览器可将页面安装为 PWA，用于在手机上查看和继续已运行的 Agent 会话。Agent 仍只在运行中的 `pi-web-x` 服务上执行：PWA 不会离线执行 Agent、缓存会话历史或排队写操作。

- Service Worker 有更新时，界面会提供“更新”操作；确认前不会替换当前资源，避免打断未发送输入或进行中的任务。
- 完成任务后可由用户主动允许系统通知；不授权或浏览器不支持时，应用保持页面内提示。
- `localhost` 可使用浏览器的安全上下文能力；通过 LAN 或反向代理访问时，应配置 HTTPS 以及 `PI_WEB_X_PASSWORD` 或浏览器访问认证。界面会说明当前连接下 PWA、通知等能力的限制，但不判断网络是否公开。

### 启动选项

```text
pi-web-x [-p <port>] [-H <hostname>] [--no-open]
```

| 变量 | 作用 |
| --- | --- |
| `PORT` | 默认端口（默认 `30141`） |
| `PI_WEB_X_HOSTNAME` | 默认监听主机（默认 `127.0.0.1`） |
| `PI_WEB_X_NO_OPEN` | 设置为 `1/true/yes/on` 时不自动打开浏览器 |
| `PI_WEB_X_PASSWORD` | 启用用户名为 `pi` 的 HTTP Basic Auth |
| `PI_WEB_X_ALLOWED_HOSTS` | 允许的额外代理/自定义 Host，逗号分隔 |
| `PI_WEB_X_SKIP_VERSION_CHECK` | 禁用版本检查 |

非 loopback 监听会暴露可执行高权限项目操作的服务。请使用长随机 `PI_WEB_X_PASSWORD`，并通过 HTTPS 反向代理或可信 VPN 保护传输。

### 注册为系统服务

`pi-web-x service` 子命令把服务注册为操作系统服务（用户级，无需 root），登录后自动启动：

```bash
pi-web-x service install                # 注册并启动（快照当前 PORT / PI_WEB_X_HOSTNAME）
pi-web-x service install -p 8080 -H 0.0.0.0 --force   # 指定快照并覆盖已有服务
pi-web-x service uninstall              # 停止并移除服务（保留配置）
pi-web-x service --help
```

平台支持：

| 平台 | 注册机制 | 说明 |
| --- | --- | --- |
| Linux（systemd） | `~/.config/systemd/user/pi-web-x.service` | 日志：`journalctl --user -u pi-web-x`；自动尝试 `loginctl enable-linger` 实现无登录自启 |
| macOS | `~/Library/LaunchAgents/com.pi-web-x.plist` | 日志：`~/Library/Logs/pi-web-x.{out,err}.log`；`KeepAlive` 崩溃自动重启 |
| Windows | Task Scheduler 任务 `pi-web-x`（ONLOGON） | 日志重定向到 `%USERPROFILE%\.pi-web-x\service.log`；无崩溃重启 |
| 无 systemd 的 Linux | 不支持 | 报错并给出手动指引 |

安装时以**调用用户**的身份运行，保证 `~/.pi/agent` 数据归属正确；配置快照落盘后可直接编辑（Linux 为 `~/.pi-web-x/env`，0600 权限）。Windows 上若快照了 `PI_WEB_X_PASSWORD`，密码会以明文出现在任务定义中，安装时会警告。已存在服务时安装会交互确认，可用 `--force` 跳过、`--no-input` 禁止提示。

## 开发

需要 Bun 1.4：

```bash
bun install
bun test
bun run test:bun
bun run typecheck
bun run build:all
```

`bun run build` 生成本机 Linux x64 二进制；`bun run build:all` 生成八个平台制品。不要引入 Next.js；前端入口是 `src/client/index.html`，服务端入口是 `src/cli.ts`。

## 许可证与来源

MIT。保留上游 pi-web 的版权与许可证；详细迁移和依赖替代状态见 [`MIGRATION.md`](./MIGRATION.md) 与 [`docs/runtime-substitution-matrix.md`](./docs/runtime-substitution-matrix.md)。等待上游处理的项目临时实现统一登记在 [`docs/upstream-workarounds.md`](./docs/upstream-workarounds.md)。
