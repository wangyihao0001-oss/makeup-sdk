import { STATUS, SdkError, create } from './makeup-sdk.js';
import { EFFECT } from './constants.js';
import { createWechatAssetCache } from './asset-cache.js';
import { resolveUpstreamPattern } from './upstream-catalog.js';
import { createWebGlMakeupRenderer } from './webgl-renderer.js';

let debugFrameLogged = false;
let debugEstimateCount = 0;

function joinUrl(base, path) {
  const left = String(base ?? '').replace(/\/$/, '');
  const right = String(path ?? '').replace(/^\//, '');
  if (!left) return right;
  return `${left}/${right}`;
}

function relativeAssetPath(url, baseUrl = '') {
  const value = String(url ?? '');
  const base = String(baseUrl ?? '').replace(/\/$/, '');
  if (base && (value === base || value.startsWith(`${base}/`))) return value.slice(base.length).replace(/^\//, '');
  if (!/^https?:\/\//i.test(value)) return value.replace(/^\//, '');
  return null;
}

function isRemoteUrl(url) {
  return /^https?:\/\//i.test(String(url ?? ''));
}

function decodeJson(bytes) {
  if (typeof bytes === 'string') return JSON.parse(bytes);
  if (bytes instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes)));
  if (ArrayBuffer.isView(bytes)) return JSON.parse(new TextDecoder().decode(bytes));
  if (bytes?.data) return decodeJson(bytes.data);
  return bytes;
}

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

function safeWechatBigInt(value, fallback = 0n) {
  if (value == null) return fallback;
  try {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') {
      return Number.isFinite(value) ? BigInt(Math.trunc(value)) : fallback;
    }
    const text = String(value).trim();
    if (/^[+-]?\d+$/.test(text)) return BigInt(text);
    const numeric = Number(text);
    return Number.isFinite(numeric) ? BigInt(Math.trunc(numeric)) : fallback;
  } catch {
    return fallback;
  }
}

export function normalizeWechatFrame(raw = {}) {
  const data = raw.data ?? raw.bytes ?? raw.pixelData;
  const width = Number(raw.width ?? raw.frameWidth ?? 0);
  const height = Number(raw.height ?? raw.frameHeight ?? 0);
  const orientation = Number(raw.orientation ?? raw.rotation ?? raw.rotate ?? 0);
  const timestampNs = raw.timestampNs != null
    ? safeWechatBigInt(raw.timestampNs)
    : raw.timestamp != null
      ? safeWechatBigInt(raw.timestamp) * 1000000n
      : 0n;
  const mirrored = Boolean(raw.mirrored ?? raw.isMirror ?? raw.mirror);
  const bytes = frameBytes(data);
  const hasDeclaredFormat = raw.pixelFormat != null || raw.format != null;
  const yuvSize = Math.max(0, width * height + 2 * Math.ceil(width / 2) * Math.ceil(height / 2));
  const declaredFormat = hasDeclaredFormat
    ? String(raw.pixelFormat ?? raw.format).toUpperCase()
    : bytes?.byteLength === width * height * 4
      ? 'RGBA8'
      : bytes?.byteLength === width * height * 3
        ? 'RGB24'
        : bytes?.byteLength === yuvSize
          ? 'NV12'
          : 'RGBA8';
  let pixelFormat = declaredFormat;
  let normalizedData = data;
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
  if (!debugFrameLogged && typeof console !== 'undefined') {
    debugFrameLogged = true;
    console.info('[makeup-sdk][debug] camera frame', { width, height, bytes: bytes?.byteLength ?? 0, declaredFormat, normalizedFormat: pixelFormat, normalizedBytes: frameBytes(normalizedData)?.byteLength ?? 0, orientation, mirrored });
  }
  return {
    timestampNs,
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
  let frameInFlight = false;
  let lastFrameAt = 0;
  const frameMinIntervalMs = 100;
  let stopSubscription;
  return {
    async start(onFrame) {
      if (active) return STATUS.INVALID_STATE;
      if (typeof subscribe !== 'function') {
        throw new SdkError(STATUS.CAMERA_PERMISSION_DENIED, 'Camera subscription is unavailable');
      }
      try {
        stopSubscription = await subscribe((rawFrame) => {
        // FaceMesh.send is asynchronous and the runtime only has one pending
        // result slot. Drop frames while one estimate is in flight instead of
        // overwriting the pending resolver and hanging an older frame.
        const now = Date.now();
        if (now - lastFrameAt < frameMinIntervalMs || frameInFlight) return;
        lastFrameAt = now;
        frameInFlight = true;
        let task;
        try {
          task = onFrame(normalizeWechatFrame(rawFrame));
        } catch (error) {
          frameInFlight = false;
          throw error;
        }
        Promise.resolve(task).then(
          () => { frameInFlight = false; },
          () => { frameInFlight = false; },
        );
      });
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
      frameInFlight = false;
      lastFrameAt = 0;
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
export function createWechatOpenMakeupResourcePort({ readFile, downloadFile, baseUrl = '', load } = {}) {
  const loadBytes = load ?? createWechatWasmLoader({ readFile, downloadFile, baseUrl });
  const resolve = (path) => joinUrl(baseUrl, path);
  let manifest;
  return {
    async loadManifest() {
      const bytes = await loadBytes({ url: resolve('patterns/patterns.json') });
      const text = typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
      manifest = JSON.parse(text);
      return STATUS.OK;
    },
    async loadPattern(patternId, version) {
      if (!manifest) throw new SdkError(STATUS.ASSET_LOAD_FAILED, 'Pattern manifest must be loaded first');
      const categories = Object.values(manifest.categories ?? {});
      const entry = categories.flat().find((pattern) => String(pattern.id) === String(patternId));
      if (!entry) throw new SdkError(STATUS.ASSET_LOAD_FAILED, `Pattern ${patternId} is not present in manifest ${version}`);
      await loadBytes({ url: resolve(entry.file) });
      return STATUS.OK;
    },
    async release() { manifest = undefined; return STATUS.OK; },
    probe() { return typeof readFile === 'function' || typeof downloadFile === 'function'; },
    async loadAsset(path) { return loadBytes({ url: resolve(path) }); },
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
export function createWechatOpenMakeupAssetLoader({ readFile, downloadFile, baseUrl = '', load } = {}) {
  const loadBytes = load ?? createWechatWasmLoader({ readFile, downloadFile, baseUrl });
  const resolve = (path) => joinUrl(baseUrl, path);
  return async (path) => loadBytes({ url: resolve(path) });
}

/**
 * Image callback for WebGL texture uploads. `createImage` should be the
 * canvas/host image factory (for example `canvas.createImage`). `resolveImage`
 * may turn a packaged or downloaded path into the local path accepted by the
 * image object. This keeps all WeChat-specific image lifecycle details out of
 * the renderer.
 */
export function createWechatOpenMakeupTextureLoader({ createImage, resolveImage, baseUrl = '', materialize } = {}) {
  const resolve = (path) => joinUrl(baseUrl, path);
  return async (path) => {
    if (typeof createImage !== 'function') throw new SdkError(STATUS.ASSET_LOAD_FAILED, 'A WeChat image factory is required for shader textures');
    const image = await createImage();
    const cached = typeof materialize === 'function' ? await materialize(path) : null;
    const source = cached || (typeof resolveImage === 'function' ? await resolveImage(resolve(path)) : resolve(path));
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
  const call = (fn, payload) => new Promise((resolve, reject) => fn({ ...payload, success: resolve, fail: reject }));
  const readFile = fs?.readFile ? (filePath) => call(fs.readFile, { filePath }) : undefined;
  const downloadFile = wxObject?.downloadFile ? (url) => call(wxObject.downloadFile, { url }) : undefined;
  const writeFile = fs?.writeFile ? (filePath, data) => call(fs.writeFile, { filePath, data }) : undefined;
  const stat = fs?.stat ? async (filePath) => {
    const result = await call(fs.stat, { path: filePath });
    return result?.stats?.size ?? result?.size;
  } : undefined;
  const mkdir = fs?.mkdir ? (dirPath) => call(fs.mkdir, { dirPath, recursive: true }) : undefined;
  const userDataPath = wxObject?.env?.USER_DATA_PATH;
  const bareLoader = createWechatWasmLoader({ readFile, downloadFile });
  let assetManifest = null;
  if (isRemoteUrl(assetsBaseUrl)) {
    try {
      assetManifest = decodeJson(await bareLoader({ url: joinUrl(assetsBaseUrl, 'openmakeup-assets.manifest.json') }));
    } catch (error) {
      console.error?.('[makeup-sdk] asset manifest unavailable', error?.message ?? error);
    }
  }
  const cache = assetManifest && userDataPath && writeFile && stat
    ? createWechatAssetCache({ userDataPath, manifest: assetManifest, stat, writeFile, mkdir })
    : null;
  const load = createWechatWasmLoader({ readFile, downloadFile, cache, baseUrl: assetsBaseUrl });
  const useBundledTracker = !faceMesh && !faceMeshFactory && !faceMeshEstimate;
  if (cache && useBundledTracker) {
    for (const file of cache.filesInGroup('faceMesh')) await load({ url: joinUrl(assetsBaseUrl, file.path) });
  }
  const faceMeshBase = joinUrl(assetsBaseUrl || 'assets', 'mediapipe-face-mesh');
  const locateFaceMesh = (file) => cache?.localPath(`mediapipe-face-mesh/${file}`) ?? `${faceMeshBase}/${file}`;
  const resources = createWechatOpenMakeupResourcePort({ readFile, downloadFile, baseUrl: assetsBaseUrl, load });
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
    : createWechatBundledFaceMeshTracker({ faceMeshClass, loadScript: faceMeshScriptLoader, canvasFactory: faceMeshCanvasFactory, options: faceMeshOptions, locateFile: locateFaceMesh }));
  const textureLoader = createWechatOpenMakeupTextureLoader({
    createImage: createImage ?? (() => canvas?.createImage?.()),
    resolveImage,
    baseUrl: assetsBaseUrl,
    materialize: cache ? async (path) => {
      if (await cache.ensureLocal(path)) return cache.localPath(path);
      await load({ url: joinUrl(assetsBaseUrl, path) });
      return cache.localPath(path);
    } : undefined
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
    const resolveFile = locateFile ?? ((file) => `assets/mediapipe-face-mesh/${file}`);
    if (!loadedClass && typeof loadScript === 'function') {
      const loaded = await loadScript({
        script: resolveFile('face_mesh.js'),
        locateFile: resolveFile
      });
      loadedClass = loaded?.FaceMesh ?? loaded ?? (typeof globalThis !== 'undefined' ? globalThis.FaceMesh : undefined);
    }
    if (typeof loadedClass !== 'function') throw new SdkError(STATUS.TRACKER_UNAVAILABLE, 'Bundled FaceMesh is not loaded; provide faceMeshClass or loadScript');
    const mesh = new loadedClass({ locateFile: resolveFile });
    let pendingResolve;
    let pendingReject;
    let pendingTimer;
    const faceMeshResultTimeoutMs = 5000;
    let fatalError;
    const clearPending = () => {
      if (pendingTimer !== undefined) clearTimeout(pendingTimer);
      pendingResolve = undefined;
      pendingReject = undefined;
      pendingTimer = undefined;
    };
    mesh.onResults?.((result) => {
      const resolve = pendingResolve;
      clearPending();
      resolve?.(result);
    });
    return {
      async estimate(frame) {
        if (fatalError) throw fatalError;
        if (typeof canvasFactory !== 'function') throw new SdkError(STATUS.TRACKER_UNAVAILABLE, 'A canvasFactory is required for bundled FaceMesh input');
        const input = await canvasFactory(frame.width, frame.height);
        const context = input?.getContext?.('2d');
        if (!context?.putImageData) throw new SdkError(STATUS.TRACKER_UNAVAILABLE, 'FaceMesh canvas must expose a 2D context');
        const rgba = frameBytes(frame.data);
        if (!rgba || rgba.byteLength !== frame.width * frame.height * 4) throw new SdkError(STATUS.FRAME_INVALID, 'FaceMesh requires RGBA8 frame data');
        debugEstimateCount += 1;
        if (debugEstimateCount <= 3 && typeof console !== 'undefined') console.info('[makeup-sdk][debug] FaceMesh input', { count: debugEstimateCount, width: frame.width, height: frame.height, bytes: rgba.byteLength, canvas: { width: input.width, height: input.height }, hasCreateImageData: typeof context.createImageData === 'function' });
        const imageData = context.createImageData ? context.createImageData(frame.width, frame.height) : typeof ImageData === 'function' ? new ImageData(new Uint8ClampedArray(rgba), frame.width, frame.height) : { data: new Uint8ClampedArray(rgba), width: frame.width, height: frame.height };
        if (imageData.data?.set) imageData.data.set(rgba);
        context.putImageData(imageData, 0, 0);
        const result = await new Promise((resolve, reject) => {
          pendingResolve = resolve;
          pendingReject = reject;
          pendingTimer = setTimeout(() => {
            if (pendingResolve !== resolve) return;
            clearPending();
            const error = new SdkError(STATUS.TRACKER_UNAVAILABLE, 'FaceMesh result timeout');
            fatalError = error;
            console.error('[makeup-sdk][debug] FaceMesh result timeout', error.message);
            reject(error);
          }, faceMeshResultTimeoutMs);
          let sending;
          try {
            sending = mesh.send({ image: { width: frame.width, height: frame.height, data: new Uint8Array(rgba) } });
          } catch (error) {
            fatalError = error;
            console.error('[makeup-sdk][debug] FaceMesh send threw', error?.stack ?? error);
            if (pendingResolve === resolve) clearPending();
            reject(error);
            return;
          }
          Promise.resolve(sending).catch((error) => {
            fatalError = error;
            console.error('[makeup-sdk][debug] FaceMesh send rejected', error?.stack ?? error);
            if (pendingResolve === resolve) clearPending();
            reject(error);
          });
        });
        if (debugEstimateCount <= 3 && typeof console !== 'undefined') { const faces = result?.multiFaceLandmarks ?? result?.faces ?? []; console.info('[makeup-sdk][debug] FaceMesh result', { count: debugEstimateCount, faces: Array.isArray(faces) ? faces.length : -1, points: Array.isArray(faces?.[0]) ? faces[0].length : 0 }); }
        return result;
      },
      async setOptions(value) { await mesh.setOptions?.(value); },
      async close() { clearPending(); await mesh.close?.(); }
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

async function bytesFromDownload(result, readFile) {
  if (result?.statusCode !== undefined && result.statusCode !== 200) {
    throw new SdkError(STATUS.ASSET_LOAD_FAILED, `Asset download failed with status ${result.statusCode}`);
  }
  if (result?.tempFilePath && typeof readFile === 'function') {
    const file = await readFile(result.tempFilePath);
    return file?.data ?? file;
  }
  return result?.data ?? result;
}

export function createWechatWasmLoader({ downloadFile, readFile, cache, baseUrl = '' } = {}) {
  return async ({ url }) => {
    const remote = isRemoteUrl(url);
    const relativePath = remote ? relativeAssetPath(url, baseUrl) : null;
    const entry = cache && relativePath ? cache.entry(relativePath) : null;
    if (entry) {
      const local = await cache.ensureLocal(relativePath);
      if (local && typeof readFile === 'function') {
        const cached = await readFile(local);
        return cached?.data ?? cached;
      }
    }
    if (typeof readFile === 'function' && !remote) {
      const result = await readFile(url);
      return result?.data ?? result;
    }
    if (typeof downloadFile !== 'function') {
      throw new SdkError(STATUS.ASSET_LOAD_FAILED,
        'A WeChat downloadFile callback is required for remote WASM artifacts');
    }
    const bytes = await bytesFromDownload(await downloadFile(url), readFile);
    if (entry) await cache.writeBytes(relativePath, bytes);
    return bytes;
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
