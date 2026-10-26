# 构建说明

## 阿里云 Linux

原生核心、C ABI、WASM 和小程序 npm 包在阿里云服务器构建。Linux 服务器需要 CMake、Node.js 和 Emscripten。

```bash
cmake -S . -B build-native
cmake --build build-native -j2
ctest --test-dir build-native --output-on-failure

emcmake cmake -S . -B build-wasm -DMAKEUP_BUILD_WASM=ON
cmake --build build-wasm -j2
npm --prefix bindings/miniprogram test
bash -c 'cd bindings/miniprogram && npm pack --dry-run'
```

## 版本

默认版本读取根目录 `VERSION`。Release workflow 从 `vX.Y.Z` tag 注入版本，并将版本传给 CMake、WASM manifest 和 npm package。
