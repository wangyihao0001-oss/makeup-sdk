import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const version = process.env.MAKEUP_SDK_VERSION ?? (await readFile(new URL('VERSION', root), 'utf8')).trim();
const commit = process.env.GITHUB_SHA ?? 'local';
const native = JSON.parse(await readFile(new URL('release/native-benchmark.json', root), 'utf8'));
const wasm = JSON.parse(await readFile(new URL('release/wasm-benchmark.json', root), 'utf8'));
const report = {
  schema_version: 1,
  sdk_version: version,
  commit,
  environment: process.env.BENCH_ENVIRONMENT ?? 'aliyun-cloudserver',
  native_core: native,
  wasm_core: wasm,
  device_baselines: []
};
await writeFile(new URL('docs/performance/baseline.json', root), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(new URL('docs/performance/baseline.md', root), [
  '# 性能基线',
  '',
  `服务器环境：${report.environment}，SDK：${version}，commit：${commit}。`,
  '',
  `原生核心：${native.per_iteration_ms} ms/iteration。`,
  '',
  `WASM 加载：${wasm.load_ms} ms；初始化：${wasm.initialize_ms} ms；帧提交：${wasm.frame_submit_per_iteration_ms} ms/iteration；capture：${wasm.capture_ms} ms；产物：${wasm.wasmBytes} bytes。`,
  '',
  '真实微信设备数据待设备型号提供后补录。',
  ''
].join('\n'));
