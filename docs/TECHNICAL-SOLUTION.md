# Makeup SDK 技术方案

版本：v1.1
日期：2026-10-26
状态：代码级小程序移植已完成，真实微信设备验收待补

## 1. 文档目的

本文为 Makeup SDK 重写项目的技术实施方案。当前交付范围已收敛为 OpenMakeupSDK 到微信小程序的重写。

本文针对当前仓库的实际状态编写：共享核心已提供 v1/v2 ABI、状态机、事件队列、帧校验及清理竞态回归测试；小程序已提供 WASM/TS-JS binding、内置 FaceMesh tracker、无 Three.js 的上游网格/shader renderer、微信宿主工厂和资源清单；真实设备验证仍未完成。

## 2. 建设目标

### 2.1 总体目标

将 OpenMakeupSDK 的浏览器实现重写为微信小程序可运行的实时试妆 SDK，完成以下闭环：

```text
相机帧
  → 人脸关键点
  → 妆效参数与资源
  → 平台 GPU 合成
  → 实时预览
  → 当前帧捕获
  → 用户主动保存
```

核心运行时必须与宿主对象解耦。摄像头、纹理、WebGL 对象和页面生命周期由微信宿主适配层管理，不能泄漏到共享核心。

### 2.2 业务能力

首期对外支持六类妆效：

1. 口红
2. 睫毛
3. 眼线
4. 眼影
5. 腮红
6. 底妆

代码级移植覆盖六类妆效；生产验收仍先以微信真机单色口红闭环作为门槛，再补齐其余类别的设备视觉和性能证据。

### 2.3 非目标

本项目不在 SDK 内实现：

- 服务端妆效生成
- 实时视频上传
- 脸型调整、磨皮或自动选色
- 业务登录、权限和私人成图数据库
- 公开分享、广场和社交关系
- 平台页面 UI

## 3. 当前基线与问题

当前仓库主要文件如下：

- `core/include/makeup_sdk/makeup_sdk.h`：v1 C ABI 头文件
- `core/include/makeup_sdk/makeup_sdk_v2.h`：v2 C ABI 头文件
- `core/src/makeup_sdk.cpp`、`core/src/makeup_sdk_v2.cpp`：共享核心实现
- `examples/cpp/smoke.cpp`、`examples/cpp/core_v2_test.cpp`：C++ smoke 与 v2 合同测试
- `examples/c/core_v2_c_header_test.c`：C 编译兼容性测试
- `bindings/miniprogram/README.md`：微信小程序绑定边界说明
- `renderers/README.md`：渲染器预留说明
- `docs/specs/rewrite-makeup-sdk/`：重写规格和任务清单

当前实现同时保留 v1 同步 ABI，并提供 v2 的宿主驱动生命周期、事件队列、帧校验和妆效清理状态机。小程序 binding 提供 WASM 优先、TS/JS fallback、资源缓存、内置 FaceMesh、468 点 face.glb 解析、六类上游 shader renderer、pattern/morph、微信帧格式转换和一键宿主工厂。服务器回归为原生 6/6、WASM 2/2、小程序 18/18；真实微信设备仍需完成 capability report。帧校验支持 RGBA8/BGRA8，并由微信适配器把 RGB/YUV 转为 RGBA8。

当前 ABI 还有两个需要尽快修正的契约问题：

- 枚举只有 `lip/blush/eye/base` 四类，与产品六类妆效不一致。
- 质感只有 `matte/glossy/shimmer/natural`，没有明确 `dewy → glossy` 和 `glitter` 的兼容规则。

后续实现必须先冻结新的公共类型，再开始平台绑定，避免 WASM、TS/JS 和宿主工厂扩展出不兼容的接口。

## 4. 总体架构

```text
┌────────────────────────────────────────────────────────────┐
│                    业务页面 / MakeupFacade                 │
│  六类产品参数、页面状态、拍摄、保存和登录                    │
└─────────────────────────┬──────────────────────────────────┘
                          │ 平台公开 API
┌─────────────────────────┴──────────────────────────────────┐
│                     平台绑定层                              │
│ 微信小程序 TS/JS facade + 宿主适配                       │
│ 相机帧 / FaceMesh / WebGL / WASM 或 TS-JS fallback        │
└─────────────────────────┬──────────────────────────────────┘
                          │ 稳定 C ABI
┌─────────────────────────┴──────────────────────────────────┐
│                    共享 C++ 核心                             │
│ session / state / catalog / coordinate / capture / errors   │
│ operation token / fake ports / contract tests               │
└───────────────┬──────────────────┬─────────────────────────┘
                │ 注入端口           │ 纯数据协议
┌───────────────┴───────┐  ┌───────┴─────────────────────────┐
│ 微信相机与 FaceMesh    │  │ 微信 WebGL 渲染与资源            │
│ 帧格式 / 追踪结果      │  │ shader / mask / texture / cache │
└───────────────────────┘  └─────────────────────────────────┘
```

### 4.1 核心层职责

共享核心负责：

- 生命周期和状态机
- 妆效参数和稳定纹样 ID
- manifest/catalog 版本校验
- 统一坐标、方向、颜色和 alpha 约定
- 相机帧、关键点和捕获结果的数据协议
- 能力矩阵和错误码
- 操作取消与旧操作失效
- 资源和渲染端口编排

共享核心不负责：

- 打开摄像头
- 请求权限
- 创建窗口或持有页面对象
- 持有微信 camera、canvas、WebGL context 或页面对象
- 直接访问 `window`、`document`、HTML media、Three.js 或平台线程 API

### 4.2 平台层职责

平台层负责：

- 摄像头权限和生命周期
- 帧采集、格式转换和镜像处理
- 人脸模型加载和关键点推理
- GPU context、纹理和渲染目标
- 线程切换、主线程回调和资源释放
- 平台错误转换
- 设备能力探针

## 5. 统一数据模型

### 5.1 基础版本

所有 session 必须带版本信息：

```text
sdkVersion       SDK 二进制版本
apiVersion       C ABI 版本
modelVersion     人脸模型版本
manifestVersion  妆效资源清单版本
rendererVersion  平台渲染器版本
```

版本必须进入能力报告和捕获结果。保存后的业务记录只引用稳定版本和纹样 ID，不保存数组下标。

### 5.2 妆效类别

建议使用明确的六类枚举：

```text
MK_EFFECT_LIPSTICK
MK_EFFECT_MASCARA
MK_EFFECT_EYELINER
MK_EFFECT_EYESHADOW
MK_EFFECT_BLUSH
MK_EFFECT_FOUNDATION
```

如果为了兼容当前 ABI 需要保留旧枚举，必须定义 API v2，并提供显式转换函数，不能在同一版本中改变枚举值含义。

### 5.3 质感

产品层和引擎层分离：

```text
产品质感       引擎质感
matte          matte
dewy           glossy
shimmer        shimmer
glitter        glitter
```

捕获结果中同时保留：

- 原始产品质感
- 归一化引擎质感
- 映射规则版本

这样可以在资源清单变化后解释历史数据。

### 5.4 帧协议

每一帧至少包含：

```text
timestampNs       单调时钟时间戳
width / height     原始尺寸
pixelFormat       RGBA8 / BGRA8 / YUV 等
colorSpace        sRGB 或平台明确色彩空间
orientation       0 / 90 / 180 / 270
mirrored          是否前置镜像
nativeHandle      平台纹理或像素句柄
```

核心内部统一为归一化坐标 `(0, 0)–(1, 1)`，原点、方向和镜像规则必须在适配器入口完成转换。

### 5.5 关键点协议

追踪端口输出：

- 人脸数量
- 每张脸的置信度
- 归一化关键点数组
- 关键点模型版本
- 当前帧时间戳
- `valid / no_face / multiple_faces / unusable_frame` 状态

渲染器只能使用与当前帧匹配的关键点，不能无条件复用过期结果。

### 5.6 捕获结果

捕获结果包含：

```text
image              当前已完成渲染的图片或平台句柄
width / height     输出尺寸
orientation       最终方向
mirrored           最终镜像状态
layers             当前妆效参数快照
sdkVersion
manifestVersion
rendererVersion
captureTimestamp
```

捕获必须等待最近一次有效渲染完成，不能返回静态示例图，也不能与另一套参数快照拼接。

## 6. C ABI 设计

### 6.1 生命周期接口

建议将当前同步接口升级为 v2，同时保留 v1 兼容层：

```c
mk_status mk_session_create(const mk_config* config,
                            mk_session** out_session);
mk_status mk_session_get_capabilities(const mk_session* session,
                                      mk_capabilities* out);
mk_status mk_session_initialize(mk_session* session,
                                const mk_init_options* options);
mk_status mk_session_start(mk_session* session);
mk_status mk_session_stop(mk_session* session);
mk_status mk_session_dispose(mk_session* session);
mk_status mk_session_destroy(mk_session* session);
```

`destroy` 只负责释放不透明句柄；`dispose` 负责停止相机、追踪器、渲染器和资源。调用方必须先 dispose，再 destroy。重复 dispose 应保持幂等。

### 6.2 妆效接口

```c
mk_status mk_session_apply(mk_session* session,
                           const mk_effect_params* params,
                           uint64_t* operation_id);
mk_status mk_session_clear(mk_session* session,
                           mk_effect_category category,
                           uint64_t* operation_id);
mk_status mk_session_clear_all(mk_session* session,
                               uint64_t* operation_id);
```

接口只修改核心状态，不直接要求平台同步完成 GPU 绘制。完成结果通过事件、回调或绑定层 Future/Promise 返回。

### 6.3 捕获接口

```c
mk_status mk_session_capture(mk_session* session,
                             mk_capture_result* out_result,
                             uint64_t* operation_id);
mk_status mk_capture_result_release(mk_capture_result* result);
```

捕获失败必须区分：没有有效人脸、没有完成渲染、渲染器不可用、方向转换失败和资源失效。

### 6.4 错误码

建议补齐以下稳定错误码：

```text
INVALID_ARGUMENT
INVALID_STATE
NOT_INITIALIZED
UNSUPPORTED_EFFECT
CAMERA_PERMISSION_DENIED
TRACKER_UNAVAILABLE
NO_FACE
MULTIPLE_FACES
FRAME_INVALID
MODEL_LOAD_FAILED
ASSET_LOAD_FAILED
GPU_CONTEXT_LOST
CAPTURE_FAILED
RENDERER_UNAVAILABLE
OPERATION_CANCELLED
DISPOSED
INTERNAL_ERROR
```

错误码用于程序判断，面向用户的文案由绑定层或业务层提供。核心不返回平台特定文本作为逻辑依据。

## 7. 异步状态机和竞态处理

### 7.1 状态

```text
idle
  → loading
  → ready
  → tracking
  → rendering
  → captured
```

异常分支：

```text
任意状态 → unsupported
任意状态 → error
任意状态 → disposed
```

状态变化需要包含原因、时间戳和可恢复性。

### 7.2 operation token

每个 session 维护递增 token：

1. 启动异步操作时生成 token。
2. 操作完成时比较 token 和 session 状态。
3. token 不是当前活动 token 时，只释放自己持有的资源，不提交结果。
4. dispose 后所有 token 均失效。

这样可以解决连续换色、快速切换镜头、离开页面和资源加载迟到等问题。

### 7.3 典型流程

初始化：

```text
create
  → 检查配置
  → 查询平台能力
  → 加载模型和 manifest
  → 创建 tracker / renderer
  → ready
```

运行：

```text
start
  → camera.start
  → frame
  → tracker.estimate
  → renderer.render
  → framePresented
```

捕获：

```text
capture
  → 等待最近一次 render
  → 校验人脸和参数快照
  → renderer.capture
  → 返回图像 + 参数 + 版本
```

销毁：

```text
dispose
  → 使 token 失效
  → 停止相机回调
  → 释放 tracker
  → 释放 renderer / textures
  → 清理资源引用
  → disposed
```

## 8. 端口接口设计

共享核心通过以下抽象端口工作。

### 8.1 CameraPort

职责：提供统一格式的帧，不负责追踪或渲染。

```text
start(FrameCallback)
stop()
getFormat()
getMirrorState()
```

必须保证 stop 后不再调用回调；若平台无法立即停止，迟到回调必须携带 session token 并被核心丢弃。

### 8.2 TrackerPort

职责：根据帧返回关键点。

```text
initialize(model)
estimate(frame)
reset()
dispose()
```

TrackerPort 不拥有相机，也不直接访问页面或 GPU。

### 8.3 RendererPort

职责：把帧、关键点和妆效层合成为预览或捕获结果。

```text
initialize(target, resources)
render(frame, landmarks, layers)
capture()
resize(width, height)
dispose()
```

渲染器必须报告 backend、shader 版本、最大纹理尺寸和 context loss。

### 8.4 ResourcePort

职责：加载和缓存 manifest、模型、shader、mask 和纹样。

```text
loadManifest(version)
loadModel(id, version)
loadShader(id, version)
loadPattern(id, version)
release(version)
```

资源地址、缓存、重试和下载进度属于平台层。核心只依赖稳定资源 ID 和内容版本。

### 8.5 ClockPort 和 LoggerPort

为可测试性提供单调时钟和日志抽象。核心不能直接依赖系统时间或平台日志 API。

日志禁止写入：

- 原始图片地址
- 访问令牌
- 用户私密内容
- 人脸关键点原始数据

## 9. 微信小程序实现方案

当前唯一平台路径是微信宿主工厂：

```text
微信小程序公开 API
  → 微信相机帧与权限适配
  → 内置 FaceMesh tracker
  → WASM C ABI + 上游 shader WebGL renderer
       或
  → 等价 TypeScript/JavaScript core + WebGL fallback
```

适配层负责相机帧格式、方向和镜像归一化，加载内置 FaceMesh 模型与 shader/纹样资源，管理 WebGL context，并将 `capture()` 导出为临时图片路径。页面隐藏、权限拒绝、无脸、多人脸、资源失败和上下文丢失都必须进入明确状态。

H5 仅可作为开发联调适配器，不能替代微信小程序真机验收。

## 10. 渲染方案

### 10.1 上游六类妆效 renderer

当前无 Three.js WebGL renderer 使用上游 468 点网格和 shader。口红链路为：

1. 追踪器输出嘴唇关键点。
2. 核心生成统一口唇区域参数。
3. 平台渲染器生成 mask 或使用预计算纹理。
4. 根据颜色和强度进行颜色混合。
5. 依据 finish 选择不同 alpha、高光和混合模式。
6. 将结果合成到当前帧。

核心只描述效果参数和 effect graph，不直接编写 WebGL 调用。

### 10.2 颜色和 alpha

所有平台统一：

- 输入颜色为明确的 sRGB ARGB/RGBA
- 混合前转换为渲染器约定的线性或明确 sRGB 路径
- alpha 语义固定为 premultiplied 或 straight alpha，并写入版本协议
- 输出图片方向和镜像状态显式记录

### 10.3 六类妆效验收

每类妆效都必须有：

- 稳定 effect ID
- 关键点或区域定义
- 纹样和 shader 资源
- 颜色与质感参数
- 设备支持能力
- 单元测试和真机样本

服务器合同测试已覆盖六类参数和 renderer 能力报告；真实微信设备仍需逐类记录 shader、帧率、内存和捕获结果。

## 11. 资源与版本管理

### 11.1 Manifest

manifest 建议包含：

```json
{
  "manifestVersion": "2026.10.1",
  "sdkApiVersion": 2,
  "models": [],
  "shaders": [],
  "patterns": [],
  "effects": []
}
```

每个资源记录：

- 稳定 ID
- 内容哈希
- 版本
- 宿主和 renderer backend
- 下载地址或资源键
- 许可信息
- 最小 SDK API 版本

### 11.2 缓存

- 模型、shader、纹样使用 manifest 版本作为缓存命名空间。
- 下载失败不得清除已经成功加载的其他类别。
- 缓存不可用时返回明确的资源错误。
- 资源域名和小程序合法域名在部署配置中固定。
- 私人照片和 SDK 静态资源必须使用不同存储前缀和授权策略。

## 12. 业务接入方案

业务门面继续作为页面唯一入口，不让页面直接调用 C ABI。

建议公开给业务的接口：

```text
create(config)
getCapabilities()
initialize()
start()
apply(category, params)
clear(category)
clearAll()
capture()
stop()
dispose()
```

页面负责：

- 选择妆效和颜色
- 展示状态、错误和资源进度
- 拍摄和按住对比
- 登录后保存当前捕获结果

页面不负责：

- 直接管理平台纹理
- 直接传递模型文件
- 判断底层 GPU context 是否丢失
- 将实时帧上传服务端

保存流程：

```text
capture()
  → 得到当前帧和冻结参数
  → 用户点击保存
  → 按需登录
  → 使用 saveRequestId 上传
  → 服务端按所有者 + 请求 ID 幂等写入
```

拍摄本身不应自动上传，查看历史记录不能覆盖当前编辑状态。

## 13. 构建与交付

### 13.1 本地 C++ 构建

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build --parallel
ctest --test-dir build --output-on-failure
```

建议新增 CMake 选项：

```text
MAKEUP_BUILD_TESTS
MAKEUP_BUILD_EXAMPLES
MAKEUP_BUILD_WASM
```

### 13.2 CI

CI 至少包含：

1. Linux/macOS C++ 编译。
2. ABI 头文件兼容检查。
3. 核心单元测试和 fake port 测试。
4. ASan/UBSan。
5. clang-format 和静态分析。
6. WASM 或 TypeScript binding 构建。
7. manifest 哈希和许可证检查。

真机测试不应伪装成普通 CI 通过项，应保存带设备信息的独立 capability report。

### 13.3 版本策略

- C ABI breaking change 升级 `apiVersion`。
- 资源变化升级 `manifestVersion`。
- 模型变化升级 `modelVersion`。
- renderer 行为变化升级 `rendererVersion`。
- 业务保存记录保存完整版本组合。

## 14. 测试方案

### 14.1 核心单元测试

- 参数范围和类别校验
- 版本不兼容
- 状态迁移
- 重复初始化和重复销毁
- apply/clear/clearAll
- capture 前置条件
- 旧 operation token 失效
- 资源失败后的局部保留

### 14.2 合同测试

对 WASM、TS/JS fallback 和微信宿主工厂使用同一套行为案例：

- 同一参数产生同一归一化结果
- `dewy` 始终映射为 `glossy`
- 不支持类别返回稳定错误
- 前置镜像后的左右方向一致
- 捕获结果携带同一版本和参数快照

### 14.3 微信真机验收

每台设备至少记录：

- 设备型号、系统版本和微信基础库版本
- SDK、WASM、manifest 和模型版本
- renderer backend 和 tracker backend
- 首帧耗时、持续帧率和内存峰值
- 相机权限拒绝恢复
- 无脸和多人脸行为
- WebGL context loss 恢复
- 页面离开后的资源释放

第一验收门槛是微信小程序单类口红闭环，不以 H5、静态图或 mock 结果替代。

## 15. 分阶段实施计划

### 阶段 0：契约冻结

产出：

- API v2 草案
- 六类 effect 枚举
- 质感映射表
- 错误码表
- 坐标和像素协议
- manifest 格式

### 阶段 1：共享核心

产出：

- session 状态机
- operation token
- catalog/manifest
- frame、landmark、capture 数据模型
- fake camera/tracker/renderer/resource ports
- 核心单元测试

### 阶段 2：微信平台能力探针

产出：

- 微信小程序 camera、FaceMesh、WebGL、WASM probe
- 设备能力矩阵
- 模型加载、shader 编译和当前帧导出报告

### 阶段 3：小程序口红闭环

产出：

- WASM、TS/JS 和宿主工厂 binding
- 口红 mask 和颜色混合
- 当前帧捕获
- 资源释放和失败恢复
- 微信真机验收记录

### 阶段 4：业务接入

产出：

- MakeupFacade 接入异步 SDK
- 真实相机和追踪状态
- 当前帧保存
- 私人成图幂等上传
- 失败重试和删除链路

### 阶段 5：效果扩展

按口红验收通过后，依次接入：

1. 腮红
2. 眼影
3. 眼线
4. 睫毛
5. 底妆

每一类独立完成资源、渲染、能力、性能和真机验证。

## 16. 主要风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 小程序无法稳定提供帧或 WebGL | 无法完成实时闭环 | 先做 capability probe；保留同 API 的 TS fallback |
| WASM 性能不足 | 掉帧、发热、内存高 | 核心只保留数据和编排；渲染使用平台 WebGL |
| 模型加载过慢 | 首次进入等待时间长 | manifest 缓存、进度事件和分层加载 |
| WASM、TS/JS 与宿主镜像规则不同 | 左右妆效错位 | 统一归一化坐标并加入绑定合同测试 |
| 资源版本不一致 | 历史成图无法解释 | 保存 SDK、模型、manifest 和纹样版本 |
| 页面离开时资源未释放 | 内存泄漏和摄像头占用 | dispose 幂等、token 失效和平台生命周期测试 |
| 上游算法或资源许可不清晰 | 无法发布 | 固定上游提交、记录许可证和允许复用清单 |

## 17. 完成定义

一个阶段只有同时满足以下条件才算完成：

- 有可运行实现，而不是只有文档或 mock。
- 公共接口和版本已冻结。
- 失败状态和恢复路径可复现。
- 有自动化测试或真机证据。
- 资源、模型和许可证来源明确。
- 另一名开发者可以按文档重新构建和验证。
- 未通过的平台明确标记为 unsupported，不以云端渲染或静态图替代。

本方案的第一交付目标不是一次完成六类妆效，而是建立一条可验证、可释放、可跨端复用的单类口红实时链路。
