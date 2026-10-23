# 小程序 binding

预留 TypeScript API 与 WASM/JS 运行时适配。

先验证目标小程序运行时的 WASM、相机帧回调和 WebGL 能力；如果受限，则保留同一套接口，使用平台允许的 TS/JS 计算路径。绑定层负责生命周期、帧格式和能力降级。

