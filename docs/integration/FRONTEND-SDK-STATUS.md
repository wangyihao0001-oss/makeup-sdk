# 业务前端与 SDK 接入状态

核对日期为 2026-11-12。代码基线为 `dress` 的 `1c84cb5` 和 `makeup-sdk` 的 `ae33870`（SDK `0.1.0`）。

## 微信试妆页已接入 SDK

`dress/miniprogram/src/components/MakeupScreen.vue` 在微信环境默认选择 SDK。页面通过 `WechatMakeupEngine` 和 `createWechatSdkForCanvas()` 把微信相机、FaceMesh、WebGL 画布和图片导出接到 `createWechatMakeupSdk()`。`mock` 仍可通过 `VITE_MAKEUP_ENGINE=mock` 显式启用，其他环境默认走 `unsupported`。

- `engines.ts` 消费 SDK 的单人脸、无人脸和多人脸状态。换妆使用 SDK 返回的稳定纹样 ID，产品 `eyeline` 在引擎内转为 `eyeliner`，水光 `dewy` 由 SDK 归一化为 `glossy`。
- 页面在单人脸状态下调用 SDK 拍摄。业务宿主可将 WebGL 合成像素通过 2D 离屏画布导出为临时文件。页面隐藏或卸载时会销毁 SDK 会话，微信适配层保留共享 FaceMesh 实例供后续会话复用。
- 页面从六类入口进入试妆镜，拍摄后冻结参数、SDK 版本和清单版本。用户主动保存才上传 `private_makeup_result`，保存重试复用已上传的资产和 `saveRequestId`，并检查登录账号。实时相机帧留在设备侧。
- 前后摄像头按钮已绑定原生相机组件的 `device-position`，实际切换待真机验证。按住对比目前只切换页面标签，切换实际原始画面和合成画面的逻辑仍待实现。

## 代码包、构建和静态资源

`dress/miniprogram/package.json` 依赖相邻 `makeup-sdk/release/` 目录的 `wangyihao0001-makeup-sdk-miniprogram-0.1.0.tgz`。微信构建前运行 `prepare:mp-weixin`，由 `scripts/prepare-makeup-sdk-assets.mjs` 修补已安装 SDK 的相机帧保留、追踪状态、预览和 WebGL 渲染，并生成业务侧 FaceMesh 运行时代码。这些构建补丁中还有部分未合入 SDK `0.1.0`。

`dress` 明确使用 `runtime: 'ts-js'` 运行 SDK 会话。人脸追踪单独使用 FaceMesh SIMD WASM，构建时将 `.wasm.br` 放入微信小程序包，模型数据、网格、shader 和纹样使用 `VITE_MAKEUP_ASSETS_BASE_URL` 配置的静态资源前缀。SDK 的 npm 包包含 JS/TS binding、核心 WASM 和资源清单。独立静态资源包的打包与归档见[发布流程](../RELEASE.md)。

## 回归与真机验收

| 检查 | 当前结果 |
| --- | --- |
| SDK 本地回归 | 小程序 binding 测试 23/23，含仓库现有 WASM 的加载和生命周期。C/C++ 重新编译后运行的 5 项测试全部通过。 |
| `dress` 试妆回归 | 临时目录按微信构建流程准备依赖后，试妆、预览、FaceMesh 运行时和微信资源四组测试通过 38/38。直接使用未准备的 SDK 依赖时，5 项测试失败，涉及相机帧、追踪状态和预览。 |
| 微信真机 | [设备清单](../compatibility/devices.yaml)仍为 `pending`。实体设备型号、微信基础库、首帧时间、持续帧率、内存和导出结果待记录。 |

第一项验收是在微信真机授权相机、稳定跟踪单人脸、实时上口红、导出合成帧并退出试妆。记录设备和构建版本，复查授权拒绝、资源失败与恢复。之后验证其他妆效、镜头切换、画面对比，以及私人保存、重试和删除。

源码入口位于 `dress/miniprogram/src/components/MakeupScreen.vue`、`dress/miniprogram/src/makeup/` 和 `dress/miniprogram/scripts/prepare-makeup-sdk-assets.mjs`。上游提交、许可和资源清单见 [UPSTREAM.md](../../bindings/miniprogram/UPSTREAM.md)。
