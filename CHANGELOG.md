# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，按 [SemVer](https://semver.org/lang/zh-CN/) 版本。

## [0.12.0] - 2026-09-21

### 新增

- 大文本文件预览改为按需分页：文本文件在不超过 10 MiB 时以 256 KiB、UTF-8 安全的分块加载；文件面板提供“加载更多”。预览加载期间文件发生变化时，保留当前快照并要求用户手动刷新，避免混合两个版本的内容；无效 UTF-8 明确提示下载原文件。
- 当前聊天会话新增短期 Selected Session Lease：浏览器每 30 秒续租一次、服务端 90 秒过期，仅保活已经存在的当前 AgentSession，不会为租约冷启动历史会话；它与 extension-owned background work 的 Extension Liveness 保持独立。
- 删除会话新增只读影响预览与确认 token：确认前显示将递归删除的 Built-in Inline Subagent 后代数和运行数；成功响应返回所有 `deletedSessionIds[]`，当前选中的已删后代也会正确退出。

### 修复

- 重新打开运行中的会话时不再清空已收到的流式 assistant partial；SSE 重连后会重放运行中 `bash` / `powershell` 工具的最近输出，并在流式 tool card 中继续显示。
- 第一条用户消息现在可 Fork，也可“从这里编辑”建立分支；首消息 Fork 产生的 child JSONL 会立即写入可重新打开的 session header。
- 内置 Slash Command 执行期间锁定输入控件和同步重入入口，连续 Enter 或点击不再重复提交同一内置命令。
- 保存 Built-in Inline Subagent Profile 时保留 pi-web-x 不管理的 YAML frontmatter 和 `ext:` tool selector；这些 selector 仍不被解释或赋权。若现有 frontmatter 损坏，保存会拒绝覆盖原文件。
- 删除 parent session 不再改挂 Built-in Inline Subagent：无运行中后代时，服务端对全部受影响 JSONL 创建操作级备份后递归删除，普通 fork child 仍保留并改挂或去父化；任一改挂或删除失败都会恢复完整文件集，若恢复本身失败则保留磁盘备份供人工恢复。每次删除前后都核验 preview 绑定的文件版本，确认 token 过期、后代树/文件发生变化或出现运行中后代时返回 409，不做文件修改；删除确认不再允许 Shift 绕过。
- `ask_user` 的每轮注入规则升级为强制用户输入协议：模型需要用户回答、选择、偏好、批准或澄清时，必须先调用工具，不能在普通 assistant 文本中直接提问、列出选项或留下待答决策。`ask_user` 现在也被识别为阻塞式扩展请求：页面隐藏或失焦且浏览器通知已授权时，会走现有 Service Worker/浏览器通知链提醒用户回答。内联提问卡片会在 React 挂载完成后滚至消息流底部，并填满与聊天内容相同的列宽。

### 测试与工程化

- 新增/扩展覆盖流式恢复、shell 工具输出重放、首消息 Fork、内置命令重入、Profile 无损保存、递归删除预览/冲突、部分删除失败恢复、恢复失败保留备份、最终删除前文件变更、文本分页 UTF-8 边界、文件变更、Selected Session Lease TTL 与无 cold-start 等回归场景。

## [0.11.2] - 2026-09-10

### 修复

- 侧边栏「加载中...」仍可能常驻（v0.11.1 修复的遗留竞态）：v0.11.1 的并发计数器在 `finally` 中仍保留了 loadId 守卫，最常见的场景——初始 showLoading 请求被一次后台非 showLoading 刷新抢占 loadId——计数已归零但守卫不成立，加载态照样永久卡住。现在关闭加载态不再受 loadId 守卫（`setLoading(false)` 只关加载态不写数据，并发中的新 showLoading 请求由计数器 >0 保护）；同时为 `/api/sessions` 的 fetch 增加 30 秒超时兑底（`AbortSignal.timeout`），请求挂死时加载态最多持续 30 秒。
- 连接安全提示误报「此连接尚未启用 Web Access Authentication」：
  - 已设置密码且已登录仍提示：提示组件（PwaRegistration）在认证墙外，只在挂载时请求一次认证状态；登录成功不触发整页刷新，状态停留在登录前。现在登录/首次设置密码成功时由认证墙派发 `pi-web-x:auth-established` 事件，提示组件监听后重新拉取 `/api/auth/status`；同时监听现有会话失效广播保持状态同步。
  - 提示条件原为「当前会话未登录」，但「尚未启用认证」只对从未设置过密码的连接成立。改为仅当认证未初始化时提示；本机回环访问不再提示（提示文案本身即针对跨设备访问的建议）。局域网/其他地址在密码未设置或非安全上下文时仍提示。

### 测试与工程化

- 全量单测 1023 项通过（`bun run test`）；`bun run typecheck`、`bun run lint` 通过。放宽 PwaRegistration `controllerchange` 源码断言以兼容多行排版。

## [0.11.1] - 2026-09-10

### 修复

- 订阅登录不再因空闲超时断开（"Connection lost"）：`Bun.serve` 默认 `idleTimeout` 为 10 秒，OAuth 订阅登录在用户跳转授权页面期间 SSE 流无数据流动，连接被服务端强制断开，前端报 "Connection lost" 且无法完成授权。auth 登录流新增 5 秒 SSE 注释帧心跳（EventSource 自动忽略，仅保活），并顺带修复客户端断开时重复 `controller.close()` 可能抛异常的问题。
- 会话事件流与文件 watch 流同样接入 5 秒心跳：agent 事件流原心跳间隔 30 秒同样撑不过 10 秒空闲超时，会话静默（如模型长时间思考、等待授权工具调用）超过 10 秒时事件流会被断开；文件 watch 流此前无心跳，文件 10 秒内无变更即断开。两处均补齐/修正心跳并在关闭路径清理定时器。
- 侧边栏会话列表「加载中...」常驻：初始加载请求在飞行中被 running 轮询或后台刷新抢占 `sessionLoadIdRef`，`finally` 中 loadId 失配跳过 `setLoading(false)`，导致列表正常但加载态永久卡住。改用并发计数器，仅在所有 showLoading 请求结束后关闭加载态。

### 变更

- 订阅登录打开授权页面前校验外部链接协议：仅允许 http/https，拒绝 `javascript:` 等危险协议；SSE 登录帧 JSON 解析增加容错，畸形帧直接忽略不再中断登录流程。

## [0.11.0] - 2026-09-08

### 新增

- 内置 Subagent 正式启用，配套完整的管理与观察界面（详见 ADR 0009）：
  - 设置 → 通用 新增「内置 subagent」开关：此前内置 subagent 被硬编码禁用（即使手动写入 `~/.pi/agent/agents/settings.json` 也无法生效），现在默认仍关闭，但可在设置中打开，保存即生效、无需重载会话；设置损坏时 fail closed 保持关闭。
  - 设置面板新增 Subagents 管理区：内置与 workspace 级 profile 只读展示，全局与已信任项目的 profile 可完整编辑；同名 profile 按 project → workspace → global → built-in 优先级解析，被遮蔽的来源保持可见；敏感能力授权与删除均需显式确认。
  - 项目信任边界：仓库级（workspace/project）profile 属于仓库受控输入，项目被信任前不可用；首次在浏览器访问中选择未信任项目的会话时弹出一次性信任确认，拒绝后保留受限功能提示与后续信任入口，不再重复弹窗。
  - Agents 观察视图：仅限当前父会话范围，显示子 agent 运行中/总数、状态、消息与工具结果；子会话在 UI 与 API 两层均严格只读，直接写请求会被拒绝。
  - 生命周期：停止父 Agent 会级联中止其所有活动的内置子 agent 并保留历史供观察；前台委派在同一父回合内等待结果并继续；后台完成仍会向父会话回报。
- Agent 主动委派策略：启用 Agent 工具的会话在每轮 system prompt 末尾注入委派策略（何时应后台/前台委派、不重复委派琐碎任务）；未启用 Agent 工具时不修改用户的 system prompt。
- 批量 `ask_user` 问答：内置提问工具新增 `questions` 参数（2–8 个问题），一次调用以标签页流呈现多个独立问题（tab 支持自定义标签，缺省用本地化序号），取代反复逐个提问；单个问题的原有用法不变。同时每轮注入「主动澄清」策略，让模型在真正需要用户决定时优先提问而不是擅自假设。
- 全局系统提示词设置：设置面板新增系统提示词编辑器与 `GET/PUT /api/system-prompt`。读写与 Pi 全局资源发现一致：`~/.pi/agent/SYSTEM.md` 优先，未配置时回显全局 `AGENTS.md`、再次 `CLAUDE.md`；首次保存创建 `SYSTEM.md`，清空仅删除 `SYSTEM.md`，不会误删用户的全局规则文件；写回当前来源文件，避免复制进 `SYSTEM.md` 后被 SDK 重复注入。
- 会话全文搜索：新增 `GET /api/sessions/search` 与侧边栏搜索面板。无索引字面搜索，单次 3 秒预算 / 最多 500 个文件 / 30 条结果上限；结果防抖展示，点击命中跳转到对应会话并高亮定位；`sessionListVersion` 支持跨窗口会话列表同步。
- 插件更新检查与确认式更新：新增 `POST /api/plugins/check`（npm registry 版本/范围比较 + git HEAD/远端 ref 比较，识别 `PI_OFFLINE`，锁定来源返回 unsupported，只读不落盘）；主页加载、项目切换与插件面板打开时后台静默检查（`lib/plugin-update-store` 全局共享，错误状态仅手动检查时展示）；插件面板单项与批量更新都需显式确认，批量更新先展示完整清单二次确认。
- 空闲会话回收改为设置面板管理：设置 → 通用 中开关并选择 5–1440 分钟超时（默认 10 分钟），持久化到 `~/.pi-web-x/settings.json`，无环境变量覆盖（ADR 0008）；rpc-manager 与 subagent-runtime 的后台任务接入保活语义，扩展后台工作活跃时阻止回收。
- 小型改进：Mermaid 图渲染就绪后默认展开预览并支持 SVG 下载；会话阅读位置按会话记忆（切回会话不再跳回底部，锚点翻页后正确恢复）；文件面板支持视频内联预览（webm 归类为视频，Range 流式播放）。

### 变更

- 选择性移植上游 pi-web v0.9.0（`0d1df12`）的插件管理增强与会话搜索，保留 `pi-web-x` 命名、Bun 单文件编译与 Host/Project 环境隔离等本地不变量。
- pi SDK（`@earendil-works/pi-agent-core`、`pi-ai`、`pi-coding-agent`、`pi-tui`）从 0.85.0 升级至 0.85.1（新增 GPT-6 Astra 模型、修复 GPT-5.6+ prompt cache TTL）；UPSTREAM-001 补丁逐项复核维持生效。
- 发布构建启用 minify 并移除未使用的 `@earendil-works/pi-server` 依赖：二进制 JS 部分 25.0MB → 14.4MB（−42%），单二进制约 103.7MB → 93.2MB，八平台制品普遍缩小约 10MB。

### 修复

- 编译二进制下 HTML 历史导出失败：导出 API fallback 硬编码 npm 包内 `dist/core/export-html` 路径并动态 import 磁盘文件，二进制部署下报 `Cannot find module .../export-html/index.js` 并整体失败。现在 `exportFromFile` 在编译期内嵌进二进制（`src/export-html-entry.ts`），移除磁盘布局依赖，纯二进制部署的 HTML 导出恢复正常。
- 手动上下文压缩不再等待超时：压缩可能持续数分钟，HTTP 响应链路等待会超时且无法判断结果。现在命令立即确认返回 `{started:true}`，完成结果与错误仍经 SDK `compaction_end` 事件通过 SSE 送达客户端，失败在服务端日志可见。
- 稳定性加固：15 处 API 路由直连 `new URL(req.url)` 的参数解析统一改为安全解析（解析失败返回空集合而不是抛 500）；request-security 的 Origin 解析失败改为 fail closed；markdown 数学块与会话 cookie 等逐行/逐请求构造的正则预构建为模块常量；登录 client-input 令牌从 `Math.random` 改为 `crypto.randomUUID`。
- CI 加固：三个工作流 checkout 显式 `persist-credentials: false`，ci/e2e 增加 `permissions: {}` 最小权限。
- 测试修复：Windows 平台路径分隔符断言（idle-session-settings）、SettingsUi 正则断言跨规则块误匹配、会话搜索测试的 globalThis 缓存跨文件污染。

### 测试与工程化

- 新增约 90 项单元测试：插件更新检查与存储、会话搜索（lib 与路由）、subagent 只读观察路由、system-prompt 路由与设置、批量提问卡片与问答语义、subagent 开关门禁、阅读位置、空闲回收设置、rpc-manager 关闭语义等。
- 全量单测 1023 项通过（`bun run test`）；`bun run typecheck`、`bun run lint` 通过。

## [0.10.1] - 2026-09-05

### 修复

- 自更新检查不再依赖 GitHub API 作主源：未认证 `api.github.com` 配额仅 60 次/小时且按出口 IP 计，共享出口（VPS/VPN/CGNAT）下常被同 IP 请求耗尽而返回 403，随后静默降级到索引有延迟的 jsDelivr（发版后数小时内仍返回旧版本），导致"发版后 `update` 仍提示已是最新版本"。主源改为 `releases/latest/download/` 302 重定向解析（走 github.com 静态下载域，无 API、无配额），jsDelivr 与 GitHub API 依次作为备源；降级发生时输出明确提示，用户可感知版本信息来自哪个源。

## [0.10.0] - 2026-09-05

### 新增

- 内置 `ask_user` 提问工具：无需安装第三方插件，Agent 即可在需要用户输入时发起提问。配套 Codex 风格内联提问卡片，渲染在消息流底部（取代模态对话框，不再遮挡历史）；支持单选/多选、选项搜索过滤（超过 6 项时显示）、"其他"自由输入与 Esc 取消；结构化选项支持 label + description 展示。与第三方同名扩展冲突时内置版自动胜出（保留第三方扩展的其它工具）。
- 内置 `todo` 工具与三层进度可视化：工具语义与社区 todo 插件完全兼容（list/add/toggle/clear，状态存入工具结果 details，分支/回溯自动正确，旧会话数据可直接渲染）。可视化分三层——顶部工具栏新增 TODO 按钮（与工具栏样式统一，带 n/m 进度徽标，有待办未完成时图标高亮）；点击打开统一下拉面板（进度条 + 逐项勾选列表）；消息流内每次操作留有快照卡片（常显进度条与勾选状态，展开可看原文）。

### 变更

- pi SDK（`@earendil-works/pi-agent-core`、`pi-ai`、`pi-coding-agent`、`pi-tui`）从 0.84.4 升级至 0.85.0；因上游 0.85.0 打包遗漏，宿主侧补充 `@earendil-works/pi-server` 0.85.0 直接依赖以保证 SDK 可导入。

### 修复

- 扩展提问请求按 id 去重：SSE 断线重连时服务端会把未答复的提问重放给客户端，此前重复投递会替换提问卡片对象导致已选选项/输入内容丢失（用户需反复重新选择）；现在同 id 重复投递保持现有卡片，仅真正的新请求触发重置与滚动。
- pi SDK 0.85.0 兼容修复：`PlainTextTheme` 补齐 Theme 构造函数新增的 fallback 色（scrollbarTrack/scrollbarThumb），修复启动时 `fgAnsi(undefined)` 崩溃；0.85.0 内置资产变化，重新生成资产清单。

### 测试与工程化

- 新增 `ask_user` / `todo` 内置扩展单元测试（类型守卫、冲突顶替、会话状态重建、工具执行语义）与前端渲染测试（提问卡片、TODO 进度卡、工具栏接线、三语文案完整性）；全量单测 940 项通过。

## [0.9.4] - 2026-09-01

### 修复

- Web 会话滑动续期 `Set-Cookie` 丢失：路由层经 Proxy Request 调用续期逻辑、而续期中间件用原始 Request 读取刷新 Cookie，身份不一致导致浏览器永远收不到续期响应头，页面保持打开也会在 24 小时后按旧时限删除 Cookie。现在统一关联身份，页面保活能真正延长会话过期时间。
- 会话持久化完成语义：登录/登出响应前等待关键 Session 写盘，写盘失败会明确报错，不再静默成功；服务重启后登录态按已落盘的会话恢复。
- 认证失效不再中断后台任务：会话失效（登出/改密/24 小时过期）只切换前端登录界面，不停止正在运行的 Agent；SSE 观察通道断线时自动补查认证状态，瞬时断网不再误判为登出。
- 单元测试误重启真实服务：完整更新流转测原先未注入 `refreshService`，回退到真实的 `refreshRegisteredServiceAfterUpdate()`，会探测 `~/.config/systemd/user/` 并执行 `systemctl --user restart`，导致测试运行期间服务被反复重启。已注入假实现，测试不再触碰真实服务管理命令。
- 安装脚本在制品缺少 `SHA256SUMS` 条目时改为 fail closed，并在写入新二进制前迁移旧的 macOS/Linux 安装根。
- Playwright 为编译二进制准备隔离认证状态并创建浏览器 session，恢复受保护 API、PWA 与离线回退 E2E。

### 工程化

- 新增真实 Bun 服务器回归测试：登录取得 Cookie → 请求 `/api/auth/status` → 断言返回滑动续期 `Set-Cookie`，覆盖 Proxy Request 身份修复。
- 新增保活/认证检查单元测试：会话失效时通知登录墙、网络错误不误判登出、有效会话不触发登出。
- `startServer()` 停止时同步关闭内部静态资产服务，避免进程残留与端口占用。
- 在 TypeScript 配置与 `src/runtime.d.ts` 中显式声明 Bun runtime 和 Bun-compatible `node:*` 类型边界。

### 文档

- 重组公开文档目录，补全多语言 README、用户/开发/维护者指南、支持、安全和社区文档，并保留历史公开路径的兼容页。

## [0.9.3] - 2026-08-31

### 修复

- `update` 版本检查在 GitHub API 返回 HTTP 403（未认证限速，常见于共享出口 IP）时不再直接报错：主源失败会自动降级到 jsDelivr CDN 镜像（无 API 限速），仅当两个源都不可达时才提示设置 `PI_WEB_X_UPDATE_URL`。

## [0.9.2] - 2026-08-31

### 修复

- 修正 systemd 服务迁移测试的路径构造，使模拟的 env 路径跟随运行平台的 `node:path` 语义，恢复 Windows CI 验证。

## [0.9.1] - 2026-08-31

### 新增

- `pi-web-x update` 在二进制替换成功后自动检测并恢复已注册的用户级系统服务：Linux systemd 重启并检查 active 状态，macOS launchd 重启并检查已加载状态，Windows 计划任务在二进制可替换时重新运行。
- 旧安装根迁移 `~/pi-web-x` → `~/.pi-web-x` 时，自动修复 systemd/launchd 服务中固化的二进制路径；systemd 的旧配置快照会安全复制到 `~/.pi-web-x/env`，保留端口、监听地址和 Basic Auth 密码。

### 变更

- `@earendil-works/pi-agent-core`、`pi-ai`、`pi-coding-agent` 与 `pi-tui` 统一升级至 `0.84.4`。

### 修复

- 服务恢复失败时，更新命令以非零状态报告错误，但保留已验证的新二进制和旧版本备份，便于在修复服务环境后重试。

## [0.9.0] - 2026-08-31

### 新增

- Web 访问认证：首次启动输出一次性设置令牌，浏览器完成密码初始化后使用内存会话登录；设置中的“安全”分区支持改密并使所有设备重新登录，以及退出当前设备。
- 移动 PWA Companion：Service Worker 更新改为用户确认后生效；在安全上下文中可由用户主动开启任务完成通知；对不满足 HTTPS、安全上下文或认证条件的连接说明功能限制。草稿仅在当前浏览会话中保留，离线时不会执行 Agent、缓存会话历史或排队写入。
- 安装根目录迁移：macOS/Linux 默认使用 `~/.pi-web-x`，旧的 `~/pi-web-x` 安装会自动迁移；命令入口仍位于 `~/.local/bin`。

### 变更

- 安全页复用设置“常规”页面的布局与排版；设置样式统一经全局 CSS 构建管道打包，避免独立样式资源遗漏。

### 修复

- 更新命令的测试固定注入 Linux 平台，避免 macOS/Windows CI 因宿主平台差异失败。

### 安全

- 默认 loopback、Host/Origin 校验与 Host Runtime Environment / Project Command Environment 隔离不变。`pi-web-x` 继续不读取或迁移旧 `pi-web:*` 浏览器标识。

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

首次开源发布。基于迁移自 `pi-web@0.8.11`（upstream commit `28bab3c`）的独立兼容实现，详见[迁移历史](./docs/history/bun-migration.md)与[运行时替代矩阵](./docs/maintainers/runtime-substitution-matrix.md)。

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

[0.12.0]: https://github.com/xiaojueshi/pi-web-x/releases/tag/v0.12.0
[0.11.2]: https://github.com/xiaojueshi/pi-web-x/releases/tag/v0.11.2
[0.11.1]: https://github.com/xiaojueshi/pi-web-x/releases/tag/v0.11.1
[0.11.0]: https://github.com/xiaojueshi/pi-web-x/releases/tag/v0.11.0
[0.10.1]: https://github.com/xiaojueshi/pi-web-x/releases/tag/v0.10.1
[0.10.0]: https://github.com/xiaojueshi/pi-web-x/releases/tag/v0.10.0
[0.9.4]: https://github.com/xiaojueshi/pi-web-x/releases/tag/v0.9.4
[0.9.3]: https://github.com/xiaojueshi/pi-web-x/releases/tag/v0.9.3
[0.9.2]: https://github.com/xiaojueshi/pi-web-x/releases/tag/v0.9.2
[0.9.1]: https://github.com/xiaojueshi/pi-web-x/releases/tag/v0.9.1
[0.9.0]: https://github.com/xiaojueshi/pi-web-x/releases/tag/v0.9.0
[0.8.12]: https://github.com/xiaojueshi/pi-web-x/releases/tag/v0.8.12
[0.8.11]: https://github.com/xiaojueshi/pi-web-x/releases/tag/v0.8.11
