# SDK 文档索引

这些资料从 `dress` 业务仓库迁移而来，SDK 项目从这里维护共享核心、平台绑定和业务接入契约。迁移日期：2026-10-23。

## 设计与规格

- [`specs/rewrite-makeup-sdk/proposal.md`](specs/rewrite-makeup-sdk/proposal.md)：重写目标、范围和影响。
- [`specs/rewrite-makeup-sdk/design.md`](specs/rewrite-makeup-sdk/design.md)：C++ 共享核心、C ABI、三端绑定和渲染边界。
- [`specs/rewrite-makeup-sdk/tasks.md`](specs/rewrite-makeup-sdk/tasks.md)：实施工作包和验收门槛。
- [`specs/rewrite-makeup-sdk/specs/makeup-sdk/spec.md`](specs/rewrite-makeup-sdk/specs/makeup-sdk/spec.md)：可验证的 SDK 行为规格。

## 业务接入

- [`integration/PRODUCT-ARCHITECTURE.md`](integration/PRODUCT-ARCHITECTURE.md)：端上试妆、业务服务和私人资产的边界。
- [`integration/MAKEUP-UX.md`](integration/MAKEUP-UX.md)：六类妆效、页面状态和 SDK 适配门槛。
- [`integration/FRONTEND-SDK-STATUS.md`](integration/FRONTEND-SDK-STATUS.md)：当前业务前端的 mock 边界和真实 SDK 待办。

## 交接参考

- [`reference/FRONTEND-WORKPLAN.md`](reference/FRONTEND-WORKPLAN.md)：前端 WP10—WP15 的 SDK 相关责任和验收要求。
- [`reference/B2-WORKPLAN.md`](reference/B2-WORKPLAN.md)：资源、模型/纹样清单、静态资源和缓存交接要求。

`reference/` 文档保留了业务仓库的原始上下文，工作包状态以 `dress` 仓库的最新提交为准；SDK 实现以本仓库的代码、规格和平台 capability report 为准。

