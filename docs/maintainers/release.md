# Pi Web X 发布流程

[维护者文档](./README.md) · [发布说明归档](./release-notes/README.md) · [测试指南](../development/testing.md)

每个 Release 发布八个 Bun 编译的单文件二进制，而不是 Next.js build 或 Node.js 服务端包。Release 二进制内嵌 Bun runtime；Node.js 只与可选 npm launcher 有关。

## 发布前检查

```bash
bun install --frozen-lockfile
git diff --check
bun run lint
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

版本变更后，更新 `package.json`、`CHANGELOG.md` 以及受版本影响的生成文件（当前为 `src/generated/asset-manifest.ts`）；如 `bun.lock` 的顶层元数据发生变化也一并提交。重新构建所有制品，确认 `pi-web-x --version` 输出与 tag 相同。若 CLI 参数、安装脚本或产物命名有变化，需在发布说明中同步说明。发布说明必须说明：

- Bun 精确版本与目标平台；
- 本次上游基线或安全修复；
- `pi-web-x` 命名空间与旧 `pi-web:*` 不兼容；
- 保留/替代的依赖变更（同步更新运行时替代矩阵）。

**发布说明必须逐条描述本次修改了什么、改进了哪些功能**，不得只列条目标题或笼统概括。每个修复/新增项须说明：改动前的问题或行为、改动后的行为、用户可感知的效果（哪个问题消失、用法/配置是否变化），以及涉及的入口（命令、页面、API）。发布说明归档按 `docs/maintainers/release-notes/README.md` 的“概要 → 新增与改进 → 修复 → 兼容与安全 → 构建与制品”结构编写；CI 生成的 Draft Release 说明应以该归档为来源，两者内容一致。只重复标题、缺少用户可见效果描述的发布说明不允许发布。

当前 GitHub Actions 在推送 `v*` tag 后构建八平台制品、生成 `SHA256SUMS` 并创建 Draft Release。发布前先推送主分支，再推送带注释的 tag：

```bash
git push origin main
git tag -a vX.Y.Z -m "发布 vX.Y.Z"
git push origin vX.Y.Z
```

Draft Release 的说明应以对应版本的 `CHANGELOG.md` 为基础，并保存一份可审阅的源文档到 `docs/maintainers/release-notes/vX.Y.Z.md`；该文档须补齐上列发布说明要求。核对八个二进制、`pi-web-x-assets-<版本>.tar.gz` 和 `SHA256SUMS` 全部上传后，才可从 Draft 发布。

## 一键安装脚本

- `install.sh`（POSIX sh，macOS/Linux）：自动探测 OS/架构/libc，从 `releases/latest/download` 拉取对应二进制并校验 SHA256SUMS，安装到 `~/.pi-web-x`，并在 `~/.local/bin` 创建命令入口。
- `install.ps1`（PowerShell，Windows）：同上能力，默认安装到 `%USERPROFILE%\pi-web-x` 并注册用户级 PATH。

改动任一脚本后必须同步：

1. 仓库 `README.md` 与发布说明中的安装命令；
2. 执行 `sh -n install.sh`、`sh install.sh --help`，并在可用的 Windows/PowerShell 环境执行 `Parser::ParseFile` 语法检查；如将这些检查加入 CI，需同步维护对应 job；
3. `tests/unit/install-script.test.ts` 中 dry-run 探测断言与产物命名保持一致；
4. 脚本内的 `REPO` / `BASE_URL` / `RAW_BASE` 常量。

发布说明应给出两条命令：

```bash
curl -fsSL https://raw.githubusercontent.com/xiaojueshi/pi-web-x/main/install.sh | sh
```

```powershell
irm https://raw.githubusercontent.com/xiaojueshi/pi-web-x/main/install.ps1 | iex
```
