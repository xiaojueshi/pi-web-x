# Pi Web X 发布流程

每个 release 发布八个单文件二进制，而不是 Next.js build 或 Node 服务端包。

## 发布前检查

```bash
bun install --frozen-lockfile
bun test
bun run test:bun
bun run typecheck
bun run build:all
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

版本变更后，更新 `package.json`、`bun.lock`，重新构建所有制品。若 `--version` 输出、CLI 参数、安装脚本或产物命名有变化，需在发布说明中同步说明。发布说明必须说明：

- Bun 精确版本与目标平台；
- 本次上游基线或安全修复；
- `pi-web-x` 命名空间与旧 `pi-web:*` 不兼容；
- 保留/替代的依赖变更（同步更新运行时替代矩阵）。

## 一键安装脚本

- `install.sh`（POSIX sh，macOS/Linux）：自动探测 OS/架构/libc，从 `releases/latest/download` 拉取对应二进制并校验 SHA256SUMS，安装到 `~/.local/bin`。
- `install.ps1`（PowerShell，Windows）：同上能力，额外注册用户级 PATH。

改动任一脚本后必须同步：

1. 仓库 `README.md` 与发布说明中的安装命令；
2. CI 的 `install-scripts` job（`sh -n` + `--help` 分支）与 Windows pwsh 语法检查（`Parser::ParseFile`）；
3. `tests/unit/install-script.test.ts` 中 dry-run 探测断言与产物命名保持一致；
4. 脚本内的 `REPO` / `BASE_URL` / `RAW_BASE` 常量。

发布说明应给出两条命令：

```bash
curl -fsSL https://raw.githubusercontent.com/xiaojueshi/pi-web-x/main/install.sh | sh
```

```powershell
irm https://raw.githubusercontent.com/xiaojueshi/pi-web-x/main/install.ps1 | iex
```
