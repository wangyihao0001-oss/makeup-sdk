# Makeup SDK

面向 Android、iOS 和小程序的通用试妆 SDK 重写项目。

当前版本包含 C++17 共享核心、稳定 C ABI、standalone WASM 构建和小程序 JS/TS binding。摄像头采集、人脸关键点和平台 GPU 对象仍由各端口注入。

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

文档入口见 [`docs/README.md`](docs/README.md)，其中包含重写规格、业务接入边界和从 `dress` 迁移的交接资料。

## 构建 smoke test

```bash
cmake -S . -B build
cmake --build build
ctest --test-dir build --output-on-failure
```

WASM 构建需要 Emscripten，并生成 `bindings/miniprogram/dist/` 下的
`makeup_sdk_core.wasm` 和 `manifest.json`：

```bash
emcmake cmake -S . -B build-wasm -DMAKEUP_BUILD_WASM=ON
cmake --build build-wasm
npm --prefix bindings/miniprogram test
```

共享核心 v2 的宿主驱动状态机和回归测试会同时构建为
`makeup_sdk_core_v2_test`。v2 使用 `mk2_` 前缀与现有 v1 C ABI 共存；平台绑定
通过 `pump()` 驱动操作队列，并通过事件队列读取状态和操作结果。

v2 的 C++ 端口契约位于 `core/include/makeup_sdk/makeup_sdk_v2_ports.h`，包含
`CameraPort`、`TrackerPort`、`RendererPort` 和 `ResourcePort`。本地合同测试
`makeup_sdk_v2_fake_ports_test` 使用确定性的 fake 实现验证启动/停止、逐帧追踪、
渲染后捕获、资源版本校验和释放行为；端口暂不暴露到 C ABI。

当前 v2 仍是无 renderer 的共享核心骨架：能力报告中的六类妆效均为不支持，
`apply()` 返回 `MK2_STATUS_UNSUPPORTED_EFFECT`，`capture()` 会以
`MK2_STATUS_RENDERER_UNAVAILABLE` 完成失败事件，不生成图片。

`core/include/makeup_sdk/makeup_sdk_v2_runtime.h` 提供 C++ 端口编排、catalog、资源
版本校验和 `dewy → glossy` 质感归一化。小程序 binding 已提供同语义的 TS/JS fallback
和可校验的 WASM loader；`runtime: 'auto'` 在 WASM 加载失败时记录原因并降级 TS/JS，
`runtime: 'wasm'` 会直接返回加载错误。只有真实端口全部初始化后才报告口红可用。

## 发布产物

版本由根目录 `VERSION` 和 `vX.Y.Z` Git tag 统一管理。GitHub Release 会归档 Android
AAR、iOS XCFramework、WASM/npm 包、SHA256SUMS、兼容性清单和性能报告。Linux/Android/
WASM 由阿里云构建，iOS 由 GitHub Actions macOS runner 构建。

发布工程化说明见 [`docs/RELEASE.md`](docs/RELEASE.md) 和 [`docs/BUILDING.md`](docs/BUILDING.md)。

## 当前边界

- `core` 不接触摄像头、窗口、平台 UI 或 GPU 对象。
- v2 会校验帧尺寸、像素格式、数据长度、方向、镜像和追踪置信度；当前只接受 RGBA8/BGRA8。
- 平台层负责采集视频帧、提供关键点/追踪结果，并连接平台渲染后端。
- 第一条可验收链路是三端真实设备上的单色口红效果。

