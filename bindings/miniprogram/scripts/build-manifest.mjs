import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const [, , wasmPath, manifestPath] = process.argv;
if (!wasmPath || !manifestPath) {
  throw new Error('Usage: node build-manifest.mjs <wasm> <manifest>');
}

const bytes = await readFile(wasmPath);
const sdkVersion = process.env.MAKEUP_SDK_VERSION ?? '0.1.0';
const manifestVersion = Number(process.env.MAKEUP_MANIFEST_VERSION ?? '1');
const wasmVersion = process.env.MAKEUP_WASM_VERSION ?? `${sdkVersion}-wasm1`;
const exports = [
  'mk2_wasm_api_version',
  'mk2_wasm_create',
  'mk2_wasm_destroy',
  'mk2_wasm_bind_capabilities',
  'mk2_wasm_initialize',
  'mk2_wasm_start',
  'mk2_wasm_stop',
  'mk2_wasm_dispose',
  'mk2_wasm_apply',
  'mk2_wasm_clear',
  'mk2_wasm_clear_all',
  'mk2_wasm_submit_frame',
  'mk2_wasm_capture',
  'mk2_wasm_pump',
  'mk2_wasm_poll_event',
  'mk2_wasm_get_state',
  'mk2_wasm_get_capabilities',
  'mk2_wasm_get_layer',
  'mk2_wasm_alloc',
  'mk2_wasm_free'
];

const manifest = {
  sdkVersion,
  apiVersion: 2,
  wasmVersion,
  manifestVersion,
  artifact: 'makeup_sdk_core.wasm',
  size: bytes.byteLength,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  exports
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
