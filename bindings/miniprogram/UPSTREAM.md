# OpenMakeupSDK 移植来源

本目录的微信小程序实现以 [OpenMakeupSDK](https://github.com/ehsanwwe/OpenMakeupSDK)
为功能和资源来源，固定上游提交：`12c5a8023aab0fcec7eef4fbdc0d1a29cf9989dd`。

`assets/` 包含上游的模型、shader、纹样和 FaceMesh 运行时资源；
`third_party/openmakeup/` 保存对应的源码参考。上游项目采用 MIT 许可证，版权和许可文本见
`third_party/openmakeup/LICENSE`。

上游源码依赖浏览器 DOM、Three.js 和 MediaPipe 全局对象，不能直接在微信小程序中运行。
本移植保留上游的类别、纹样、材质、shader、468 点网格和 morph 语义；
`openmakeup-webgl-renderer.js` 用无 Three.js 的 glTF/WebGL 实现替换 Three.js 场景，
`wechat-adapters.js` 则把相机、FaceMesh、图片和资源加载接到微信宿主回调。

为限定运行时边界，内置 `face_mesh.js` 已移除浏览器平台探测，
`useCpuInference` 默认关闭；宿主如有需要仍可通过 FaceMesh options 显式设置。
FaceMesh 只保留 SIMD 运行时。非 SIMD 二进制、Blender 源文件和 `uv-checker` 调试贴图不进入资源包。
