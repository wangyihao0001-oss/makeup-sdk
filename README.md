# Makeup SDK

基于 OpenMakeupSDK 重写的微信小程序试妆 SDK 项目。本项目仅适配微信小程序。

当前版本包含 C++17 共享核心、稳定 C ABI、standalone WASM 构建和可发布的小程序 JS/TS binding。小程序包内置 FaceMesh 资源、468 点网格解析、六类妆效 shader、WASM loader、微信相机帧/纹理/资源适配器和一键宿主工厂。

## 目录

```text
core/                 共享 C++ 核心与 C ABI
bindings/miniprogram/ 小程序集成边界（JS/TS/WASM）
renderers/            小程序渲染器预留目录
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

`core/include/makeup_sdk/makeup_sdk_v2_runtime.h` 提供 C++ 端口编排、catalog、资源
版本校验和 `dewy → glossy` 质感归一化。小程序 binding 已提供同语义的 TS/JS fallback
和可校验的 WASM loader；`runtime: 'auto'` 在 WASM 加载失败时记录原因并降级 TS/JS，
`runtime: 'wasm'` 会直接返回加载错误。完整 WebGL renderer 使用上游 `face.glb`、UV
通道和 shader；只有真实相机、FaceMesh、WebGL、资源和捕获能力全部初始化后才报告妆效可用。

## 发布产物

版本由根目录 `VERSION` 和 `vX.Y.Z` Git tag 统一管理。GitHub Release 只归档小程序
WASM/npm 包、SHA256SUMS、兼容性清单和性能报告。Linux/WASM/Node 构建在阿里云服务器完成。

发布工程化说明见 [`docs/RELEASE.md`](docs/RELEASE.md) 和 [`docs/BUILDING.md`](docs/BUILDING.md)。

## 当前边界

- `core` 不接触摄像头、窗口、平台 UI 或 GPU 对象。
- 核心校验帧尺寸、像素格式、数据长度、方向、镜像和追踪置信度；微信适配器额外支持 RGB/YUV 帧转 RGBA8。
- `createWechatMakeupSdk()` 自动组装相机、资源、纹理、FaceMesh tracker、WebGL renderer 和 SDK session。
- 上游六类妆效、pattern 查询、morph、wireframe 和 blur 已完成代码级移植；真实微信设备的性能、GPU 和捕获结果仍待验收。
- 业务页面仍需接入真实页面生命周期和保存流程；实时帧只在设备侧处理，不上传。

