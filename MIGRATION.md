# Pi Web → Pi Web X：Bun 独立兼容实现迁移方案

## 1. 目标与边界

### 1.1 目标

本项目是一个**独立的新项目**，在 Bun v1.4 上复刻 `pi-web@0.8.11`（upstream commit `28bab3c`）的用户功能：会话浏览与编辑、Agent/SSE、文件与 Git、模型和认证、plugins/skills/subagents、worktrees、PWA 与 CLI。

实现允许在 MIT 许可下复用上游源码；发布物必须保留 `LICENSE`、版权声明与来源说明。首版不承诺自动跟随 upstream，后续升级须逐版本进行差异评审。

### 1.2 不可妥协的验收条件

- 使用 `bun build --compile` 交付可运行的原生单文件二进制；若关键功能无法在编译产物中运行，不进入大规模迁移。
- 保留所有现有 `/api/*` 路径、HTTP 方法、状态码、JSON 结构、SSE 事件与错误语义；允许新增响应字段。
- UI 保证功能、交互状态与可访问性兼容；关键路径做截图回归，不要求 DOM 或像素级等同。
- 默认仅监听 loopback；非 loopback 必须显式启用，并保留 Host/API 来源校验、Basic Auth 与明文 HTTP 风险警告。
- 运行 pi-web-x 本身不依赖 Node/Bun；git、npm/npx 仍是调用 worktree、plugin、skill 等按需功能时的系统依赖，缺失时必须给出可操作诊断。

### 1.3 明确不在本迁移中完成的工作

- 不引入 SQLite 会话索引或任何新的持久化缓存。
- 不在迁移期间重写 `proper-lockfile`、`web-push`、`undici`、`child_process` 或其他已可工作的基础设施。
- 不在首个可用切片中实现 PWA；但 PWA 不是永久删除项，正式兼容发布前必须恢复和验证。
- 不实现运行中自动二进制替换；`app-update` 首版仅检查、提示并指向下载/包管理器更新路径。

## 2. 产品身份与断裂兼容策略

pi-web-x 与 pi-web 是不同产品。所有 pi-web 专属标识符必须更名，**不提供旧命名空间回退、双读或自动迁移**。

| 类别 | 旧标识符示例 | 新规则 |
| --- | --- | --- |
| 可执行文件、包、标题、日志 | `pi-web` | 使用 `pi-web-x` |
| 环境变量 | `PI_WEB_PASSWORD`、`PI_WEB_HOSTNAME` | 仅使用 `PI_WEB_X_PASSWORD`、`PI_WEB_X_HOSTNAME` |
| 浏览器持久化 | `pi-web:*` localStorage key | 仅使用 `pi-web-x:*` |
| 浏览器事件 | `pi-web:session-row-contextmenu` | 仅使用 `pi-web-x:session-row-contextmenu` |
| session custom type | `pi-web:tool-selection`、`pi-web:subagent*` | 仅使用对应的 `pi-web-x:*` |
| 更新信息与用户可见标识 | pi-web 名称/链接 | 使用 pi-web-x 信息 |

`/api/*` 路径不含 pi-web 专属标识符，故保持不变。若某个 API 响应中包含产品标识，其标识值改为 pi-web-x，但不得改变结构、状态码或路径。

pi-web-x 继续使用 Pi 核心数据目录 `~/.pi/agent`，因为其中保存的是 Pi 的通用会话、认证、模型和扩展数据，而非 pi-web 专属标识。旧会话仍可按通用消息格式浏览；其中旧 `pi-web:*` custom type 不被解释。禁止两个服务同时写入同一 Pi 数据目录；并跑测试必须使用隔离 `HOME` 或只读 fixture。

## 3. 目标架构

### 3.1 服务端

- 使用 `Bun.serve({ routes, fetch })`，不引入 Elysia，也不实现完整 Next.js 兼容层。
- 建立小型内部 HTTP helper：JSON 响应、标准错误、路径参数、请求安全、缓存头、SSE 和静态响应。route 只保留业务逻辑。
- 以 Web 标准 `Request`/`Response` 为接口；不得依赖不存在的 `server.request` 事件。
- 将原 `proxy.ts` 的 Host/API 来源校验、`PI_WEB_X_PASSWORD` Basic Auth、`WWW-Authenticate` 与缓存头迁入入口中间件。
- 保持 Host Runtime Environment 与 Project Command Environment 的隔离；所有 `Bun.spawn` 适配均需测试环境变量白名单、代理、worktree、Windows 路径及缺失命令行为。

### 3.2 前端

- `src/server.ts` 静态 import `src/client/index.html`，由 Bun HTML imports 打包 HTML、TSX、CSS 与前端依赖；不要同时维护第二套手写静态入口。
- 使用 React 19 客户端渲染；服务端不依赖 RSC/SSR。
- 以受测的 location store 替换 `next/navigation`：使用 `useSyncExternalStore` 和 synthetic navigation event。不得假设 `history.replaceState()` 会触发 `popstate`。
- 基础壳必须包含原 RootLayout 的主题防闪烁脚本、Noto Sans Mono 本地字体、KaTeX CSS、title、icon、viewport、翻译限制与版本注入。
- Tailwind 退出以 P0 样式回归为门槛：先将 `@theme` 静态化为普通 CSS 变量；只有计算样式或截图不等价时，才暂时保留 Tailwind 构建链。

### 3.3 运行时资源

- 编译二进制仅内嵌程序自身的 HTML/CSS/JS、字体、图标和明确声明的静态资源。
- plugins、skills、prompts、themes、用户配置和 Pi session 文件必须继续从用户目录动态发现，不能写入 `import.meta.dir` 或内嵌资源路径。
- 资源采用 HTML import 与明确 `--asset`/`with { type: "file" }` 声明；不得依赖运行时字符串动态 import。

## 4. 依赖策略

唯一强制移除项是 **Next.js 及其专属构建链**。其余依赖不是“越少越好”的目标；只在功能等价、测试充分且收益明确时才替换。当前状态与未来复查条件见 [`docs/runtime-substitution-matrix.md`](docs/runtime-substitution-matrix.md)。

特别约束：

- `mammoth` 是服务端动态导入的运行时依赖，必须从 devDependencies 移到 dependencies，且需在编译二进制中验证 DOCX 预览。
- `react`、`react-dom`、Pi SDK、`mammoth`、markdown 渲染依赖可继续由 Bun 打包；不以“零 npm 依赖”为目标。
- `proper-lockfile`、`web-push`、`undici` 首版保留。替换它们必须先有协议/并发/安全对照测试。
- `Bun.YAML`、`Bun.spawn`、`Bun.Glob`、`Bun.Image` 是候选优化，而不是默认替换任务。

## 5. 纵向实施阶段

| 阶段 | 可交付能力 | 必须完成的验证 |
| --- | --- | --- |
| P0：可行性门禁 | 最小 Bun 服务、最小 React 页面、编译二进制 | §6 全部门禁通过 |
| P1：基础壳与只读会话 | 根布局、静态资产、sessions/home/cwd/files/git/worktrees 的基础路径 | 编译二进制的 HTTP、浏览器、样式与文件访问测试 |
| P2：Agent 核心 | agent/new、state、SSE、bash-output、rpc-manager 与会话恢复 | SSE 时序、断线重连、并发、fork、Agent 生命周期测试 |
| P3：配置与扩展 | models/auth/plugins/skills/subagents/tools/project-trust/push/app-update | 动态资源发现、认证安全、文件锁、外部命令缺失诊断测试 |
| P4：PWA 与产品壳 | manifest、Service Worker、离线页、图标缓存、CLI 的完整 pi-web-x 重命名 | 安装/更新/离线/PWA 作用域与 CLI 黑盒测试 |
| P5：发布与回归 | 八个平台制品、发布流程、文档 | §7 发布门槛全部通过 |

每一阶段都必须可启动、可测试、可回退；禁止先翻译全部 API 再一次性接入前端。

## 6. P0 一票否决验证

| 编号 | 验证 | 通过标准 |
| --- | --- | --- |
| V1 | Bun 路由 | `sessions/[id]`、文件通配、Agent SSE 在新旧 fixture 下匹配既有 HTTP 契约 |
| V2 | 编译前端 | HTML import、React、全局 CSS、CSS Module、版本注入及根布局在编译二进制内正确工作 |
| V3 | 安全入口 | Host/API 来源校验、`PI_WEB_X_PASSWORD` Basic Auth、loopback/LAN 行为与错误响应正确 |
| V4 | SDK 与动态资源 | pi SDK、worker/native 资源，以及用户目录 plugins/skills/prompts/themes 在编译产物中可发现和加载 |
| V5 | 文件与运行时依赖 | DOCX (`mammoth`) 预览、外部 git/npm/npx 缺失诊断、读写 Pi 通用数据目录正确 |
| V6 | 测试基线 | 测试链已迁移到 Bun 原生运行器（`npm test` = `bun test`，830 通过）；Playwright 在编译二进制上做 HTTP/PWA 黑盒验证 |
| V7 | 打包资源 | 八个目标均可构建；静态资源、字体、图标、worker 和版本常量在隔离目录中可用 |

任一项失败时，只能先提交最小复现、根因与修复设计；不得以“后续再修”进入 P1。

## 7. 测试、性能与发布门槛

### 7.1 测试

- 主测试链已迁移到 Bun 原生运行器：`npm test` 即 `bun test`（830 个测试通过，含原 Node+jiti 测试文件——Bun 原生兼容 `node:test` 与 `jiti`）。
- 迁移过程中处理的运行时差异：`node:module.registerHooks` 改 Bun 原生 `.tsx`/CSS module import；`react-syntax-highlighter` 用 ESM 具名导入；删除依赖 undici dispatcher 的 `lib/http-dispatcher.ts`（Bun `fetch` 不经过 undici，且生产无引用）。
- 每个迁移域新增在**编译后二进制**上执行的 HTTP/SSE 黑盒契约测试。
- 使用 Playwright 覆盖会话浏览、SSE 重连、文件预览、Basic Auth 与 PWA 注册/离线回退（`tests/e2e/smoke.spec.ts` 已验证离线导航回退到 offline 页）。
- fixture 必须脱敏、隔离 `HOME`、禁止读取真实凭据或调用真实模型。

### 7.2 性能

不引入 SQLite。以脱敏固定 fixture 测量旧版与新版本的会话列表、会话详情、首次可交互和 SSE 首包；任一指标慢于基线 10% 以上时，先优化既有读取路径。

### 7.3 二进制制品

每个 release 固定精确 Bun 版本并写入构建元数据，构建并冒烟测试：

- `bun-darwin-x64`、`bun-darwin-arm64`
- `bun-linux-x64`、`bun-linux-arm64`
- `bun-linux-x64-musl`、`bun-linux-arm64-musl`
- `bun-windows-x64`、`bun-windows-arm64`

主交付为平台原生二进制。npm 包仅可作为已有 Node 用户的安装器或启动器，不能宣称其路径无需 Node。macOS 需签名/notarization 策略，Windows 制品需版本与元数据，Linux 需在 glibc 与 musl 环境实际执行验证。

## 8. 风险与处置

| 风险 | 处置 |
| --- | --- |
| Bun/SDK 动态资源在编译产物失效 | P0 V4 阻断；提供最小复现后再设计适配 |
| 45 个 API 的机械翻译改变语义 | 统一 HTTP helper + 二进制契约测试 |
| 编译二进制与 npm/npx 外部能力混淆 | 启动与调用前显式诊断系统依赖 |
| 用户把 LAN HTTP 当作安全部署 | 默认 loopback、明确 opt-in、Basic Auth/HTTPS 风险警告 |
| pi-web-x 命名断裂造成历史偏好丢失 | release note 明确说明；不引入隐式迁移 |
| CSS 静态化偏差 | 以计算样式和截图回归决定是否暂留 Tailwind |
| dev 模式 HMR 偶发 `import_*_module is not defined`（Bun 1.4.0 dev bundler，如 ChatMinimap） | 生产二进制不受影响；硬刷新可恢复；升级 Bun 版本观察；不做产品代码迁就 |

## 9. 迁移方案中已删除的内容

以下内容不再作为承诺或实施项：

- Elysia 备选/兼容层描述；本项目只使用 Bun 原生路由。
- `bun:sqlite` 会话索引与 `src/ssr-cache.ts`。
- 在迁移阶段重写 Web Push、文件锁、undici、子进程、目录遍历等基础设施的计划。
- “P5 仅依赖 P2”的错误依赖关系，以及先迁移全部服务端、最后迁移前端的横向阶段安排。
- 将 `bun test` 视为 Node+jiti 测试等价替代的表述。
- `server.request` 事件模型的错误表述。
- “`npx pi-web` 与无需 Node/Bun 的单文件二进制等价”的表述。
- PWA 的未验证资产哈希实现细节；仅在 P4 以真实编译产物验证后加入。

## 10. 开工前清单

- [ ] 创建干净的新仓库/worktree；不得复制 `../pi-web` 中未提交的 `lib/rpc-manager.ts` 改动。
- [ ] 复制并保留 MIT LICENSE、版权与上游来源说明。
- [ ] 锁定 upstream `0.8.11/28bab3c`、Bun 精确版本、Node 测试版本和 fixture 版本。
- [ ] 完成 P0 V1–V7 并保存可复现报告。
- [ ] 建立 `docs/runtime-substitution-matrix.md` 的每项验收记录。
- [ ] 读取并遵循 PR、issue、release、commit 模板后再发布。
