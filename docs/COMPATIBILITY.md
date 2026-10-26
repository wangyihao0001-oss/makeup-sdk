# 兼容性流程

设备兼容性以 `docs/compatibility/devices.yaml` 为准。当前代码级能力已经覆盖内置 FaceMesh、WebGL 六类妆效、WASM/TS-JS fallback、RGB/YUV 帧转换和捕获适配；没有真实设备证据的字段继续保持 `pending`。每次 Release 固定 SDK、模型、manifest、宿主版本和测试日期，并关联 capability report。
