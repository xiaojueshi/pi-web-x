# 安全政策（Security Policy）

Pi Web X 是可代表当前用户读取项目文件、执行命令并访问 `~/.pi/agent` 数据的本地 Web 应用。默认 loopback、Web Access Authentication、Host/Origin 校验和项目命令环境隔离共同构成安全边界；任何单项都不能替代其余边界。

## 支持版本

| 版本线 | 安全修复支持 |
| --- | --- |
| 最新 GitHub Release | 支持 |
| 上一个 minor | 尽力而为 |
| 更早版本 | 不支持 |

建议始终使用 [GitHub Releases](https://github.com/xiaojueshi/pi-web-x/releases) 中的最新版，并校验发布物哈希。

## 私密报告漏洞

请勿公开提交漏洞细节、凭据或可利用的复现。优先使用 GitHub 私有 Security Advisory：

1. 打开 <https://github.com/xiaojueshi/pi-web-x/security/advisories/new>；
2. 说明受影响版本、平台、影响、复现步骤和建议缓解方式；
3. 对日志、路径、会话与凭据完整脱敏；
4. 在修复与公告发布前不要公开细节。

也可以发送邮件至 `dev@xiaojueshi.top`，主题使用 `[pi-web-x security]` 前缀。维护者通常会在 48 小时内确认收到；修复时间取决于影响、复现与跨平台验证成本。

普通使用问题见 [SUPPORT.md](./SUPPORT.md)。

## 当前认证模型

### 浏览器访问

首次启动且浏览器认证尚未初始化时，服务向 stderr 输出一次性 setup token。用户通过 Setup 页面创建密码；后续使用随机 HttpOnly session Cookie 登录。修改密码会撤销已有浏览器 sessions。配置 Basic Auth fallback 不会抑制本地 setup token。

即使只监听 loopback，也必须完成 Web Access Authentication 初始化或使用明确配置的 Basic Auth fallback。**loopback 降低网络暴露面，但不等于免认证。**

Setup token 只存在于进程内存，不经 HTTP 返回、不写盘、只可使用一次。不得将其放入日志收集、录屏、issue 或聊天记录。

### Basic Auth fallback

`PI_WEB_X_PASSWORD` 在浏览器认证初始化前为脚本、测试与受控代理提供 HTTP Basic Auth，用户名固定为 `pi`。初始化后，Basic Auth 改为校验已存储的浏览器密码，环境 fallback 不再优先。Basic Auth 不加密传输，也不是多用户/细粒度 ACL。离开 loopback 时必须配合 HTTPS 或可信 VPN。

### 反向代理

反向代理必须覆盖转发的 Host/scheme headers、阻止不可信客户端直接访问后端，并保留同源约束。`PI_WEB_X_ALLOWED_HOSTS` 添加可信 hostname（端口会被规范化忽略），不是通配关闭检查。转发 scheme 会参与 Secure Cookie 判定；`PI_WEB_X_TRUSTED_PROXY=true` 仅让登录限流采用转发的客户端 IP。只有受控代理满足上述条件时才设置该变量。

## 已知边界与非漏洞

以下是明确设计边界，但其实现绕过仍可能是漏洞：

- 使用 `-H 0.0.0.0` 或非 loopback `PI_WEB_X_HOSTNAME` 会主动扩大服务暴露面。
- Pi Web X 是单用户本地工具，不提供多租户隔离、组织账号或细粒度 ACL。
- 已建立的 SSE 连接不会仅因中途会话复查而打断 Agent；新连接与重连仍需认证。
- 用户主动安装的 extensions、skills 和项目命令拥有其被授权能力；权限提升、边界绕过或未授权执行仍应报告。
- PWA 不离线执行 Agent、缓存会话历史或排队写操作。
- npm launcher 需要 Node.js；Release 原生二进制不需要 Node.js 或 Bun。这是运行时分发差异，不是供应链绕过。

## 安全不变量

- 所有公开请求必须经过 Host、认证与安全 header 检查；浏览器 API 请求还必须经过 Origin/Fetch Metadata 来源检查。
- 默认只监听 `127.0.0.1`；LAN 暴露必须显式启用。
- Host Runtime Environment 与 Project Command Environment 必须隔离。
- 项目命令不得继承服务密码、更新/资产镜像等 `PI_WEB_X_*` 变量。
- 文件访问只能覆盖会话 cwd、项目根、授权根和受支持临时根，并正确处理 symlink/canonical path。
- Pi Web X 自有认证数据位于 `~/.pi-web-x`，不得混入 `~/.pi/agent`。
- 测试使用隔离 `HOME`，不得读取真实会话、凭据、Cookie 或 setup token。
- 不读取或迁移旧 `pi-web:*` 产品命名空间。
- 发布物必须校验依赖、内嵌模块、资产与 SHA256；不得用源码运行结果代替编译二进制验证。

## 发布物安全

每个 Release 包含 `SHA256SUMS`。请从同一个 Release 获取二进制和校验文件，只筛选所下载平台制品对应的行进行验证；完整 checksum 文件还列有其他平台和资产归档，不能在只下载一个制品时直接整文件校验。Linux x64 glibc 示例：

```bash
grep ' pi-web-x-linux-x64$' SHA256SUMS | sha256sum -c -
```

macOS 使用 `shasum -a 256 -c`，Windows 使用平台提供的 SHA-256 工具。签名/notarization 与平台元数据状态以对应 Release notes 和[发布流程](./docs/maintainers/release.md)为准。发现制品、校验和、安装脚本或更新链路被篡改时，请按漏洞流程私密报告。

依赖替代和临时运行时 workaround 分别记录在[运行时替代矩阵](./docs/maintainers/runtime-substitution-matrix.md)与[上游 workaround 清单](./docs/maintainers/upstream-workarounds.md)。

## 建议报告的内容

- 未认证访问、session 固定/绕过、setup token 或 Cookie 泄漏；
- Host/Origin、代理 scheme、Basic Auth 或 TLS 边界绕过；
- 路径穿越、symlink 逃逸、任意文件读写；
- 命令注入或未授权的 plugin/skill/worktree/service 执行；
- Host Runtime 变量向 Project Command Environment 泄漏；
- 更新、资产、checksum 或 release 供应链问题；
- 日志/UI/通知意外泄露密钥、口令、会话内容或私有路径。
