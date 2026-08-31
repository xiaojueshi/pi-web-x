# 支持与问题反馈（Support）

Pi Web X 是社区维护的开源项目，不提供商业 SLA。维护者会尽力处理可复现问题，但不承诺固定响应或解决时间。

## 提交前

1. 使用 `pi-web-x --version` 确认版本，并优先升级到最新 Release。
2. 查阅 [README](./README.md)、[文档索引](./docs/README.md)和 [GitHub Issues](https://github.com/xiaojueshi/pi-web-x/issues) 中的已有问题。
3. 使用最小、脱敏的环境复现。
4. 区分 Pi Web X 问题、pi SDK/provider 问题和项目自身命令问题。

## 公开 issue 适合报告

- 可稳定复现的功能缺陷；
- 安装、更新、资产、系统服务或平台兼容问题；
- 文档错误或缺失；
- 有明确使用场景的功能建议。

请使用仓库的 Bug report 或 Feature request 模板，并提供：

- 操作系统、架构和 libc（Linux）；
- `pi-web-x --version`；
- GitHub Release 二进制还是源码构建；
- 启动方式、复现步骤、期望与实际行为；
- 已运行的诊断/测试；
- 完整脱敏后的必要日志。

## 不应公开提交

以下内容不得放入公开 issue、讨论、PR 或截图：

- `PI_WEB_X_PASSWORD`、浏览器密码、setup token 或 session Cookie；
- API Key、OAuth token、provider 凭据；
- `~/.pi/agent` 或 `~/.pi-web-x/auth` 的真实文件；
- 未脱敏的项目路径、用户名、会话内容或私有源码；
- 尚未修复的安全绕过细节。

发现安全漏洞请遵循 [SECURITY.md](./SECURITY.md)，行为准则问题请遵循 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。

## 常见诊断

```bash
pi-web-x --version
pi-web-x --help
pi-web-x assets status
```

源码开发问题还应提供：

```bash
bun --version
bun run typecheck
bun run lint
bun test
bun run build
```

不得为了提供日志而关闭 Host/Origin/认证检查，也不得把真实 `HOME` 数据复制到测试 fixture。

## 上游问题

如果问题只在特定 pi/provider/extension 中出现，仍可先提交脱敏复现。维护者会判断应在本仓库修复、登记到 [`docs/maintainers/upstream-workarounds.md`](./docs/maintainers/upstream-workarounds.md)，还是转交相应上游。请勿同时在多个仓库重复发布包含敏感信息的报告。
