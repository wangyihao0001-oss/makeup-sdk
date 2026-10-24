# 构建说明

## 阿里云 Linux

原生核心、C ABI、WASM、小程序 npm 包和 Android AAR 在阿里云服务器构建。Linux 服务器需要 CMake、Node.js、Emscripten、JDK 17、Android SDK/NDK 和 Gradle。

```bash
cmake -S . -B build-native
cmake --build build-native -j2
ctest --test-dir build-native --output-on-failure

emcmake cmake -S . -B build-wasm -DMAKEUP_BUILD_WASM=ON
cmake --build build-wasm -j2
npm --prefix bindings/miniprogram test
bash -c 'cd bindings/miniprogram && npm pack --dry-run'
bash scripts/android/build-aar.sh
```

## macOS GitHub Actions

iOS XCFramework 只能在 macOS runner 上构建：

```bash
bash bindings/ios/scripts/build-xcframework.sh
```

## 版本

默认版本读取根目录 `VERSION`。Release workflow 从 `vX.Y.Z` tag 注入版本，并将版本传给 CMake、Gradle、iOS framework、WASM manifest 和 npm package。
