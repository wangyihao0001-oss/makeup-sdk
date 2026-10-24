# 小程序 binding

这里提供与微信小程序宿主无关的 JavaScript binding，公开
`create()`、`initialize()`、`start()`、`apply()`、`clear()`、`clearAll()`、
`capture()`、`stop()` 和 `dispose()`。平台对象通过 camera/tracker/renderer/resources
端口注入，实时帧只留在设备侧。

运行时默认是 `auto`：如果传入 `wasmFactory`，先尝试 WASM 核心；加载失败后使用
同一套语义的 TS/JS fallback。`runtime: 'wasm'` 可用于强制诊断，
`runtime: 'ts-js'` 可用于开发联调。只有四个端口全部初始化成功时，能力报告才会把
`lipstick` 标记为支持。

`src/webgl-renderer.js` 包含最小 WebGL 口红 mask renderer，要求 tracker 提供归一化
的 `landmarks.lips` 多边形，并通过 `canvasToTempFilePath` 导出当前帧。真实微信项目
需要把小程序 camera、FaceMesh、WebGL canvas 和临时文件导出 API 通过
`src/wechat-adapters.js` 适配到这些端口；模块加载时不会读取 `wx`、`window` 或 `document`。

设备探针位于 `src/probe.js`，会记录 WASM、相机帧、WebGL、追踪器、资源和捕获检查结果。
本地合同测试可运行：

```bash
npm test
```

