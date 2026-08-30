## 变更摘要 (Summary)

简要描述本次变更：动机、解决的问题、影响面。

## 类型 (Type of change)

- [ ] 新功能 (feature)
- [ ] 缺陷修复 (bug fix)
- [ ] 文档 (docs)
- [ ] 重构/工程化 (refactor/chore)
- [ ] 安全相关 (security)

## 测试 (Testing)

- [ ] `bun test` 通过
- [ ] `bun run typecheck` 通过
- [ ] `bun run build` 通过
- 若涉及编译产物验证：说明在哪个平台/版本上验证过

## 兼容与安全检查 (Compatibility & security)

- [ ] 未改动 `/api/*` 路径、方法、状态码、JSON 字段或 SSE 事件语义（或已在描述中说明）
- [ ] 未触碰 `lib/request-security.ts` 的 Host/来源校验（或在描述中说明并说明理由）
- [ ] 未引入可能向 Project Command Environment 泄露服务端变量的变更
- [ ] 测试未写真实 `~/.pi/agent` 数据（使用隔离 `HOME`）

## 关联 (Related)

- 关联 issue：#xxx
- 依赖替代：是否需要在 `docs/runtime-substitution-matrix.md` 同步更新？
