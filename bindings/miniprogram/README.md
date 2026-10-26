# 小程序 binding

这里提供与微信小程序宿主无关的 JavaScript binding，公开
`create()`、`initialize()`、`start()`、`apply()`、`clear()`、`clearAll()`、
`capture()`、`stop()` 和 `dispose()`。平台对象通过 camera/tracker/renderer/resources
端口注入，实时帧只留在设备侧。

运行时默认是 `auto`：按 `core` → `wasmFactory` → 内置 loader 的顺序尝试 WASM 核心，
加载失败后记录 `wasmLoadStatus` 和原因，再使用同一套语义的 TS/JS fallback。
`runtime: 'wasm'` 可用于强制诊断，加载失败不会降级；`runtime: 'ts-js'` 可用于开发联调。
只有四个端口全部初始化成功时，能力报告才会把 `lipstick` 标记为支持。

可发布 WASM 产物位于 `dist/makeup_sdk_core.wasm`，对应的 `dist/manifest.json` 固定
SDK、API、WASM、资源清单版本、文件大小、SHA-256 和必需导出函数。使用内置 loader
时传入 `wasmUrl` 与 `wasmManifest`；微信宿主可用 `createWechatWasmLoader()` 和
`createWechatWasmManifestLoader()` 注入下载或本地文件读取实现。loader 会校验 WASM
头、版本、大小、SHA-256、导出函数和 API 版本，并在实例化后执行初始化函数。

`src/webgl-renderer.js` 包含两种 renderer：兼容旧合同的口红 renderer，以及保持相机
纹理、面部关键点和多妆效层的 raw WebGL renderer。后者要求 tracker 提供归一化
关键点，并通过 `canvasToTempFilePath` 导出当前帧。上游 OpenMakeupSDK 的模型、shader、
纹样和 FaceMesh 资源位于 `assets/`，移植来源和固定提交见 `UPSTREAM.md`；
`dist/openmakeup-assets.manifest.json` 记录 73 个纹样、模型、shader 和 FaceMesh 文件的版本与 SHA-256。

真实微信项目需要把小程序 camera、FaceMesh、WebGL canvas 和临时文件导出 API 通过
`src/wechat-adapters.js` 适配到这些端口；模块加载时不会读取 `wx`、`window` 或 `document`。

如果业务需要兼容上游 `OpenMakeup` 调用方式，可使用 `OpenMakeupCompat`。它保留
`init()`、`apply(category, options)`、`getPatterns()`、`morph()`、`clear()` 和
`dispose()`，底层仍使用统一的小程序 session。

设备探针位于 `src/probe.js`，会记录 WASM、相机帧、WebGL、追踪器、资源和捕获检查结果。
本地合同测试可运行：

```bash
npm test
```

构建 WASM 产物：

```bash
emcmake cmake -S . -B build-wasm -DMAKEUP_BUILD_WASM=ON
cmake --build build-wasm
```

