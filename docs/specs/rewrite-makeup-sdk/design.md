# Design

## Context

当前产品门面位于 `miniprogram/src/makeup/facade.ts`，引擎实现位于 `engines.ts`。`EnginePorts` 只有相机启动/停止、合成的人脸状态和静态截图，无法表达逐帧输入、异步资源或渲染上下文。页面已经拥有 M01—M05 流程和私人保存链路，因此重写应该替换引擎内部，并把通用 SDK 通过小程序绑定接入，而不是重做页面和服务端记录。

## Goals / Non-Goals

**Goals:**

- Android、iOS、微信小程序共享同一套核心语义；H5 通过独立适配器保留开发联调能力。
- 提供 Kotlin/Java、Swift/Objective-C、TypeScript/JavaScript 三套薄绑定，避免业务方直接接触内部端口。
- 共享核心只处理帧、关键点、妆容层、资源和生命周期。
- 首先完成三端口红真实端闭环，再扩展六类妆效。
- 让最终成图、参数、纹样 ID、质感、SDK/清单版本来自同一帧和同一状态。

**Non-Goals:**

- 不继续维护一个依赖 DOM 的浏览器核心作为跨平台运行时。
- 不在没有三端真机证据时承诺帧率、设备覆盖或妆效精度。
- 不在本次变更中改私人试妆 API 的授权和幂等规则。

## Decisions

### 1. 分层结构

新增独立 SDK 目录（建议 `sdk/`，业务仓库通过包或本地 workspace 引入），分为：

- `core/`：类别、质感、稳定纹样、关键点、帧、资源清单、运行状态、效果图和异步状态机。
- `ports/`：相机帧源、追踪器、渲染器、资源加载、日志和时间源的稳定接口。
- `bindings/android/`：Kotlin/Java 外部 API、JNI/Native bridge、Android 相机和 GPU 适配。
- `bindings/ios/`：Swift/Objective-C 外部 API、ObjC++/Native bridge、AVFoundation 和 GPU 适配。
- `bindings/miniprogram/`：TypeScript/JavaScript API、小程序相机/渲染/模型适配；不得把小程序对象泄漏到核心。
- `bindings/h5/`：仅用于 H5 开发和能力对照，不能替代移动端或小程序真机验收。

产品 `MakeupFacade` 继续是页面唯一入口。它把页面的六类参数转换成 SDK 参数，并把 SDK 状态转换为现有 `MakeupState` 文案。`morph`、模糊和自动选色不进入门面。移动端业务方使用同样的公开方法和事件模型。

### 2. 端口契约

相机端口提供 `start(onFrame)`, `stop()` 和镜像/尺寸信息；帧包含时间戳、方向、像素格式和可被渲染器消费的纹理或像素句柄。追踪端口提供异步 `estimate(frame)`、人脸数量/置信度和归一化关键点。渲染端口提供 `render(frame, landmarks, layers)`, `capture()` 和 `dispose()`。资源端口负责 manifest、模型、shader 和纹样的版本化加载与本地缓存。三端都必须转换到同一坐标、颜色和 alpha 约定。

所有端口均返回 Promise 或可取消句柄。共享核心不假设 `requestAnimationFrame`、DOM canvas 或浏览器媒体流存在。

### 3. 公开 API 与绑定

三端公开 API 固定为 `create(config)`, `getCapabilities()`, `initialize()`, `start()`, `apply()`, `clear()`, `clearAll()`, `capture()`, `stop()` 和 `dispose()`，事件固定为状态变化、资源进度、追踪状态、错误和性能采样。语言绑定只做命名和内存管理转换，不改变状态语义。外部 API 必须携带 SDK、模型、清单和渲染后端版本。

共享核心推荐采用 C++，通过稳定的 C ABI 暴露给各端。Android 侧用 NDK/CMake 构建并由 Kotlin/Java 通过 JNI 持有不透明句柄；iOS 侧以静态库或 XCFramework 交付，由 Swift 通过 C/Objective-C 头文件调用；两端的官方工具链都能直接接入 C/C++。小程序绑定不假设可以直接加载原生动态库，先验证将同一核心编译为 WASM 的路径；如果小程序运行时或性能不满足，再保留同一份 C ABI 作为协议，在小程序端实现等价的 TypeScript 核心和渲染适配。无论采用哪条小程序路径，验证结果都要写入 capability report。

C++ 核心只负责数据结构、参数校验、纹样清单、坐标转换、效果图、生命周期和错误码。它不持有相机对象、Android `Surface`、iOS `MTLTexture`、微信 canvas 或任意 UI 对象。FaceTracker 和 Renderer 作为端口注入；这样 Android/iOS 可以使用原生 GPU 后端，小程序可以使用 WASM + WebGL 或平台提供的渲染能力，而业务 API 仍保持一致。

### 4. 状态与竞态

每个 SDK 会话维护递增的 operation token。初始化、换色、清除、捕获和销毁都检查 token；旧操作完成时只能释放自己持有的资源，不能提交到当前会话。捕获必须等待最近一次渲染完成，并把当前参数快照与图片一起返回。

### 5. 渲染与资源策略

首个渲染器只实现一个口红 mask，复用上游算法思想但不直接复制未固定提交。Android、iOS 和小程序各自提供 GPU 后端，核心只提交统一的 effect graph；不要把 Android OpenGL、iOS Metal 或小程序 WebGL 对象泄漏到核心。模型、shader 和纹样使用自有 manifest 和静态资源版本，按平台和后端选择资源并缓存。资源缺失时保持已成功的其他层并返回可识别错误。镜像坐标、颜色空间、透明度、输出尺寸和后端版本写入设备探针结果。

### 6. 页面和宿主接入

`MakeupScreen.vue` 只等待小程序绑定 facade 的 `initialize()`、订阅状态、调用异步 `apply()` 和 `capture()`。Android/iOS 宿主页面使用对应绑定但遵循同一状态模型。页面离开调用 `dispose()`；相机权限拒绝、追踪失败、资源加载失败和 GPU 上下文丢失分别显示已有状态面板。保存动作继续走现有 `saveRequestId` 和私人资产接口，不上传实时帧。

## Acceptance Gate

WP10 只有在 Android、iOS、微信小程序各一台明确记录型号、系统/基础库、宿主版本和 SDK 构建版本的真机上通过以下链路后才算完成：主动授权相机、稳定获得帧、检测单人脸、选择口红颜色、连续渲染至少一段可观察会话、导出当前合成帧、释放相机/追踪器/GPU 资源，并记录失败恢复、内存、首帧时间和持续帧率。未通过的平台保留 mock/unsupported，不扩大到六类。

## Risks / Trade-offs

- 微信相机帧能力、FaceMesh 运行时或 WebGL 上下文可能受基础库和设备差异影响；先做设备探针，再决定具体实现，不把 H5 兼容性当作替代证据。
- 模型和纹样外置会增加首次加载时间；以 manifest 版本缓存和进度状态换取主包体积与可更新性。
- 上游质感语义与产品文案不完全一致；兼容映射必须进入捕获参数和测试，避免保存后无法复现。

