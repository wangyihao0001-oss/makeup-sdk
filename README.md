# Makeup SDK

面向 Android、iOS 和小程序的通用试妆 SDK 重写项目。

当前版本是第一阶段骨架：共享核心使用 C++17 编写，通过稳定的 C ABI 对外提供生命周期、能力查询和妆容参数接口。摄像头采集、人脸关键点、GPU 渲染和平台绑定会在后续迭代中分别实现。

## 目录

```text
core/                 共享 C++ 核心与 C ABI
bindings/android/     Android 集成边界（JNI/NDK）
bindings/ios/         iOS 集成边界（Swift/Objective-C）
bindings/miniprogram/ 小程序集成边界（JS/TS/WASM）
renderers/            各平台渲染器预留目录
examples/             本地示例
docs/                 架构与开发说明
```

## 构建 smoke test

```bash
cmake -S . -B build
cmake --build build
ctest --test-dir build --output-on-failure
```

## 当前边界

- `core` 不接触摄像头、窗口、平台 UI 或 GPU 对象。
- 平台层负责采集视频帧、提供关键点/追踪结果，并连接平台渲染后端。
- 第一条可验收链路是三端真实设备上的单色口红效果。

