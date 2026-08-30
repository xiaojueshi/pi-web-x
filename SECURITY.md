# 安全政策（Security Policy）

Pi Web X 是运行在本机的浏览器界面，默认仅监听 `127.0.0.1`。它不托管云服务，也不存储用户数据
的服务端副本——但它能代表用户执行高权限项目操作（git、npm/npx、文件读写），并读取
`~/.pi/agent` 下的真实会话、模型与认证数据。因此本项目按"本机可信边界"建模安全。

## 支持的版本

| 版本线 | 安全修复支持 |
| --- | --- |
| 最新 Release | ✅ 支持 |
| 上一个 minor | ⚠️ 尽力而为 |
| 更早版本 | ❌ 不提供 |

建议始终使用 GitHub Releases 中的最新版二进制。

## 报告漏洞

请通过 GitHub 的 **私有安全公告（Security Advisory）** 报告，而不是公开 issue：

1. 打开 <https://github.com/xiaojueshi/pi-web-x/security/advisories/new>
2. 填写影响范围、复现步骤与受影响版本；
3. 修复与公告发布前请不要公开细节。

也可以向维护者发送邮件：`dev@xiaojueshi.top`（主题前缀 `[pi-web-x security]`）。

我们会：

- 在确认后尽快回复（通常 48 小时内）；
- 对影响 loopback 之外暴露面的漏洞优先处理（见下）；
- 修复发布后在 Release notes 与公告中致谢。

## 已知暴露面与边界

以下行为**不是漏洞**，而是设计内的明确选择，请勿作为 issue 提交：

- **非 loopback 监听**：`-H 0.0.0.0` / `PI_WEB_X_HOSTNAME` 会把具备高权限项目操作的
  HTTP 服务暴露到网络。文档要求显式启用并配合长随机 `PI_WEB_X_PASSWORD`、HTTPS 反向代理或
  可信 VPN。协议本身不加密，`PI_WEB_X_PASSWORD` 走 HTTP Basic Auth。
- **无身份要求**：默认 loopback 监听下不要求密码——本机可达者即本机用户。
- **Basic Auth 单用户**：`PI_WEB_X_PASSWORD` 只启用一个 `pi` 用户，不支持多用户/细粒度 ACL。

### 发布物安全

- 每个 Release 附带 `SHA256SUMS`，请下载后校验：

  ```bash
  sha256sum -c SHA256SUMS
  ```

- 目前未对二进制做代码签名；macOS 首次运行可能触发 Gatekeeper 警告。计划中的签名里程碑
  见 `docs/release.md`。
- 依赖替代与运行时兼容性记录在 `docs/runtime-substitution-matrix.md`。

## 安全不变量（代码层面禁止绕过）

- Host / API 来源校验位于 `lib/request-security.ts`，任何路由不得绕过。
- Host Runtime Environment 与 Project Command Environment 必须分离；运行项目命令时不得
  泄露服务端变量。
- 文件访问仅允许会话 cwd、项目根、已授权根与 `~/pi-cwd-*`。
- 默认只监听 loopback；LAN 必须显式 `-H`。
- 测试必须设置隔离 `HOME`，不得写真实凭据。

## 报告什么

有价值但常见被误报为 issue 的内容：

- 日志、UI 中意外泄露的密钥/口令/路径；
- Host 校验、Basic Auth、TLS 相关绕过；
- 任意文件读写的路径穿越；
- 命令注入（插件/skills 安装、worktree、服务命令等执行路径）；
- 服务端变量向项目命令环境泄漏。
