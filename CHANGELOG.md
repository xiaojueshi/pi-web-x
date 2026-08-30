# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，按 [SemVer](https://semver.org/lang/zh-CN/) 版本。

## [未发布]

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
