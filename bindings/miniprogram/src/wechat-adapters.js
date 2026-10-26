import { STATUS, SdkError, create } from './makeup-sdk.js';
import { EFFECT } from './constants.js';
import { resolveUpstreamPattern } from './upstream-catalog.js';
import { createWebGlMakeupRenderer } from './webgl-renderer.js';

function frameBytes(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

function clampByte(value) { return Math.max(0, Math.min(255, Math.round(value))); }

function rgb24ToRgba(bytes, width, height) {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += 3) {
    out[i * 4] = bytes[j]; out[i * 4 + 1] = bytes[j + 1]; out[i * 4 + 2] = bytes[j + 2]; out[i * 4 + 3] = 255;
  }
  return out;
}

function yuv420ToRgba(bytes, width, height, format) {
  const pixels = width * height;
  const out = new Uint8Array(pixels * 4);
  const chromaWidth = Math.ceil(width / 2);
  const chromaHeight = Math.ceil(height / 2);
  const chromaSize = chromaWidth * chromaHeight;
  const nv = format === 'NV12' || format === 'NV21';
  const ySize = pixels;
  const uOffset = nv ? ySize : ySize;
  const vOffset = nv ? ySize : ySize + chromaSize;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const yi = y * width + x;
      let u; let v;
      if (nv) {
        const ci = (Math.floor(y / 2) * chromaWidth + Math.floor(x / 2)) * 2;
        const first = bytes[uOffset + ci] ?? 128;
        const second = bytes[uOffset + ci + 1] ?? 128;
        u = format === 'NV12' ? first : second;
        v = format === 'NV12' ? second : first;
      } else {
        const ci = Math.floor(y / 2) * chromaWidth + Math.floor(x / 2);
        u = bytes[uOffset + ci] ?? 128;
        v = bytes[vOffset + ci] ?? 128;
      }
      const yy = Math.max(0, bytes[yi] - 16);
      const c = 1.164 * yy;
      const o = yi * 4;
      out[o] = clampByte(c + 1.596 * (v - 128));
      out[o + 1] = clampByte(c - 0.392 * (u - 128) - 0.813 * (v - 128));
      out[o + 2] = clampByte(c + 2.017 * (u - 128));
      out[o + 3] = 255;
    }
  }
  return out;
}

export function normalizeWechatFrame(raw = {}) {
  const data = raw.data ?? raw.bytes ?? raw.pixelData;
  const width = Number(raw.width ?? raw.frameWidth ?? 0);
  const height = Number(raw.height ?? raw.frameHeight ?? 0);
  const orientation = Number(raw.orientation ?? raw.rotation ?? raw.rotate ?? 0);
  const timestampNs = raw.timestampNs ?? (raw.timestamp != null ? BigInt(raw.timestamp) * 1000000n : 0n);
  const mirrored = Boolean(raw.mirrored ?? raw.isMirror ?? raw.mirror);
  const declaredFormat = String(raw.pixelFormat ?? raw.format ?? 'RGBA8').toUpperCase();
  let pixelFormat = declaredFormat;
  let normalizedData = data;
  const bytes = frameBytes(data);
  if (bytes && (declaredFormat === 'RGB' || declaredFormat === 'RGB24')) {
    normalizedData = rgb24ToRgba(bytes, width, height); pixelFormat = 'RGBA8';
  } else if (bytes && ['I420', 'YUV420', 'NV12', 'NV21', 'YUV'].includes(declaredFormat)) {
    normalizedData = yuv420ToRgba(bytes, width, height, declaredFormat === 'YUV' ? 'NV12' : declaredFormat); pixelFormat = 'RGBA8';
  } else if (declaredFormat === 'RGB8') {
    if (!bytes || bytes.byteLength !== width * height * 3) throw new SdkError(STATUS.FRAME_INVALID, 'RGB8 frame data size does not match dimensions');
    normalizedData = rgb24ToRgba(bytes, width, height); pixelFormat = 'RGBA8';
  }
  if (!data || !Number.isInteger(width) || !Number.isInteger(height)) {
    throw new SdkError(STATUS.FRAME_INVALID, 'WeChat frame width, height and data are required');
  }
  return {
    timestampNs: BigInt(timestampNs),
    width,
    height,
    pixelFormat: pixelFormat === 'BGRA' ? 'BGRA8' : pixelFormat,
    orientation: ((orientation % 360) + 360) % 360,
    mirrored,
    data: normalizedData
  };
}

/*
 * These adapters deliberately receive host callbacks instead of reading wx or
 * canvas globals at module evaluation time. A real mini-program page supplies
 * the callbacks from its camera component, FaceMesh runtime and download API.
 */
export function createWechatCameraPort({ subscribe, unsubscribe }) {
  let active = false;
  let stopSubscription;
  return {
    async start(onFrame) {
      if (active) return STATUS.INVALID_STATE;
      if (typeof subscribe !== 'function') {
        throw new SdkError(STATUS.CAMERA_PERMISSION_DENIED, 'Camera subscription is unavailable');
      }
      try {
        stopSubscription = await subscribe((rawFrame) => onFrame(normalizeWechatFrame(rawFrame)));
        active = true;
        return STATUS.OK;
      } catch (error) {
        throw new SdkError(STATUS.CAMERA_PERMISSION_DENIED,
          String(error?.message ?? error), error);
      }
    },
    async stop() {
      if (!active) return STATUS.OK;
      if (typeof stopSubscription === 'function') await stopSubscription();
      if (typeof unsubscribe === 'function') await unsubscribe();
      stopSubscription = undefined;
      active = false;
      return STATUS.OK;
    },
    probe() { return typeof subscribe === 'function'; }
  };
}

/**
 * Resource adapter for the vendored OpenMakeupSDK asset layout. The host may
 * provide either a local-file reader or a download callback; no wx global is
 * accessed by this module.
 */
export function createWechatOpenMakeupResourcePort({ readFile, downloadFile, baseUrl = '' } = {}) {
  const load = createWechatWasmLoader({ readFile, downloadFile });
  const resolve = (path) => `${String(baseUrl).replace(/\/$/, '')}/${String(path).replace(/^\//, '')}`;
  let manifest;
  return {
    async loadManifest() {
      const bytes = await load({ url: resolve('patterns/patterns.json') });
      const text = typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
      manifest = JSON.parse(text);
      return STATUS.OK;
    },
    async loadPattern(patternId, version) {
      if (!manifest) throw new SdkError(STATUS.ASSET_LOAD_FAILED, 'Pattern manifest must be loaded first');
      const categories = Object.values(manifest.categories ?? {});
      const entry = categories.flat().find((pattern) => String(pattern.id) === String(patternId));
      if (!entry) throw new SdkError(STATUS.ASSET_LOAD_FAILED, `Pattern ${patternId} is not present in manifest ${version}`);
      await load({ url: resolve(entry.file) });
      return STATUS.OK;
    },
    async release() { manifest = undefined; return STATUS.OK; },
    probe() { return typeof readFile === 'function' || typeof downloadFile === 'function'; },
    async loadAsset(path) { return load({ url: resolve(path) }); },
    getManifest() { return manifest; },
    resolve
  };
}

/**
 * Asset callback for the upstream renderer. It follows the same local-file /
 * remote-download rules as the WASM loader, but is exposed separately so a
 * page can feed binary GLB/GLSL data to createOpenMakeupWebGlRenderer without
 * coupling the renderer to wx globals.
 */
export function createWechatOpenMakeupAssetLoader({ readFile, downloadFile, baseUrl = '' } = {}) {
  const load = createWechatWasmLoader({ readFile, downloadFile });
  const resolve = (path) => `${String(baseUrl).replace(/\/$/, '')}/${String(path).replace(/^\//, '')}`;
  return async (path) => load({ url: resolve(path) });
}

/**
 * Image callback for WebGL texture uploads. `createImage` should be the
 * canvas/host image factory (for example `canvas.createImage`). `resolveImage`
 * may turn a packaged or downloaded path into the local path accepted by the
 * image object. This keeps all WeChat-specific image lifecycle details out of
 * the renderer.
 */
export function createWechatOpenMakeupTextureLoader({ createImage, resolveImage, baseUrl = '' } = {}) {
  const resolve = (path) => `${String(baseUrl).replace(/\/$/, '')}/${String(path).replace(/^\//, '')}`;
  return async (path) => {
    if (typeof createImage !== 'function') throw new SdkError(STATUS.ASSET_LOAD_FAILED, 'A WeChat image factory is required for shader textures');
    const image = await createImage();
    const source = typeof resolveImage === 'function' ? await resolveImage(resolve(path)) : resolve(path);
    return new Promise((resolveResult, reject) => {
      image.onload = () => resolveResult(image);
      image.onerror = (error) => reject(new SdkError(STATUS.ASSET_LOAD_FAILED, `Texture load failed: ${path}`, error));
      image.src = source;
    });
  };
}

/**
 * One-call WeChat host factory. The only runtime-specific callback that
 * cannot be inferred safely is FaceMesh itself: callers provide either
 * `faceMeshFactory`/`faceMeshEstimate` or an already-created tracker. All
 * camera, filesystem, texture, WebGL and SDK ports are wired here.
 */
export async function createWechatMakeupSdk({
  wx: wxApi,
  canvas,
  gl,
  cameraContext,
  faceMesh,
  faceMeshFactory,
  faceMeshEstimate,
  faceMeshReset,
  faceMeshDispose,
  faceMeshClass,
  faceMeshScriptLoader,
  faceMeshCanvasFactory,
  faceMeshOptions = {},
  assetsBaseUrl = '',
  wasmUrl,
  wasmManifestUrl,
  wasmManifest,
  createImage,
  resolveImage,
  loadPatternTexture,
  ...config
} = {}) {
  const wxObject = wxApi;
  const fs = wxObject?.getFileSystemManager?.();
  const readFile = fs?.readFile ? (filePath) => new Promise((resolve, reject) => fs.readFile({ filePath, success: resolve, fail: reject })) : undefined;
  const downloadFile = wxObject?.downloadFile ? (url) => new Promise((resolve, reject) => wxObject.downloadFile({ url, success: resolve, fail: reject })) : undefined;
  const resources = createWechatOpenMakeupResourcePort({ readFile, downloadFile, baseUrl: assetsBaseUrl });
  const camera = cameraContext || wxObject?.createCameraContext?.();
  const cameraPort = createWechatCameraPort({
    subscribe: async (onFrame) => {
      if (!camera?.onCameraFrame) throw new SdkError(STATUS.CAMERA_PERMISSION_DENIED, 'wx.createCameraContext().onCameraFrame is unavailable');
      const listener = camera.onCameraFrame((event) => onFrame(event?.frame ?? event));
      listener?.start?.();
      return async () => listener?.stop?.();
    }
  });
  const tracker = faceMesh || (faceMeshFactory || faceMeshEstimate
    ? createWechatFaceMeshTracker({ create: faceMeshFactory, estimate: faceMeshEstimate, reset: faceMeshReset, dispose: faceMeshDispose, options: faceMeshOptions })
    : createWechatBundledFaceMeshTracker({ faceMeshClass, loadScript: faceMeshScriptLoader, canvasFactory: faceMeshCanvasFactory, options: faceMeshOptions }));
  const textureLoader = createWechatOpenMakeupTextureLoader({
    createImage: createImage ?? (() => canvas?.createImage?.()),
    resolveImage,
    baseUrl: assetsBaseUrl
  });
  const renderer = gl ? createWebGlMakeupRenderer({
    gl,
    canvas,
    loadAsset: resources.loadAsset,
    loadTexture: textureLoader,
    loadPatternTexture: loadPatternTexture ?? (async ({ category, patternId }) => {
      const entry = resolveUpstreamPattern(category, patternId);
      return entry ? textureLoader(entry.file) : null;
    }),
    canvasToTempFilePath: config.canvasToTempFilePath,
    supportedEffects: Object.values(EFFECT)
  }) : config.renderer;
  return create({
    ...config,
    camera: config.camera ?? cameraPort,
    tracker: config.tracker ?? tracker,
    renderer: config.renderer ?? renderer,
    resources: config.resources ?? resources,
    resourceBaseUrl: assetsBaseUrl,
    wasmUrl: wasmUrl ?? config.wasmUrl,
    wasmManifestUrl: wasmManifestUrl ?? config.wasmManifestUrl,
    wasmManifest: wasmManifest ?? config.wasmManifest
  });
}

export function createWechatTrackerPort({ initialize, estimate, reset, dispose, probe }) {
  return {
    initialize: async (version) => initialize?.(version) ?? STATUS.TRACKER_UNAVAILABLE,
    estimate: async (frame) => estimate?.(frame) ?? Promise.reject(
      new SdkError(STATUS.TRACKER_UNAVAILABLE, 'Tracker estimator is unavailable')),
    reset: async () => reset?.() ?? STATUS.OK,
    dispose: async () => dispose?.() ?? STATUS.OK,
    probe: () => probe?.() ?? typeof estimate === 'function'
  };
}

const LIP_INDICES = Object.freeze([61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185]);

export function normalizeFaceMeshResult(results, frame) {
  const faces = results?.multiFaceLandmarks ?? results?.faces ?? [];
  const points = faces[0] ?? [];
  return {
    timestampNs: frame?.timestampNs == null ? 0n : BigInt(frame.timestampNs),
    faceCount: faces.length,
    confidence: Number(results?.faceConfidence ?? results?.confidence ?? 1),
    landmarks: {
      points,
      lips: LIP_INDICES.map((index) => points[index]).filter(Boolean)
    }
  };
}

/**
 * Adapter for a FaceMesh runtime hosted by the mini-program page or worker.
 * `create` returns the runtime object; `estimate` may be supplied when the
 * runtime cannot consume a normalized frame directly.
 */
export function createWechatFaceMeshTracker({ create, estimate, reset, dispose, options = {}, probe } = {}) {
  let runtime;
  return {
    async initialize(version) {
      if (typeof create !== 'function' && typeof estimate !== 'function') {
        throw new SdkError(STATUS.TRACKER_UNAVAILABLE, 'A FaceMesh create or estimate callback is required');
      }
      runtime = typeof create === 'function' ? await create({ version, options }) : null;
      if (runtime?.setOptions) await runtime.setOptions(options);
      return STATUS.OK;
    },
    async estimateFrame(frame) {
      const result = typeof estimate === 'function'
        ? await estimate(frame, runtime)
        : await runtime?.estimate?.(frame);
      if (!result) throw new SdkError(STATUS.TRACKER_UNAVAILABLE, 'FaceMesh returned no result');
      return normalizeFaceMeshResult(result, frame);
    },
    async estimate(frame) { return this.estimateFrame(frame); },
    async reset() { if (reset) await reset(runtime); return STATUS.OK; },
    async dispose() { if (dispose) await dispose(runtime); else await runtime?.close?.(); runtime = undefined; return STATUS.OK; },
    probe() { return probe?.() ?? Boolean(create || estimate); }
  };
}

/** Default tracker backed by the bundled MediaPipe FaceMesh assets. */
export function createWechatBundledFaceMeshTracker({ faceMeshClass, loadScript, locateFile, canvasFactory, options = {} } = {}) {
  let loadedClass = faceMeshClass;
  const create = async () => {
    if (!loadedClass && typeof globalThis !== 'undefined') loadedClass = globalThis.FaceMesh;
    if (!loadedClass && typeof loadScript === 'function') {
      const loaded = await loadScript({
        script: 'assets/mediapipe-face-mesh/face_mesh.js',
        locateFile: locateFile ?? ((file) => `assets/mediapipe-face-mesh/${file}`)
      });
      loadedClass = loaded?.FaceMesh ?? loaded ?? (typeof globalThis !== 'undefined' ? globalThis.FaceMesh : undefined);
    }
    if (typeof loadedClass !== 'function') throw new SdkError(STATUS.TRACKER_UNAVAILABLE, 'Bundled FaceMesh is not loaded; provide faceMeshClass or loadScript');
    const mesh = new loadedClass({ locateFile: locateFile ?? ((file) => `assets/mediapipe-face-mesh/${file}`) });
    let pending;
    mesh.onResults?.((result) => { pending?.(result); pending = undefined; });
    return {
      async estimate(frame) {
        if (typeof canvasFactory !== 'function') throw new SdkError(STATUS.TRACKER_UNAVAILABLE, 'A canvasFactory is required for bundled FaceMesh input');
        const input = await canvasFactory(frame.width, frame.height);
        const context = input?.getContext?.('2d');
        if (!context?.putImageData) throw new SdkError(STATUS.TRACKER_UNAVAILABLE, 'FaceMesh canvas must expose a 2D context');
        const rgba = frameBytes(frame.data);
        if (!rgba || rgba.byteLength !== frame.width * frame.height * 4) throw new SdkError(STATUS.FRAME_INVALID, 'FaceMesh requires RGBA8 frame data');
        const imageData = typeof ImageData === 'function' ? new ImageData(new Uint8ClampedArray(rgba), frame.width, frame.height) : { data: new Uint8ClampedArray(rgba), width: frame.width, height: frame.height };
        context.putImageData(imageData, 0, 0);
        const result = await new Promise((resolve, reject) => { pending = resolve; Promise.resolve(mesh.send({ image: input })).catch(reject); });
        return result;
      },
      async setOptions(value) { await mesh.setOptions?.(value); },
      async close() { await mesh.close?.(); pending = undefined; }
    };
  };
  return createWechatFaceMeshTracker({ create, options, probe: () => Boolean(faceMeshClass || loadScript || globalThis?.FaceMesh) });
}

export function createWechatResourcePort({ loadManifest, loadPattern, release, probe }) {
  return {
    loadManifest: async (version) => loadManifest?.(version) ?? STATUS.ASSET_LOAD_FAILED,
    loadPattern: async (patternId, version) => loadPattern?.(patternId, version) ?? STATUS.ASSET_LOAD_FAILED,
    release: async (version) => release?.(version) ?? STATUS.OK,
    probe: () => probe?.() ?? (typeof loadManifest === 'function' && typeof loadPattern === 'function')
  };
}

export function createWechatWasmLoader({ downloadFile, readFile } = {}) {
  return async ({ url }) => {
    if (typeof readFile === 'function' && !/^https?:\/\//i.test(url)) {
      const result = await readFile(url);
      return result?.data ?? result;
    }
    if (typeof downloadFile !== 'function') {
      throw new SdkError(STATUS.ASSET_LOAD_FAILED,
        'A WeChat downloadFile callback is required for remote WASM artifacts');
    }
    const result = await downloadFile(url);
    if (result?.statusCode !== undefined && result.statusCode !== 200) {
      throw new SdkError(STATUS.ASSET_LOAD_FAILED,
        `WASM download failed with status ${result.statusCode}`);
    }
    return result?.data ?? result;
  };
}

export function createWechatWasmManifestLoader({ downloadFile, readFile } = {}) {
  const loadBytes = createWechatWasmLoader({ downloadFile, readFile });
  return async ({ url }) => {
    const bytes = await loadBytes({ url });
    if (typeof bytes === 'string') return JSON.parse(bytes);
    if (bytes instanceof ArrayBuffer) {
      return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes)));
    }
    if (ArrayBuffer.isView(bytes)) {
      return JSON.parse(new TextDecoder().decode(bytes));
    }
    return bytes;
  };
}
