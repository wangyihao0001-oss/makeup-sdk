# 架构说明

## 分层

```text
平台 API（TypeScript/JavaScript 小程序 binding）
        ↓
平台绑定（JNI / Objective-C / JS-WASM）
        ↓
稳定 C ABI（core/include/makeup_sdk/makeup_sdk.h）
        ↓
共享 C++ 核心（状态、参数、坐标、效果编排）
        ↓
平台采集与渲染后端（CameraX/AVFoundation/小程序能力）
```

共享核心只处理与平台无关的数据和状态，避免把 Android、iOS 或小程序对象泄漏到公共接口。所有耗时操作都由绑定层异步调度；ABI 负责返回可判断的状态码和错误信息。

## 运行时流程

1. 创建 session。
2. 初始化并读取能力矩阵。
3. 平台绑定提交帧和追踪结果。
4. 调用 `mk_session_apply` 更新妆容参数。
5. 平台渲染器输出画面或纹理。
6. 停止后释放 session。

## 后续工作

- 增加帧输入、关键点输入和统一坐标/像素格式。
- 为微信小程序实现 WASM/TypeScript + WebGL 后端；Android/iOS 后端暂不在当前范围。
- 用真实单色口红链路替换当前参数存储骨架。
- 补充 ABI 兼容性、性能和跨端视觉一致性测试。

