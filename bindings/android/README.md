# Android binding

这里提供可构建的 Android Library 工程，Kotlin 入口为
`com.wangyihao0001.makeupsdk.MakeupSdk`，Java callback 兼容入口为
`MakeupSdkJava`。JNI/NDK 只包装共享 C ABI，平台相机、
追踪器和 GPU 端口仍由上层 Android 应用注入。

构建 AAR：

```bash
bash scripts/android/install-toolchain.sh
bash scripts/android/build-aar.sh
```

产物为 `release/makeup-sdk-android-${VERSION}.aar`，当前 ABI 为 `arm64-v8a` 和
`x86_64`。真实 CameraX、追踪和渲染能力在 capability report 中单独登记。

