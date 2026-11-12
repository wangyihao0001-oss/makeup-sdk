# Tasks

## 1. OpenMakeupSDK 来源与小程序契约

- [x] 1.1 固定 OpenMakeupSDK 上游提交、MIT 许可证和算法/资源清单；不可直接移植的浏览器依赖记录于 `bindings/miniprogram/UPSTREAM.md`。
- [x] 1.2 采用 C++ 共享核心和 C ABI，定义小程序 WASM/TypeScript fallback 构建产物边界。
- [x] 1.3 固定小程序 WASM/TypeScript/微信 WebGL 路径；服务器合同和 WASM 测试通过，真实微信 capability report 仍待设备补录。
- [x] 1.4 定义跨平台 `types`、端口、状态机、错误码、能力报告、坐标系、像素格式和捕获结果类型；补充 `dewy` → `glossy` 的兼容表。
- [x] 1.5 定义小程序 TypeScript/JavaScript 公开 API 的命名、线程和内存规则。

## 2. 共享核心与绑定骨架

- [x] 2.1 实现共享核心的 manifest/catalog、稳定纹样 ID、版本校验和资源缓存接口。
- [x] 2.2 实现带 operation token 的初始化、换色、清除、捕获和 dispose 状态机。
- [x] 2.3 实现统一坐标、方向、镜像、RGBA/BGRA/RGB/YUV 帧归一化、alpha 和捕获元数据协议。
- [x] 2.4 实现 fake camera/tracker/renderer/resource ports 和竞态、失败、释放的单元测试。
- [x] 2.5 建立小程序薄绑定的最小构建与版本注入骨架。

## 3. 平台能力探针

- [x] 3.1 建立相机帧、追踪器、GPU/渲染上下文和当前帧导出适配器；设备型号、基础库和帧率仍待真机补录。
- [x] 3.2 内置 FaceMesh tracker、模型资源和单人脸/无人脸/多人脸结果归一化；真实微信 runtime 行为仍待设备验证。
- [x] 3.3 实现纹理上传、上游 shader 编译、上下文丢失检查、资源释放和捕获方向适配；真机证据待补。

## 4. 小程序功能闭环

- [x] 4.1 实现小程序相机、追踪器、GPU/渲染、资源端口和绑定适配器，并提供 `createWechatMakeupSdk()`。
- [x] 4.2 迁移 OpenMakeupSDK 的完整六类 shader 渲染链路；真实设备端到端成图仍待验收。
- [x] 4.3 `dress` 的 `MakeupScreen.vue` 已接入小程序异步 SDK。页面调用真实相机、FaceMesh、WebGL 和当前帧导出，处理无人脸和多人脸状态、妆效加载失败，并在隐藏或卸载时释放会话。接入以 `dress` 的 `1c84cb5` 为核对基线，见[接入状态](../../integration/FRONTEND-SDK-STATUS.md)。
- [ ] 4.4 在微信真机验收口红的相机授权、人脸追踪、实时上色、当前帧导出和退出释放，验证权限拒绝与资源加载失败后的恢复，并保存设备、微信基础库、首帧时间、持续帧率和内存记录。

## 5. 扩展与回归

- [x] 5.1 完成睫毛、眼线、眼影、腮红和底妆的代码级迁移，并补充 73 个纹样清单和质感映射。
- [x] 5.2 迁移脸型重塑、pattern 查询和调试 mesh 能力；真机视觉效果仍待验收。
- [ ] 5.3 实现按住对比的原始与合成画面切换，并在真机验证真实成图、对比、镜头切换、私人保存/重试/删除与版本化参数的一致性。
- [x] 5.4 建立微信设备能力清单、性能基线和发布包版本策略。
- [x] 5.5 更新 SDK 构建、发布、兼容性、性能和小程序宿主接入文档；真实设备边界已明确记录为 pending。

