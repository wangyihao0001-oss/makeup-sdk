# Proposal

## Why

当前 `miniprogram/src/makeup` 只有产品门面、mock 引擎和 unsupported 引擎。上游 OpenMakeupSDK 直接依赖 `HTMLVideoElement`、`HTMLCanvasElement`、`window`、MediaPipe 和 Three.js，不能直接复用到微信小程序，更不能作为 Android/iOS 的通用运行时。继续把浏览器对象塞进页面会让三端行为分叉，也会把同步的产品接口和异步的资源加载混在一起。

## What Changes

- 重写为可在微信小程序运行的试妆核心，通过小程序相机帧、人脸追踪和 WebGL 适配器接入宿主能力。
- 保留 TypeScript/JavaScript 外部 API，并将上游浏览器 API 转换为小程序可用的异步接口。
- 保留六类产品能力：口红、睫毛、眼线、眼影、腮红、底妆；保留稳定纹样 ID、颜色、质感和 SDK/清单版本。
- 将 `apply`、初始化、资源加载和拍摄改为可等待的异步状态机，处理连续切换、失败恢复和销毁竞态。
- 用清单驱动资源和版本缓存，明确 `dewy` 到 SDK `glossy` 的兼容映射，不把浏览器 DOM 类型带入小程序运行时。
- 以单一口红效果完成微信小程序真实设备的相机帧 → 人脸关键点 → GPU 合成 → 当前帧导出闭环，再扩展其余类别。

## Non-goals

- 不把试妆改成服务端生成或上传实时帧。
- 不在本变更中实现脸型调整、模糊、自动选色或公开分享。
- 不直接复制上游未固定提交的源码或未审计的纹样资源。
- 不把 mock 引擎当作真实 AR 能力的验收证据。

## Impact

主要影响共享核心、`bindings/miniprogram/`、试妆镜页面和静态资源加载。保存、列表、删除接口继续接收已经导出的成图和冻结参数；服务端不承担妆效渲染。实现需要固定 OpenMakeupSDK 上游提交、迁移模型/纹样/shader 资源、建立微信设备能力矩阵和小程序性能记录。Android/iOS 绑定暂不属于当前范围。

