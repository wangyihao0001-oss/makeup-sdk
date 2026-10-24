# Release 流程

正式发布使用 `vX.Y.Z` tag。CI 先构建并验证 Android AAR、iOS XCFramework、WASM 和 npm 包，再生成 `SHA256SUMS`、兼容性清单和性能报告，最后创建 GitHub Release。

第一阶段不自动发布到 npm/Maven registry；npm/Maven 元数据和本地包已准备好，后续可独立增加发布 job。

发布前必须确认：

- 所有产物版本一致；
- SHA256 校验通过；
- WASM manifest 与二进制一致；
- AAR 包含声明的 ABI；
- XCFramework 同时包含真机和 Simulator slice；
- 设备兼容性和性能报告没有把 `pending` 当作通过。

回滚通过重新指向上一个 GitHub Release，并保留历史 artifact 与 checksum；不覆盖已发布的版本号。
