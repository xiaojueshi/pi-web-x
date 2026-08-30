---
name: Bug 报告 (Bug report)
about: 提交缺陷，帮助我们改进
title: "[bug] 请用一句话描述问题 (describe the issue in one line)"
labels: bug
assignees: ""
---

**⚠️ 敏感信息警告**：请勿在 issue 中粘贴包含 `PI_WEB_X_PASSWORD`、认证凭据、`~/.pi/agent` 下的真实配置/日志或其它私密内容。若确需提交，请先脱敏（将值替换为 `<redacted>`）。公开 issue 对所有人可见。

## 描述 (Describe the bug)

清晰简洁地描述问题是什么。

## 复现步骤 (To Reproduce)

1. 启动方式（如 `./pi-web-x -p 8080` 或 `pi-web-x service install`）
2. 操作步骤
3. 看到的错误

## 期望行为 (Expected behavior)

你期望发生什么。

## 环境 (Environment)

- 平台：Linux/macOS/Windows（含架构 x64/arm64）
- 版本：`pi-web-x --version` 输出（或 Release tag）
- 从 GitHub Release 下载的二进制，还是本地构建？
- 是否通过 `-H 0.0.0.0` / `PI_WEB_X_PASSWORD` 启用了非 loopback 暴露？

## 日志 (Logs)

粘贴**脱敏后**的相关日志（隐藏口令、token、路径中的用户名等）。

## 其它 (Additional context)

截图、相关文件引用等。
