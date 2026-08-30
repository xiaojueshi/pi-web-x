# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，按 [SemVer](https://semver.org/lang/zh-CN/) 版本。

## [0.8.12] - 2026-08-30

### 新增

- 目录级资产自举：pi-coding-agent 的内置主题/导出模板等目录资产打包为 `pi-web-x-assets-<版本>.tar.gz` 随 Release 发布；二进制启动时自动校验、下载并解压到自身目录（`PI_WEB_X_ASSETS_URL` 可配内网镜像；失败冷却 24h 重试且不阻断启动）。
- CLI 子命令：
  - `update`：检测并一键自更新（SHA256SUMS 校验、旧版备份、原子替换；`--check` 仅检测；`PI_WEB_X_UPDATE_URL`/`PI_WEB_X_RELEASE_BASE` 可配镜像）
  - `assets status` / `assets install <包路径>`：查看内置资产状态、内网离线安装资产包
- 安装脚本新布局：`install.sh`/`install.ps1` 默认安装到 `~/pi-web-x`（真实二进制与资产同目录），命令入口改为 `~/.local/bin/pi-web-x` 符号链接（Windows 注册目录 PATH）；旧的单文件直装 `~/.local/bin` 布局自动备份迁移。
- 一键安装脚本：`install.sh`（macOS/Linux，POSIX sh）与 `install.ps1`（Windows PowerShell），自动探测平台与 libc、下载对应最新二进制、SHA256SUMS 校验、安装到 `~/pi-web-x` 并注册 PATH 入口；幂等（同版本跳过）、支持 `--dir/--version/--force/--dry-run`。
- CLI 新增 `--version`/`-v`（编译二进制与 npm wrapper 同步支持）。

### 修复

- 编译二进制部署下（单文件发布物无内置主题资产），`/api/agent/new` 会因 `initTheme()` 抛 `ENOENT: theme/dark.json` 而整体 500。现由 `lib/theme-init.ts` 兜底（失败注入无样式主题、告警一次、不阻断会话创建），配合启动自举彻底消除。
- `app/api/sessions/[id]/export`：纯二进制部署（无 Node 环境）下给出明确的中文降级提示，不再抛出难以理解的 “pi CLI not found”。

## [0.8.11] - 2026-02-11

首次开源发布。基于迁移自 `pi-web@0.8.11`（upstream commit `28bab3c`）的独立兼容实现，详见 [MIGRATION.md](./MIGRATION.md) 与 [docs/runtime-substitution-matrix.md](./docs/runtime-substitution-matrix.md)。

### 新增

- `service` 子命令：注册系统服务并支持开机自启
  - Linux（systemd user unit，自动 `loginctl enable-linger`）
  - macOS（launchd LaunchAgent，`KeepAlive` 崩溃自动重启）
  - Windows（Task Scheduler `ONLOGON`）
- 八平台单文件原生二进制发布物（darwin/linux/glibc+musl/windows × x64/arm64）
- GitHub Actions：
  - `.github/workflows/ci.yml`：三 OS 矩阵的测试、类型检查、八平台构建与冒烟
  - `.github/workflows/release.yml`：推 `v*` tag 构建八平台产物 + SHA256SUMS + Draft Release
  - `.github/workflows/e2e.yml`：手动触发的 Playwright 端到端测试

### 修复

- API 路由：字面路由优先于动态段
- 更新检查（app-update）降级策略：更新源不可达时按"无更新"响应，避免轮询噪声
- UI 布局：静态化 Tailwind 工具类，恢复居中/滚动/跳转树
- 样式审计：修复 Tailwind 静态化吞掉的多行选择器
- 端口占用提示友好化，回收资产服务避免进程挂死

### 工程化

- 全链路 Bun 原生化：替换可替代的 `node:` 调用，测试全部转 `.ts` 并迁移到 `bun:test`
- 测试集中到 `tests/unit`，清除 npm 工具链依赖
- CI 八平台矩阵、PWA 离线验证
- 启用 typescript-eslint 与 react-hooks 规则
- 清理死亡代码、无引用截图与构建产物

### 兼容与安全

- 产品命名空间断裂：`pi-web-x` 不读取/不迁移旧 `pi-web:*` custom type / localStorage / 浏览器事件
- 依赖 `@earendil-works/pi-coding-agent@0.84.3`（MIT）
- Host/API 来源校验、Basic Auth、默认 loopback 监听不变量全部保留

[未发布]: https://github.com/xiaojueshi/pi-web-x/compare/v0.8.11...HEAD
[0.8.11]: https://github.com/xiaojueshi/pi-web-x/releases/tag/v0.8.11
