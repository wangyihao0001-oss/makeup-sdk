# 业务前端与 SDK 接入状态

来源：`dress/docs/FRONTEND.md` 第 5 节及 `dress/研发分工/前端研发执行文档.md`。迁移日期：2026-10-23。

## SDK 当前状态（2026-10-26）

SDK 已从 mock/口红最小 renderer 进入独立小程序 binding 阶段：不依赖外部
OpenMakeupSDK。npm 代码包只包含 JS/TS binding、核心 WASM、资源清单和微信宿主工厂 `createWechatMakeupSdk()`。FaceMesh SIMD 运行时、468 点网格、六类妆效 shader 和 73 个纹样放在独立静态资源包，按清单下载到微信用户目录。绑定测试 23/23。上次记录的服务器回归为原生 CTest 6/6、WASM CTest 2/2。

当前 SDK 代码已覆盖相机帧归一化、内置 FaceMesh tracker、WebGL 网格渲染、pattern/morph、
WASM/TS-JS fallback、捕获和释放。真实微信设备的基础库、GPU、FaceMesh 输入、持续帧率、
内存和 `canvasToTempFilePath` 结果尚未登记，因此不能把服务器合同测试当作真机通过。

## 当前业务流程

业务侧已有 M01 六类入口 → M02/M03 镜面 → M04 快照 → 按需登录保存 → M05 私人记录的流程。后台/离开释放、冻结参数和 `saveRequestId` 去重已有实现；保存重试复用已完成上传和请求 ID，并检查所属账号。

## 业务前端当前 mock 边界

- `MockMakeupEngine.apply()` 不渲染妆效，纹样目录为合成数据；unsupported 不初始化相机、不转云端。
- 当前业务页面仍使用 mock 引擎；SDK 已有真实帧、追踪和渲染链路，但尚未接入页面生命周期。
- 页面的人脸状态仍来自开发测试状态；SDK 已能返回无人脸、多人脸和追踪错误，页面尚未消费这些真实事件。
- 页面 `capture()` 仍返回静态示例图；SDK `capture()` 已等待最近有效渲染帧并通过微信导出回调生成结果。
- 示例快照和参数留在会话内存，主动保存才上传 `private_makeup_result`；列表、详情、删除调用业务 API。该流程用于业务联调，不能验收 AR 能力。

## 接入待办

1. 将业务页面接入 `createWechatMakeupSdk()`，提供页面 canvas、FaceMesh script/canvas loader 和导出回调。
2. 在微信小程序验证相机帧 → 人脸关键点 → WebGL 合成 → 当前帧导出。
3. 将产品 `dewy` 映射到 SDK `glossy`，所有类别使用稳定纹样 ID，不以展示排序作为标识。
4. 将异步资源加载、连续切换竞态、拍摄等待和失败恢复纳入页面状态模型。
5. 记录镜像坐标、颜色空间、输出方向、镜头切换、资源释放和微信设备性能结果。

上游 OpenMakeupSDK 已固定为 `12c5a8023aab0fcec7eef4fbdc0d1a29cf9989dd`，许可证和资源清单见
`bindings/miniprogram/UPSTREAM.md`。第一验收门槛仍是微信真实设备上的单类口红闭环，
服务器合同测试、静态图和 H5 演示不能替代真机证据。

