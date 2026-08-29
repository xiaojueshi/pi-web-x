# Pi Web X

Pi Web X 是 [pi coding agent](https://github.com/earendil-works/pi) 的 Bun 原生本地浏览器界面。它以单文件二进制运行，读取 pi 的通用本地会话、模型、认证和扩展数据。

## 使用

从 GitHub Release 下载当前平台的二进制：

```bash
./pi-web-x
# 访问 http://127.0.0.1:30141
```

运行二进制不需要 Node.js 或 Bun；使用插件、skills 安装和部分 worktree 功能时，系统仍需要 git、npm/npx。

## 配置

```bash
pi-web-x -p 8080 -H 127.0.0.1 --no-open
PI_WEB_X_PASSWORD='足够长的随机密码' pi-web-x -H 0.0.0.0
```

| 变量 | 作用 |
| --- | --- |
| `PORT` | 默认端口（`30141`） |
| `PI_WEB_X_HOSTNAME` | 默认监听地址（`127.0.0.1`） |
| `PI_WEB_X_NO_OPEN` | 不自动打开浏览器 |
| `PI_WEB_X_PASSWORD` | 启用用户名为 `pi` 的 HTTP Basic Auth |
| `PI_WEB_X_ALLOWED_HOSTS` | 允许的额外代理/自定义 Host |

非 loopback 监听会暴露可执行高权限项目操作的服务；必须使用长随机密码以及 HTTPS 反向代理或可信 VPN。

## 兼容说明

项目基于 `pi-web@0.8.11` 的独立兼容实现。HTTP API 与 Pi 通用数据格式保持兼容；产品标识完全断裂，pi-web-x 仅写入 `pi-web-x:*`、`PI_WEB_X_*`，不会读取旧 `pi-web:*` 偏好或 custom type。

## 开发

```bash
bun install
npm test
npm run test:bun
npm run typecheck
npm run build:all
```

详见 [迁移方案](./MIGRATION.md)、[运行时替代矩阵](./docs/runtime-substitution-matrix.md) 和 [开发说明](./AGENTS.md)。

## 许可证

[MIT](./LICENSE)。保留上游 pi-web 的版权与许可证。
