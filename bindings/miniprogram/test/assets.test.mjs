import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  STATUS,
  assetPathsForCategories,
  createOpenMakeupWebGlRenderer,
  createWechatAssetCache,
  createWechatWasmLoader
} from '../src/index.js';

const manifestUrl = new URL('../dist/openmakeup-assets.manifest.json', import.meta.url);

test('asset manifest keeps one FaceMesh runtime and drops authoring files', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const paths = manifest.files.map((file) => file.path);
  assert.equal(manifest.faceMesh, 'simd');
  assert.equal(paths.some((path) => path.includes('face_mesh_solution_simd_wasm_bin.wasm')), true);
  assert.equal(paths.some((path) => path.includes('face_mesh_solution_wasm_bin')), false);
  assert.equal(paths.some((path) => path.startsWith('blender/') || path.endsWith('uv-checker.png')), false);
  assert.equal(manifest.files.every((file) => typeof file.group === 'string' && file.size > 0), true);
});

test('category asset list includes the active effect and leaves the others out', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const lipstick = assetPathsForCategories(manifest, ['lipstick']);
  assert.equal(lipstick.some((path) => path.startsWith('mediapipe-face-mesh/')), true);
  assert.equal(lipstick.includes('models/face.glb'), true);
  assert.equal(lipstick.includes('shaders/lip/fragment.glsl'), true);
  assert.equal(lipstick.some((path) => path.startsWith('patterns/lipstick/')), true);
  assert.equal(lipstick.some((path) => path.startsWith('patterns/eyeshadow/') || path.startsWith('shaders/eyeshadow/')), false);
});

test('remote assets are stored by checksum and reused', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const store = new Map();
  let downloads = 0;
  const cache = createWechatAssetCache({
    userDataPath: '/usr',
    manifest: { files: [{ path: 'models/face.glb', size: bytes.byteLength, sha256, group: 'model' }] },
    stat: async (path) => {
      if (!store.has(path)) throw new Error('missing');
      return store.get(path).byteLength;
    },
    writeFile: async (path, data) => { store.set(path, data); },
    mkdir: async () => {}
  });
  const load = createWechatWasmLoader({
    cache,
    baseUrl: 'https://cdn.example.com/assets',
    readFile: async (path) => ({ data: store.get(path) }),
    downloadFile: async () => {
      downloads += 1;
      return { statusCode: 200, data: bytes };
    }
  });
  const first = await load({ url: 'https://cdn.example.com/assets/models/face.glb' });
  const second = await load({ url: 'https://cdn.example.com/assets/models/face.glb' });
  assert.equal(downloads, 1);
  assert.equal(first.byteLength ?? first.length, 4);
  assert.equal(second.byteLength ?? second.length, 4);
  assert.equal(store.size, 1);
});

test('a checksum mismatch is not cached', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const store = new Map();
  const cache = createWechatAssetCache({
    userDataPath: '/usr',
    manifest: { files: [{ path: 'models/face.glb', size: 4, sha256, group: 'model' }] },
    stat: async () => { throw new Error('missing'); },
    writeFile: async (path, data) => { store.set(path, data); },
    mkdir: async () => {}
  });
  const load = createWechatWasmLoader({
    cache,
    baseUrl: 'https://cdn.example.com/assets',
    downloadFile: async () => ({ statusCode: 200, data: new Uint8Array([9, 9, 9, 9]) })
  });
  await assert.rejects(
    () => load({ url: 'https://cdn.example.com/assets/models/face.glb' }),
    (error) => error.status === STATUS.ASSET_LOAD_FAILED
  );
  assert.equal(store.size, 0);
});

function fakeGl() {
  const constants = {
    VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632, COMPILE_STATUS: 35713, LINK_STATUS: 35714,
    BLEND: 3042, SRC_ALPHA: 770, ONE_MINUS_SRC_ALPHA: 771, ONE: 1, ARRAY_BUFFER: 34962,
    ELEMENT_ARRAY_BUFFER: 34963, STATIC_DRAW: 35044, DYNAMIC_DRAW: 35048, COLOR_BUFFER_BIT: 16384,
    TEXTURE_2D: 3553, TEXTURE0: 33984, TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240,
    TEXTURE_WRAP_S: 10242, TEXTURE_WRAP_T: 10243, LINEAR: 9729, CLAMP_TO_EDGE: 33071, RGBA: 6408,
    UNSIGNED_BYTE: 5121, UNSIGNED_SHORT: 5123, TRIANGLES: 4, FLOAT: 5126, TRIANGLE_STRIP: 5
  };
  return new Proxy(constants, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return () => {
        if (prop === 'createShader' || prop === 'createProgram' || prop === 'createTexture' || prop === 'createBuffer') return { id: String(prop) };
        if (prop === 'getShaderParameter' || prop === 'getProgramParameter') return true;
        if (prop === 'getAttribLocation') return 0;
        if (prop === 'getUniformLocation') return { name: String(prop) };
        if (prop === 'getParameter') return 16;
        return undefined;
      };
    }
  });
}

test('renderer loads shaders for the drawn category only', async () => {
  const loaded = [];
  const glb = await readFile(new URL('../assets/models/face.glb', import.meta.url));
  const renderer = createOpenMakeupWebGlRenderer({
    gl: fakeGl(),
    canvas: { width: 4, height: 4 },
    loadModel: async () => glb,
    loadAsset: async (path) => {
      loaded.push(path);
      return readFile(new URL(`../assets/${path}`, import.meta.url));
    },
    loadTexture: async (path) => {
      loaded.push(path);
      return {};
    },
    supportedEffects: ['lipstick', 'eyeshadow']
  });
  await renderer.initialize();
  assert.deepEqual(loaded, []);
  const points = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  await renderer.render(
    { width: 2, height: 2, data: new Uint8Array(16), timestampNs: 1n },
    { landmarks: { points } },
    { lipstick: { argb: 0xff336699, intensity: 1, finish: 'matte', patternId: null } }
  );
  assert.equal(loaded.includes('shaders/lip/vertex.glsl'), true);
  assert.equal(loaded.includes('shaders/lip/fragment.glsl'), true);
  assert.equal(loaded.some((path) => path.includes('eyeshadow')), false);
});
