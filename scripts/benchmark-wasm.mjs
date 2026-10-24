import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { join } from 'node:path';
import { loadWasmCore } from '../bindings/miniprogram/src/wasm-loader.js';

const root = new URL('../', import.meta.url);
const wasmPath = new URL('bindings/miniprogram/dist/makeup_sdk_core.wasm', root);
const manifestPath = new URL('bindings/miniprogram/dist/manifest.json', root);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const bytes = await readFile(wasmPath);
const iterations = Number(process.env.BENCH_ITERATIONS ?? 1000);

const loadStart = performance.now();
const core = await loadWasmCore({
  wasmUrl: wasmPath.pathname,
  wasmManifest: manifest,
  wasmLoader: async () => bytes
});
const loadMs = performance.now() - loadStart;
core.configureCapabilities({
  cameraAvailable: true,
  trackerAvailable: true,
  rendererAvailable: true,
  supportsEffects: { lipstick: true }
});

const initializeStart = performance.now();
core.initialize();
core.start();
const initializeMs = performance.now() - initializeStart;
const pixels = new Uint8Array([0, 0, 0, 255]);
const frame = {
  timestampNs: 0,
  width: 1,
  height: 1,
  pixelFormat: 'RGBA8',
  orientation: 0,
  mirrored: false,
  data: pixels
};
const tracking = { timestampNs: 0, faceCount: 1, confidence: 0.99 };

const frameStart = performance.now();
for (let index = 0; index < iterations; index += 1) {
  frame.timestampNs = index;
  tracking.timestampNs = index;
  core.submitFrame(frame, tracking);
}
const frameMs = performance.now() - frameStart;

const captureStart = performance.now();
core.capture();
const captureMs = performance.now() - captureStart;
core.dispose();

console.log(JSON.stringify({
  iterations,
  wasmBytes: bytes.byteLength,
  load_ms: Number(loadMs.toFixed(6)),
  initialize_ms: Number(initializeMs.toFixed(6)),
  frame_submit_total_ms: Number(frameMs.toFixed(6)),
  frame_submit_per_iteration_ms: Number((frameMs / iterations).toFixed(6)),
  capture_ms: Number(captureMs.toFixed(6))
}, null, 2));
