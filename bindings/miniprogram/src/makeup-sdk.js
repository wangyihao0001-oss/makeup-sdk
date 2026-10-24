export const STATUS = Object.freeze({
  OK: 0,
  INVALID_ARGUMENT: 1,
  INVALID_STATE: 2,
  NOT_INITIALIZED: 3,
  UNSUPPORTED_EFFECT: 4,
  NO_FACE: 5,
  MULTIPLE_FACES: 6,
  NO_FRAME: 7,
  CAPTURE_FAILED: 8,
  OPERATION_CANCELLED: 9,
  DISPOSED: 10,
  INTERNAL_ERROR: 11,
  NO_EVENT: 12,
  FRAME_INVALID: 13,
  RENDERER_UNAVAILABLE: 14,
  CAMERA_PERMISSION_DENIED: 15,
  TRACKER_UNAVAILABLE: 16,
  MODEL_LOAD_FAILED: 17,
  ASSET_LOAD_FAILED: 18,
  GPU_CONTEXT_LOST: 19
});

export const STATE = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  TRACKING: 'tracking',
  RENDERING: 'rendering',
  CAPTURED: 'captured',
  UNSUPPORTED: 'unsupported',
  ERROR: 'error',
  DISPOSED: 'disposed'
});

export const EFFECT = Object.freeze({
  LIPSTICK: 'lipstick',
  MASCARA: 'mascara',
  EYELINER: 'eyeliner',
  EYESHADOW: 'eyeshadow',
  BLUSH: 'blush',
  FOUNDATION: 'foundation'
});

export const FINISH = Object.freeze({
  MATTE: 'matte',
  GLOSSY: 'glossy',
  SHIMMER: 'shimmer',
  GLITTER: 'glitter'
});

const EFFECTS = Object.values(EFFECT);

export function normalizeFinish(finish) {
  if (finish === 'dewy') return FINISH.GLOSSY;
  if (Object.values(FINISH).includes(finish)) return finish;
  throw new SdkError(STATUS.INVALID_ARGUMENT, `Unsupported finish: ${finish}`);
}

export class SdkError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.name = 'MakeupSdkError';
    this.status = status;
    this.details = details;
  }
}

function assertStatus(status, message) {
  if (status !== STATUS.OK) throw new SdkError(status, message);
}

function validateFrame(frame) {
  if (!frame || !Number.isInteger(frame.width) || !Number.isInteger(frame.height) ||
      frame.width <= 0 || frame.height <= 0 || !frame.data) {
    throw new SdkError(STATUS.FRAME_INVALID, 'Frame dimensions and data are required');
  }
  const pixelFormat = frame.pixelFormat ?? 'RGBA8';
  if (pixelFormat !== 'RGBA8' && pixelFormat !== 'BGRA8') {
    throw new SdkError(STATUS.FRAME_INVALID, 'Only RGBA8 and BGRA8 frames are supported');
  }
  const dataSize = frame.data.byteLength ?? frame.data.length;
  if (dataSize !== frame.width * frame.height * 4) {
    throw new SdkError(STATUS.FRAME_INVALID, 'Frame data size does not match dimensions');
  }
  const orientation = ((frame.orientation ?? 0) % 360 + 360) % 360;
  if (![0, 90, 180, 270].includes(orientation)) {
    throw new SdkError(STATUS.FRAME_INVALID, 'Frame orientation must be 0, 90, 180 or 270');
  }
  return {
    ...frame,
    timestampNs: BigInt(frame.timestampNs ?? 0),
    pixelFormat,
    orientation,
    mirrored: Boolean(frame.mirrored),
    dataSize
  };
}

function defaultCatalog(manifestVersion) {
  return [{
    patternId: 1001,
    category: EFFECT.LIPSTICK,
    assetKey: 'lipstick/1001',
    finishes: Object.values(FINISH),
    manifestVersion
  }];
}

export function createCachedResourcePort(base) {
  const cache = new Map();
  let manifestVersion = 0;
  return {
    async loadManifest(version) {
      manifestVersion = version;
      cache.clear();
      return base.loadManifest(version);
    },
    async loadPattern(patternId, version) {
      const key = `${version}:${patternId}`;
      if (!cache.has(key)) {
        await base.loadPattern(patternId, version);
        cache.set(key, true);
      }
      return STATUS.OK;
    },
    async release(version = manifestVersion) {
      cache.clear();
      return base.release(version);
    }
  };
}

export class TsJsCore {
  constructor({ manifestVersion = 1, sdkVersion = '0.1.0', maxFrameWidth = 4096,
    maxFrameHeight = 4096 } = {}) {
    this.manifestVersion = manifestVersion;
    this.sdkVersion = sdkVersion;
    this.maxFrameWidth = maxFrameWidth;
    this.maxFrameHeight = maxFrameHeight;
    this.state = STATE.IDLE;
    this.layers = new Map();
    this.operation = 0;
    this.generation = new Map();
    this.lastFrame = null;
    this.lastTracking = null;
  }

  capabilities(overrides = {}) {
    return {
      platform: 'wechat-miniprogram',
      runtime: 'ts-js',
      sdkVersion: this.sdkVersion,
      apiVersion: 2,
      manifestVersion: this.manifestVersion,
      rendererBackend: overrides.rendererBackend ?? 'unavailable',
      trackerBackend: overrides.trackerBackend ?? 'unavailable',
      maxFrameWidth: this.maxFrameWidth,
      maxFrameHeight: this.maxFrameHeight,
      supportsEffects: Object.fromEntries(EFFECTS.map((effect) => [effect, false])),
      cameraAvailable: false,
      trackerAvailable: false,
      rendererAvailable: false,
      knownLimitations: ['The TS/JS runtime is a fallback and has no native acceleration guarantee.']
    };
  }
}

export class MakeupSdkSession {
  constructor(options = {}) {
    this.options = options;
    this.mode = options.runtime ?? 'auto';
    this.core = options.core ?? new TsJsCore(options);
    this.camera = options.camera;
    this.tracker = options.tracker;
    this.renderer = options.renderer;
    this.resources = options.resources;
    this.catalog = options.catalog ?? defaultCatalog(this.core.manifestVersion);
    this.listeners = new Map();
    this.initialized = false;
    this.started = false;
    this.disposed = false;
    this.generation = new Map();
    this.capabilityReport = this.core.capabilities();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(callback);
    return () => this.listeners.get(event)?.delete(callback);
  }

  emit(event, payload) {
    for (const callback of this.listeners.get(event) ?? []) callback(payload);
  }

  getCapabilities() {
    return structuredClone(this.capabilityReport);
  }

  async initialize() {
    this.ensureUsable();
    if (this.initialized) throw new SdkError(STATUS.INVALID_STATE, 'Session already initialized');
    if (!this.camera || !this.tracker || !this.renderer || !this.resources) {
      throw new SdkError(STATUS.INVALID_ARGUMENT, 'camera, tracker, renderer and resources are required');
    }
    this.setState(STATE.LOADING);
    try {
      assertStatus(await this.resources.loadManifest(this.core.manifestVersion), 'Manifest load failed');
      assertStatus(await this.tracker.initialize(this.options.trackerVersion ?? 1), 'Tracker initialization failed');
      assertStatus(await this.renderer.initialize(this.options.rendererVersion ?? 1), 'Renderer initialization failed');
      this.capabilityReport = {
        ...this.core.capabilities({
          rendererBackend: this.options.rendererBackend ?? 'webgl',
          trackerBackend: this.options.trackerBackend ?? 'injected'
        }),
        cameraAvailable: true,
        trackerAvailable: true,
        rendererAvailable: true,
        supportsEffects: Object.fromEntries(EFFECTS.map((effect) => [effect, effect === EFFECT.LIPSTICK])),
        knownLimitations: ['Only lipstick is enabled in the first renderer milestone.']
      };
      this.initialized = true;
      this.setState(STATE.READY);
      return this.getCapabilities();
    } catch (error) {
      this.setState(STATE.UNSUPPORTED);
      throw error;
    }
  }

  async start() {
    this.ensureInitialized();
    if (this.started) throw new SdkError(STATUS.INVALID_STATE, 'Session already started');
    assertStatus(await this.tracker.reset(), 'Tracker reset failed');
    this.started = true;
    try {
      assertStatus(await this.camera.start((frame) => this.#onFrame(frame)), 'Camera start failed');
    } catch (error) {
      this.started = false;
      throw error;
    }
    this.setState(STATE.TRACKING);
  }

  async apply(params) {
    this.ensureInitialized();
    if (!params || params.category !== EFFECT.LIPSTICK) {
      throw new SdkError(STATUS.UNSUPPORTED_EFFECT, 'Only lipstick is supported in this milestone');
    }
    const finish = normalizeFinish(params.finish);
    const pattern = this.catalog.find((entry) => entry.patternId === params.patternId && entry.category === params.category);
    if (!pattern || !pattern.finishes.includes(finish)) {
      throw new SdkError(STATUS.ASSET_LOAD_FAILED, 'Pattern or finish is unavailable');
    }
    if (!Number.isFinite(params.intensity) || params.intensity < 0 || params.intensity > 1) {
      throw new SdkError(STATUS.INVALID_ARGUMENT, 'Intensity must be between 0 and 1');
    }
    const generation = (this.generation.get(params.category) ?? 0) + 1;
    this.generation.set(params.category, generation);
    await this.resources.loadPattern(params.patternId, this.core.manifestVersion);
    if (this.generation.get(params.category) !== generation || this.disposed) {
      throw new SdkError(STATUS.OPERATION_CANCELLED, 'A newer effect operation superseded this one');
    }
    this.core.layers.set(params.category, { ...params, finish });
    this.emit('effect', { category: params.category, params: { ...params, finish } });
    return { status: STATUS.OK, params: { ...params, finish } };
  }

  async clear(category) {
    this.ensureInitialized();
    this.core.layers.delete(category);
    return { status: STATUS.OK, category };
  }

  async clearAll() {
    this.ensureInitialized();
    this.core.layers.clear();
    return { status: STATUS.OK };
  }

  async capture() {
    this.ensureInitialized();
    if (!this.core.lastFrame) throw new SdkError(STATUS.NO_FRAME, 'No valid rendered frame');
    const capture = await this.renderer.capture();
    if (!capture) throw new SdkError(STATUS.CAPTURE_FAILED, 'Renderer did not return a capture');
    this.setState(STATE.CAPTURED);
    return {
      ...capture,
      metadata: {
        timestampNs: this.core.lastFrame.timestampNs,
        width: this.core.lastFrame.width,
        height: this.core.lastFrame.height,
        orientation: this.core.lastFrame.orientation,
        mirrored: this.core.lastFrame.mirrored,
        sdkVersion: this.core.sdkVersion,
        manifestVersion: this.core.manifestVersion,
        rendererVersion: this.options.rendererVersion ?? 1
      },
      layers: Object.fromEntries(this.core.layers)
    };
  }

  async stop() {
    this.ensureInitialized();
    if (!this.started) return;
    assertStatus(await this.camera.stop(), 'Camera stop failed');
    assertStatus(await this.tracker.reset(), 'Tracker reset failed');
    this.started = false;
    this.setState(STATE.READY);
  }

  async dispose() {
    if (this.disposed) return;
    if (this.started) await this.camera.stop();
    if (this.initialized) {
      await this.renderer.dispose();
      await this.tracker.dispose();
      await this.resources.release(this.core.manifestVersion);
    }
    this.started = false;
    this.initialized = false;
    this.disposed = true;
    this.setState(STATE.DISPOSED);
  }

  ensureUsable() {
    if (this.disposed) throw new SdkError(STATUS.DISPOSED, 'Session has been disposed');
  }

  ensureInitialized() {
    this.ensureUsable();
    if (!this.initialized) throw new SdkError(STATUS.NOT_INITIALIZED, 'Session is not initialized');
  }

  setState(state) {
    this.core.state = state;
    this.emit('state', state);
  }

  async #onFrame(rawFrame) {
    if (!this.started || this.disposed) return;
    try {
      const frame = validateFrame(rawFrame);
      if (frame.width > this.core.maxFrameWidth || frame.height > this.core.maxFrameHeight) {
        throw new SdkError(STATUS.FRAME_INVALID, 'Frame exceeds capability limits');
      }
      const tracking = await this.tracker.estimate(frame);
      if (!tracking || tracking.faceCount === 0) throw new SdkError(STATUS.NO_FACE, 'No face detected');
      if (tracking.faceCount > 1) throw new SdkError(STATUS.MULTIPLE_FACES, 'Multiple faces detected');
      if (tracking.timestampNs !== undefined && BigInt(tracking.timestampNs) !== frame.timestampNs) {
        throw new SdkError(STATUS.FRAME_INVALID, 'Tracking result does not match frame timestamp');
      }
      this.core.lastFrame = frame;
      this.core.lastTracking = tracking;
      this.setState(STATE.RENDERING);
      await this.renderer.render(frame, tracking, Object.fromEntries(this.core.layers));
      this.emit('frame', { frame, tracking });
    } catch (error) {
      this.emit('error', error);
    }
  }
}

export async function create(options = {}) {
  let runtime = options.runtime ?? 'auto';
  let core = options.core;
  let fallbackReason;
  if (!core && runtime !== 'ts-js' && typeof options.wasmFactory === 'function') {
    try {
      core = await options.wasmFactory(options);
      runtime = 'wasm';
    } catch (error) {
      if (runtime === 'wasm') throw error;
      runtime = 'ts-js';
      fallbackReason = String(error?.message ?? error);
    }
  }
  if (!core) {
    core = new TsJsCore({ ...options, runtime });
    runtime = 'ts-js';
  }
  const session = new MakeupSdkSession({ ...options, core, runtime });
  session.capabilityReport.runtime = runtime;
  if (fallbackReason) {
    session.capabilityReport.knownLimitations = [
      ...session.capabilityReport.knownLimitations,
      `WASM initialization failed; using TS/JS fallback: ${fallbackReason}`
    ];
  }
  return session;
}
