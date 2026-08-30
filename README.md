# Pi Web X

Pi Web X 是 [pi coding agent](https://github.com/earendil-works/pi) 的 Bun 原生本地浏览器界面。它以单文件二进制运行，并读取 pi 的通用本机会话、模型、认证与扩展数据。

> 基于 `pi-web@0.8.11` (`28bab3c`) 的独立兼容实现。产品命名空间已断裂：pi-web-x 不读取 `pi-web:*` 浏览器偏好或 session custom type。

## 安装与运行

从对应平台的 GitHub Release 下载二进制后执行：

```bash
./pi-web-x
# 浏览器打开 http://127.0.0.1:30141
```

二进制自身不需要 Node.js 或 Bun。git、npm/npx 仅在使用 worktree、插件或 skills 安装功能时按需需要。

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

安装时以**调用用户**的身份运行，保证 `~/.pi/agent` 数据归属正确；配置快照落盘后可直接编辑（Linux 为 `~/.config/pi-web-x/env`，0600 权限）。Windows 上若快照了 `PI_WEB_X_PASSWORD`，密码会以明文出现在任务定义中，安装时会警告。已存在服务时安装会交互确认，可用 `--force` 跳过、`--no-input` 禁止提示。

## 开发

需要 mise 中的 Bun 1.4：

```bash
bun install
bun test
bun run test:bun
bun run typecheck
bun run build:all
```

`bun run build` 生成本机 Linux x64 二进制；`bun run build:all` 生成八个平台制品。不要引入 Next.js；前端入口是 `src/client/index.html`，服务端入口是 `src/cli.ts`。

## 许可证与来源

MIT。保留上游 pi-web 的版权与许可证；详细迁移和依赖替代状态见 [`MIGRATION.md`](./MIGRATION.md) 与 [`docs/runtime-substitution-matrix.md`](./docs/runtime-substitution-matrix.md)。
