# OpenMakeupSDK 移植来源

本目录的微信小程序实现以 [OpenMakeupSDK](https://github.com/ehsanwwe/OpenMakeupSDK)
为功能和资源来源，固定上游提交：`12c5a8023aab0fcec7eef4fbdc0d1a29cf9989dd`。

`assets/` 包含上游的模型、shader、纹样和 FaceMesh 运行时资源；
`third_party/openmakeup/` 保存对应的源码参考。上游项目采用 MIT 许可证，版权和许可文本见
`third_party/openmakeup/LICENSE`。

上游源码依赖浏览器 DOM、Three.js 和 MediaPipe 全局对象，不能直接在微信小程序中运行。
小程序适配层必须保持上游类别、纹样、材质和 morph 语义，同时将相机、FaceMesh、WebGL
和资源加载替换为微信宿主实现。
