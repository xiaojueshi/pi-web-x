# Pi Web X 运行时替代兼容矩阵

> 本文档记录依赖的实际迁移状态，防止“计划中会移除”被遗忘或被误解为既成事实。
>
> 更新规则：任何状态变更必须附带复现命令、目标平台、测试结果、兼容风险和回退方式。没有这些证据不得标记为“已替代”。

## 状态定义

- **保留（首版）**：首个 Bun 二进制版本继续使用，迁移阶段禁止重写。
- **候选**：可评估替换；不构成路线承诺。
- **已替代**：已在所有目标平台通过对应验收。
- **不适用**：仅属于已删除的 Next.js 构建链。

## 矩阵

| 原依赖/能力 | 当前状态 | 首版策略 | 若替代的必要验收 | 主要风险 |
| --- | --- | --- | --- | --- |
| `next` | 不适用 | 移除，改为 `Bun.serve` + HTML imports | 45 API 契约、SSE、安全入口、编译二进制全绿 | 路由、header、请求安全语义漂移 |
| Next App Router / `next/navigation` | 不适用 | 使用 React 客户端入口和小型受测 location store | `replace()`、搜索参数、历史导航、AppShell 测试 | `replaceState` 不触发 `popstate` |
| `next/font` | 不适用 | Noto Sans Mono 本地静态资源 | 字体加载、亮暗首屏截图、离线运行 | FOUC、字体回退造成视觉偏差 |
| Tailwind/PostCSS | 候选 | 优先静态化 `@theme`；失败才暂留 | 与基线的计算样式和截图等价 | Bun CSS 转换不等同 Tailwind 编译 |
| `react` / `react-dom` | 保留（首版） | 由 Bun 前端 bundle 打包 | 仅在有明确收益时评估 | 无收益替换导致 UI 大规模回归 |
| `@earendil-works/pi-*` | 保留（首版） | 原样使用，验证编译二进制及动态资源 | 8 目标下 SDK、worker、图像、会话与扩展功能通过 | native addon、worker、运行时资源路径 |
| `mammoth` | 保留（首版） | 移至 `dependencies`，由 Bun 打包 | 编译二进制 DOCX 路由返回正确预览 | 运行时动态 import、生产依赖遗漏 |
| `proper-lockfile` | 保留（首版） | 原样使用 | 双进程并发、崩溃恢复、跨平台文件锁与原实现等价 | 数据丢失、死锁、语义变化 |
| `web-push` | 保留（首版） | 原样使用 | VAPID、加密载荷、真实推送服务互通 | 安全协议实现错误 |
| `undici` | 已替代 | 移除；Bun 原生 `fetch` 不经过 undici dispatcher，且唯一使用方（`lib/http-dispatcher.ts`）在生产中无引用，该模块与测试已删除 | 所有出站请求改用 Bun `fetch`；代理语义由 Bun 环境变量自行定义 | 在企业代理环境下出站行为需重新验证 |
| `js-yaml` | 候选 | 原样使用 | YAML 1.2、错误位置、多文档、序列化输出兼容 | `Bun.YAML` 与 `js-yaml` 语义差异 |
| `child_process` | 候选 | 原样使用 | argv 转义、Windows、信号、流、环境隔离、退出码 | `Bun.spawn` 生命周期和错误语义差异 |
| `fs` 目录遍历 | 候选 | 原样使用 | ignore、symlink、排序、权限、Windows 路径语义等价 | `Bun.Glob` 与现有遍历语义不同 |
| `Bun.Image` | 候选 | 不作为迁移任务 | 预览尺寸、格式、内存和跨平台测试 | 无实际需求时引入额外回归面 |
| `bun:sqlite` 会话索引 | 不适用 | 本迁移明确不引入 | 未来独立性能项目才可评估 | 缓存失效、并发、隐私、数据损坏 |
| `mermaid`、`katex`、`react-markdown`、remark/rehype | 保留（首版） | 前端 bundle 打包 | 仅在等价渲染和安全策略可证明时评估 | Markdown/数学/图表渲染回归 |
| `ansi_up` | 保留（首版） | 前端 bundle 打包 | ANSI 输出的快照测试 | 安全转义与显示兼容 |

## 每次评审模板

```md
### <依赖/能力>：<状态变更>

- 目标版本与平台：
- 原实现：
- 新实现：
- 迁移收益（量化）：
- 复现命令：
- 单元/集成/二进制测试结果：
- 协议或并发对照结果：
- 已知差异与用户影响：
- 回退方式：
- 审核日期与责任人：
```
