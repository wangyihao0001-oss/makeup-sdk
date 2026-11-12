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
`src/wechat-adapters.js`。FaceMesh、模型、着色器和纹样通过 `npm --prefix bindings/miniprogram run pack:assets` 生成独立静态资源包。将解包后的文件部署到对象存储的静态资源前缀，CDN 对远程 `.wasm` 和 `.js` 开启 gzip 或 brotli。

## `dress` 微信小程序

`dress/miniprogram` 从相邻 SDK 仓库的 `release/` 目录安装 `0.1.0` npm tarball。`npm run build:mp-weixin:sdk` 会先运行 `prepare:mp-weixin`，准备 FaceMesh 运行时并给已安装的 SDK 应用业务侧兼容补丁。FaceMesh SIMD `.wasm.br` 随微信小程序打包，模型数据、网格、shader 和纹样通过 `VITE_MAKEUP_ASSETS_BASE_URL` 加载。业务构建和回归的当前基线见[接入状态](integration/FRONTEND-SDK-STATUS.md)。

## 版本

默认版本读取根目录 `VERSION`。Release workflow 从 `vX.Y.Z` tag 注入版本，并将版本传给 CMake、WASM manifest 和 npm package。
