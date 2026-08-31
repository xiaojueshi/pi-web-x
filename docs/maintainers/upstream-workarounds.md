# 等待上游处理的临时实现

[维护者文档](./README.md) · [运行时替代矩阵](./runtime-substitution-matrix.md) · [Bun/Node 边界](../development/bun-and-node.md)

本文档集中记录 pi-web-x 为绕过上游依赖限制而保留的临时实现，避免依赖升级后继续遗留、重复修复或被误删。

## 维护规则

1. 新增临时实现时必须登记：问题、影响范围、本地实现、验证方式、上游替代条件和回退方式。
2. 升级相关依赖时必须逐项复查所有“生效中”记录，不得只依赖 changelog 标题判断。
3. 上游提供稳定公共接口后，先在八个发布目标验证，再删除本地实现。
4. 删除记录前应将状态改为“可移除”，附验证结果；完成删除后保留记录并标记“已移除”。
5. 禁止依赖未导出的 `node_modules/**/dist` 私有路径作为长期修复。

## 状态定义

- **生效中**：发布物仍依赖本地实现。
- **可移除**：上游已有候选替代，但尚未完成全平台验收。
- **已移除**：本地实现已删除，记录保留用于追溯。
- **不再适用**：相关功能或依赖已删除。

## 临时实现清单

| ID | 状态 | 依赖 | 本地入口 | 等待的上游能力 |
| --- | --- | --- | --- | --- |
| `UPSTREAM-001` | 生效中 | `@earendil-works/pi-ai@0.84.4` | `src/bun-runtime-modules.ts` | 一个稳定、统一的 Bun compiled-runtime 注册入口 |

## UPSTREAM-001：Bun 单文件二进制静态注册运行时模块

### 问题

`pi-ai` 为避免浏览器 bundle 收集 Node-only 实现，部分模块通过变量形式的相对 `dynamic import` 延迟加载。`bun build --compile` 无法静态跟踪这些路径，因此未显式注册时，编译二进制会从 `/$bunfs/root/` 查找并不存在的文件。

已确认受影响的模块：

- OAuth flows：Anthropic、OpenAI Codex、GitHub Copilot、OpenRouter、Kimi Coding、xAI、Radius。
- API implementation：Amazon Bedrock `bedrock-converse-stream`。

典型错误：

```text
Cannot find module './openai-codex.js' imported from /$bunfs/root/pi-web-x-...
Cannot find module './bedrock-converse-stream.js' imported from /$bunfs/root/pi-web-x-...
```

普通的 literal dynamic import（例如 `import("./openai-responses.js")`）可由 Bun 自动收集，不需要登记到本实现。

### 本地实现

- `src/bun-runtime-modules.ts` 静态导入并注册全部当前已知的 opaque runtime modules。
- `src/cli.ts` 在启动入口调用一次 `registerBunRuntimeModules()`。
- `tests/unit/src/bun-runtime-modules.test.ts` 编译并执行真实 Bun 二进制探针，通过 provider 公共 API 验证全部 OAuth flow 和 Bedrock 实现可加载。

该方案只使用 `pi-ai` 的公共 exports，不扫描或导入 `node_modules/**/dist` 私有路径。

### 验证

```bash
bun test tests/unit/src/bun-runtime-modules.test.ts
bun run typecheck
bun run build
```

发布前仍须执行 `bun run build:all`，确保八个平台均可静态收集新增依赖。

### 升级依赖时的复查步骤

1. 检查 `@earendil-works/pi-ai/package.json` 的公共 exports，确认是否新增统一 Bun runtime 注册入口。
2. 检查上游 Bun CLI bootstrap 是否仍分别调用 `registerBunOAuthFlows()` 和 Bedrock module override。
3. 搜索新增的变量形式相对 dynamic import，重点关注 OAuth、provider API、native/Node-only 模块。
4. 运行 compiled-runtime 探针；若出现新的 `/$bunfs` module-not-found，先确认上游是否提供对应公共注册 API，再扩展本地集中注册。
5. 若上游已有统一入口，用其替换 `src/bun-runtime-modules.ts` 内的单项注册，完成八平台构建和功能测试后再删除本地封装。

### 移除条件

同时满足以下条件后可标记为“可移除”：

- `pi-ai` 提供稳定公共的统一注册入口，并覆盖 OAuth、Bedrock 及后续 opaque runtime modules。
- pi-web-x 不再需要直接维护各模块的静态 imports。
- compiled-runtime 探针、类型检查和八平台构建全部通过。
- OAuth 登录、OAuth token auth derivation 与 Bedrock 请求路径完成至少一次真实环境验证。

### 回退方式

若上游统一入口造成发布物回归，恢复 `src/bun-runtime-modules.ts` 中经过验证的单项静态注册，并重新运行 compiled-runtime 探针与八平台构建。

- 登记日期：2026-08-31
- 当前责任范围：pi-web-x maintainers
- 上游 issue/PR：尚未登记；创建后在此补充链接

## 新增记录模板

```md
## UPSTREAM-XXX：<临时实现名称>

- 状态：生效中
- 依赖与版本：
- 问题与用户影响：
- 本地实现及文件：
- 为什么不能直接使用上游：
- 验证命令与结果：
- 上游 issue/PR：
- 升级复查步骤：
- 移除条件：
- 回退方式：
- 登记日期与责任范围：
```
