# 架构说明

## 范围

本项目只提供微信小程序 SDK。共享 C++ 核心和 C ABI 作为 WASM 内部运行时使用，业务代码只接触 TypeScript/JavaScript facade，不直接调用 C ABI。

## 分层

```text
微信小程序公开 API（TypeScript/JavaScript）
        ↓
微信宿主适配（相机帧、权限、生命周期、文件与 canvas）
        ↓
核心适配器（WASM 优先，TS/JS fallback）
        ↓
共享 C++ 核心 / 稳定 C ABI
        ↓
FaceMesh tracker + WebGL renderer + 资源缓存
```

共享核心只处理状态、参数、坐标、版本、队列和捕获元数据；不读取微信全局对象，也不持有相机、canvas 或 GPU 对象。微信适配层负责把宿主帧归一化后提交给核心，并把渲染结果导出为临时图片路径。

## 运行时流程

1. `create(config)` 选择 WASM 或 TS/JS 核心并加载版本清单。
2. `initialize()` 加载资源清单，初始化 FaceMesh 和 WebGL renderer，读取 `face.glb` 并生成能力报告。妆效 shader 和纹样按需加载。
3. `start()` 启动微信相机帧回调。
4. 每帧执行追踪、参数校验和 WebGL 合成；实时帧只在设备内处理。
5. `capture()` 等待最近一次有效渲染并导出当前合成帧。
6. `stop()` 停止帧回调。`dispose()` 调用各端口的清理方法并销毁会话，已缓存的静态文件可供后续会话复用。

## `dress` 接入与验收

`MakeupScreen.vue` 已通过 `createWechatSdkForCanvas()` 接入小程序相机、FaceMesh、WebGL 和成图导出。业务宿主显式选择 SDK 的 TS/JS 核心，FaceMesh 通过独立的 SIMD WASM 运行。构建时应用的兼容补丁见[业务前端与 SDK 接入状态](integration/FRONTEND-SDK-STATUS.md)。

- 完成微信基础库和真机设备矩阵，记录相机、FaceMesh、WebGL、导出和上下文恢复结果。
- 在不同设备上补充首帧、持续帧率、内存和失败恢复基线。
