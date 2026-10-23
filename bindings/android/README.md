# Android binding

预留 Kotlin/Java API 与 JNI/NDK 实现。

建议入口：`MakeupSdk.create()`、`initialize()`、`apply()`、`clear()`、`dispose()`。绑定层负责 CameraX/Surface 生命周期、线程切换和 C ABI 错误映射；共享核心不直接持有 Android 对象。

