# iOS binding

预留 Swift API 与 Objective-C/C header 集成。

绑定层负责 AVFoundation、Metal 纹理和主线程回调，并将 C ABI 的状态码转换为 Swift `Error`。共享核心不直接依赖 UIKit、AVFoundation 或 Metal。

