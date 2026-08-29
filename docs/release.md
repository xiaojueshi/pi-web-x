# Pi Web X 发布流程

每个 release 发布八个单文件二进制，而不是 Next.js build 或 Node 服务端包。

## 发布前检查

```bash
bun install --frozen-lockfile
npm test
npm run test:bun
npm run typecheck
npm run build:all
```

`dist/` 必须包含：

- `pi-web-x-darwin-x64`、`pi-web-x-darwin-arm64`
- `pi-web-x-linux-x64`、`pi-web-x-linux-arm64`
- `pi-web-x-linux-x64-musl`、`pi-web-x-linux-arm64-musl`
- `pi-web-x-windows-x64.exe`、`pi-web-x-windows-arm64.exe`

在每个目标平台至少执行 `--help` 和 HTTP 冒烟测试；Linux 必须分别在 glibc 和 musl 环境验证。macOS 发布前完成签名/notarization，Windows 发布前完成签名与 SmartScreen 所需元数据。

## 制品检查

```bash
./dist/pi-web-x-linux-x64 --help
HOME="$(mktemp -d)" ./dist/pi-web-x-linux-x64 --port 30141 --no-open
```

对启动后的产物验证根页面、`/api/home`、Host 拒绝、Basic Auth、`manifest.webmanifest`、`sw.js` 和图标。不得用本机 Bun 运行替代已编译产物测试。

## 版本检查与发布说明

版本变更后，更新 `package.json`、`bun.lock`，重新构建所有制品。发布说明必须说明：

- Bun 精确版本与目标平台；
- 本次上游基线或安全修复；
- `pi-web-x` 命名空间与旧 `pi-web:*` 不兼容；
- 保留/替代的依赖变更（同步更新运行时替代矩阵）。
