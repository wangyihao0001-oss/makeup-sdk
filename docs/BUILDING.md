# 构建说明

## 阿里云 Linux

原生核心、C ABI、WASM、小程序 FaceMesh 资源清单和 npm 包在阿里云服务器构建。Linux 服务器需要 CMake、Node.js 和 Emscripten；本机只负责编辑、同步和提交。

```bash
cmake -S . -B build-native
cmake --build build-native -j2
ctest --test-dir build-native --output-on-failure

emcmake cmake -S . -B build-wasm -DMAKEUP_BUILD_WASM=ON
cmake --build build-wasm -j2
npm --prefix bindings/miniprogram test
bash -c 'cd bindings/miniprogram && npm pack --dry-run'
```

绑定测试 23/23。上次服务器回归基线：原生 CTest 6/6、WASM CTest 2/2。npm 代码包应包含
`dist/makeup_sdk_core.wasm`、两个 manifest、`src/openmakeup-webgl-renderer.js` 和
`src/wechat-adapters.js`。FaceMesh、模型、着色器和纹样由 `npm run pack:assets` 打成独立静态资源包，上传到对象存储；不要放进小程序代码包。CDN 对 `.wasm` 和 `.js` 开启 gzip 或 brotli。

## 版本

默认版本读取根目录 `VERSION`。Release workflow 从 `vX.Y.Z` tag 注入版本，并将版本传给 CMake、WASM manifest 和 npm package。
