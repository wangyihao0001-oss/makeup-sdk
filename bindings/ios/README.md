# iOS binding

这里提供 Swift async facade、Objective-C completion facade、公开头文件和 XCFramework 构建脚本。共享核心不直接
依赖 UIKit、AVFoundation 或 Metal；相机、追踪器和渲染器由宿主应用接入。

只能在 macOS/Xcode 环境构建：

```bash
bash bindings/ios/scripts/build-xcframework.sh
```

脚本生成真机 `arm64` 和 Simulator `arm64/x86_64` slice，并输出
`MakeupSDK-${VERSION}.xcframework.zip`。

