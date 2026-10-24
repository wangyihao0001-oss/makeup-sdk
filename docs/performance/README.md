# 性能报告

运行服务器基线：

```bash
cmake --build build-native --target makeup_sdk_core_benchmark
build-native/makeup_sdk_core_benchmark
node scripts/benchmark-wasm.mjs
```

报告采用 JSON 保存，字段变化需要同步更新 `baseline.json` 的 schema 版本。
