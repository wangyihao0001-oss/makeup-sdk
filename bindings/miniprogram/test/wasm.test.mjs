import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EFFECT,
  FINISH,
  STATUS,
  create,
  WasmLoadError
} from '../src/index.js';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, '..', 'dist');
const wasmPath = join(dist, 'makeup_sdk_core.wasm');
const manifestPath = join(dist, 'manifest.json');
const hasArtifact = existsSync(wasmPath) && existsSync(manifestPath);

function ports() {
  let cameraCallback;
  const camera = {
    async start(callback) { cameraCallback = callback; return STATUS.OK; },
    async stop() { cameraCallback = undefined; return STATUS.OK; },
    emit(frame) { return cameraCallback?.(frame); }
  };
  const tracker = {
    async initialize() { return STATUS.OK; },
    async estimate(frame) {
      return { timestampNs: frame.timestampNs, faceCount: 1, confidence: 0.99,
        landmarks: { lips: [{ x: 0.35, y: 0.45 }, { x: 0.65, y: 0.45 }, { x: 0.5, y: 0.58 }] } };
    },
    async reset() { return STATUS.OK; },
    async dispose() { return STATUS.OK; }
  };
  const renderer = {
    async initialize() { return STATUS.OK; },
    async render() { return STATUS.OK; },
    async capture() { return { path: '/tmp/wasm-makeup.png' }; },
    async dispose() { return STATUS.OK; }
  };
  const resources = {
    async loadManifest() { return STATUS.OK; },
    async loadPattern() { return STATUS.OK; },
    async release() { return STATUS.OK; }
  };
  return { camera, tracker, renderer, resources };
}

const frame = {
  timestampNs: 42,
  width: 1,
  height: 1,
  pixelFormat: 'RGBA8',
  orientation: 90,
  mirrored: true,
  data: new Uint8Array([0, 0, 0, 255])
};

test('loads the generated WASM artifact and runs the binding lifecycle', { skip: !hasArtifact }, async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const p = ports();
  const sdk = await create({
    runtime: 'wasm',
    ...p,
    wasmUrl: wasmPath,
    wasmManifest: manifest,
    wasmLoader: async () => readFile(wasmPath)
  });
  assert.equal(sdk.getCapabilities().runtime, 'wasm');
  assert.equal(sdk.getCapabilities().wasmLoadStatus, 'loaded');
  const capabilities = await sdk.initialize();
  assert.equal(capabilities.supportsEffects.lipstick, true);
  await sdk.start();
  await p.camera.emit(frame);
  await sdk.apply({ category: EFFECT.LIPSTICK, finish: FINISH.GLOSSY,
    patternId: 1001, argb: 0xffc2185b, intensity: 0.8 });
  const capture = await sdk.capture();
  assert.equal(capture.path, '/tmp/wasm-makeup.png');
  assert.equal(capture.metadata.orientation, 90);
  await sdk.dispose();
});

test('auto mode falls back when the WASM hash is invalid', { skip: !hasArtifact }, async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const p = ports();
  const sdk = await create({
    runtime: 'auto',
    ...p,
    wasmUrl: wasmPath,
    wasmManifest: manifest,
    wasmSha256: '0'.repeat(64),
    wasmLoader: async () => readFile(wasmPath)
  });
  assert.equal(sdk.getCapabilities().runtime, 'ts-js');
  assert.equal(sdk.getCapabilities().wasmLoadStatus, 'failed');
  assert.match(sdk.getCapabilities().knownLimitations.join(' '), /hash/i);
  await sdk.dispose();
});

test('forced WASM mode rejects a missing export', { skip: !hasArtifact }, async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.exports = [...manifest.exports, 'mk2_wasm_missing_export'];
  await assert.rejects(() => create({
    runtime: 'wasm',
    wasmUrl: wasmPath,
    wasmManifest: manifest,
    wasmLoader: async () => readFile(wasmPath)
  }), (error) => error instanceof WasmLoadError && error.code === 'WASM_EXPORT_MISSING');
});
