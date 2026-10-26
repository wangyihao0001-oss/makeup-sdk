import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  EFFECT,
  FINISH,
  STATUS,
  STATE,
  SdkError,
  create,
  OpenMakeupCompat,
  normalizeFinish,
  normalizeFaceMeshResult,
  normalizeWechatFrame,
  parseOpenMakeupFaceGlb,
  runMiniProgramProbe
} from '../src/index.js';

function ports() {
  let cameraCallback;
  let rendered = false;
  let disposed = false;
  const camera = {
    async start(callback) { cameraCallback = callback; return STATUS.OK; },
    async stop() { cameraCallback = undefined; return STATUS.OK; },
    emit(frame) { return cameraCallback?.(frame); },
    probe() { return true; }
  };
  const tracker = {
    async initialize() { return STATUS.OK; },
    async estimate(frame) {
      return { timestampNs: frame.timestampNs, faceCount: 1, confidence: 0.99,
        landmarks: { lips: [{ x: 0.35, y: 0.45 }, { x: 0.65, y: 0.45 }, { x: 0.5, y: 0.58 }] } };
    },
    async reset() { return STATUS.OK; },
    async dispose() { disposed = true; return STATUS.OK; },
    probe() { return true; }
  };
  const renderer = {
    async initialize() { return STATUS.OK; },
    async render() { rendered = true; return STATUS.OK; },
    async capture() { return { path: '/tmp/makeup.png' }; },
    async dispose() { return STATUS.OK; },
    probe() { return true; },
    captureProbe() { return true; },
    get rendered() { return rendered; }
  };
  const resources = {
    async loadManifest() { return STATUS.OK; },
    async loadPattern() { return STATUS.OK; },
    async release() { return STATUS.OK; },
    probe() { return true; }
  };
  return { camera, tracker, renderer, resources, get disposed() { return disposed; } };
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

test('normalizes product finish and runs lipstick fallback lifecycle', async () => {
  assert.equal(normalizeFinish('dewy'), FINISH.GLOSSY);
  const p = ports();
  const sdk = await create({ runtime: 'ts-js', ...p, manifestVersion: 7 });
  const capabilities = await sdk.initialize();
  assert.equal(capabilities.runtime, 'ts-js');
  assert.equal(capabilities.supportsEffects.lipstick, true);
  await sdk.start();
  await p.camera.emit(frame);
  assert.equal(p.renderer.rendered, true);
  const applied = await sdk.apply({ category: EFFECT.LIPSTICK, finish: 'dewy', patternId: 1001,
    argb: 0xffc2185b, intensity: 0.85 });
  assert.equal(applied.params.finish, FINISH.GLOSSY);
  const capture = await sdk.capture();
  assert.equal(capture.path, '/tmp/makeup.png');
  assert.equal(capture.metadata.orientation, 90);
  await sdk.dispose();
  assert.equal(sdk.core.state, STATE.DISPOSED);
  assert.equal(p.disposed, true);
});

test('no face prevents a valid capture', async () => {
  const p = ports();
  p.tracker.estimate = async () => ({ timestampNs: 42, faceCount: 0, confidence: 0 });
  const sdk = await create({ runtime: 'ts-js', ...p });
  await sdk.initialize();
  await sdk.start();
  const errors = [];
  sdk.on('error', (error) => errors.push(error));
  await p.camera.emit(frame);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(errors[0].status, STATUS.NO_FACE);
  await assert.rejects(() => sdk.capture(), (error) => error.status === STATUS.NO_FRAME);
  await sdk.dispose();
});

test('probe only marks lipstick supported when every check passes', async () => {
  const p = ports();
  const report = await runMiniProgramProbe({ runtime: 'ts-js', ...p,
    device: { model: 'fake', system: 'test', baseLibrary: '3.0.0' } });
  assert.equal(report.platform, 'wechat-miniprogram');
  assert.equal(report.lipstickSupported, true);
  assert.equal(report.checks.every((check) => check.ok), true);
});

test('auto mode records WASM failure and keeps TS/JS fallback usable', async () => {
  const p = ports();
  const sdk = await create({ runtime: 'auto', ...p,
    wasmFactory: async () => { throw new Error('unsupported wasm import'); } });
  assert.equal(sdk.getCapabilities().runtime, 'ts-js');
  assert.match(sdk.getCapabilities().knownLimitations.join(' '), /WASM initialization failed/);
  await sdk.initialize();
  await sdk.dispose();
});

test('unsupported effect is rejected before resources are changed', async () => {
  const p = ports();
  const sdk = await create({ runtime: 'ts-js', ...p });
  await sdk.initialize();
  await assert.rejects(() => sdk.apply({ category: EFFECT.BLUSH, finish: FINISH.MATTE,
    patternId: 1001, argb: 0, intensity: 1 }), (error) => error instanceof SdkError &&
    error.status === STATUS.UNSUPPORTED_EFFECT);
  await sdk.dispose();
});

test('unified onEvent and flat capture metadata preserve legacy listeners', async () => {
  const p = ports();
  const sdk = await create({ runtime: 'ts-js', ...p });
  const events = [];
  const unsubscribe = sdk.onEvent((event) => events.push(event));
  await sdk.initialize();
  await sdk.start();
  await p.camera.emit(frame);
  const capture = await sdk.capture();
  assert.equal(capture.orientation, 90);
  assert.equal(capture.metadata.orientation, 90);
  assert.equal(events.some((event) => event.type === 'stateChanged'), true);
  assert.equal(events.some((event) => event.type === 'trackingStatus'), true);
  unsubscribe();
  await sdk.dispose();
});

test('imports the upstream catalog and exposes pattern and morph compatibility', async () => {
  const p = ports();
  const sdk = await create({ runtime: 'ts-js', ...p });
  const lipstick = sdk.getPatterns(EFFECT.LIPSTICK);
  const eyeshadow = sdk.getPatterns(EFFECT.EYESHADOW);
  assert.equal(lipstick.length, 3);
  assert.equal(eyeshadow.length, 49);
  assert.equal(lipstick[0].id, 6427);
  assert.deepEqual(sdk.setMorph('noseSlim', 0.6), { name: 'noseSlim', value: 0.6 });
  assert.ok(sdk.getMorphTargets().includes('jawWide'));
  sdk.morph({ cheeks: 0.2 });
  sdk.resetMorph();
  await sdk.dispose();
});

test('normalizes WeChat frame aliases before the core validator', () => {
  const normalized = normalizeWechatFrame({
    timestamp: 12,
    frameWidth: 2,
    frameHeight: 1,
    format: 'RGBA8',
    rotation: 450,
    isMirror: true,
    data: new Uint8Array(8)
  });
  assert.equal(normalized.timestampNs, 12000000n);
  assert.equal(normalized.width, 2);
  assert.equal(normalized.orientation, 90);
  assert.equal(normalized.mirrored, true);
});

test('normalizes MediaPipe-style results to the tracker contract', () => {
  const points = Array.from({ length: 468 }, (_, index) => ({ x: index / 468, y: 0.5, z: 0 }));
  const tracking = normalizeFaceMeshResult({ multiFaceLandmarks: [points] }, frame);
  assert.equal(tracking.faceCount, 1);
  assert.equal(tracking.timestampNs, 42n);
  assert.equal(tracking.landmarks.points.length, 468);
  assert.equal(tracking.landmarks.lips.length, 20);
});

test('enables the full upstream category set when the renderer advertises it', async () => {
  const p = ports();
  p.renderer.supportedEffects = Object.values(EFFECT);
  const sdk = await create({ runtime: 'ts-js', ...p });
  const report = await sdk.initialize();
  for (const category of Object.values(EFFECT)) {
    assert.equal(report.supportsEffects[category], true);
    const pattern = sdk.getPatterns(category)[0];
    await sdk.apply({ category, patternId: pattern?.id ?? null, argb: 0xff336699, intensity: 0.7,
      finish: category === EFFECT.EYELINER || category === EFFECT.MASCARA ? null : FINISH.MATTE });
  }
  assert.equal(sdk.core.layers.size, 6);
  await sdk.dispose();
});

test('keeps the upstream OpenMakeup API shape as a compatibility facade', async () => {
  const p = ports();
  p.renderer.supportedEffects = Object.values(EFFECT);
  const sdk = await OpenMakeupCompat.create({ runtime: 'ts-js', ...p });
  await sdk.init();
  const result = await sdk.apply('lipstick', { color: '#b4002e', pattern: 1, finish: FINISH.GLOSSY });
  assert.deepEqual(result, { category: 'lipstick', color: '#b4002e', finish: FINISH.GLOSSY, pattern: 6427 });
  assert.equal(sdk.categories.includes('eyeline'), true);
  await sdk.dispose();
});

test('parses the upstream 468-point face mesh and morph targets without Three.js', async () => {
  const glb = await readFile(new URL('../assets/models/face.glb', import.meta.url));
  const model = parseOpenMakeupFaceGlb(glb);
  assert.equal(model.positions.length / 3, 468);
  assert.equal(model.normals.length / 3, 468);
  assert.equal(model.indices.length, 2694);
  assert.equal(model.morphs.length, 12);
  assert.equal(model.morphNames[0], 'facemesh9');
  assert.equal(model.uvLip.length / 2, 468);
});
