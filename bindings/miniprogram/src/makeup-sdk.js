import { loadWasmCore } from './wasm-loader.js';
import { EFFECT, EVENT, FINISH, SdkError, STATE, STATUS } from './constants.js';
import {
  UPSTREAM_CATEGORIES,
  UPSTREAM_MORPH_CONTROLS,
  UPSTREAM_MORPH_TARGETS_EXTRA,
  resolveUpstreamCategory,
  resolveUpstreamPattern
} from './upstream-catalog.js';
export { EFFECT, EVENT, FINISH, SdkError, STATE, STATUS } from './constants.js';

const EFFECTS = Object.values(EFFECT);

export function normalizeFinish(finish) {
  if (finish === 'dewy') return FINISH.GLOSSY;
  if (Object.values(FINISH).includes(finish)) return finish;
  throw new SdkError(STATUS.INVALID_ARGUMENT, `Unsupported finish: ${finish}`);
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
  const categoryMap = { eyeline: EFFECT.EYELINER };
  const catalog = Object.entries(UPSTREAM_CATEGORIES).flatMap(([category, config]) =>
    config.patterns.map((pattern) => ({
      patternId: pattern.id,
      category: categoryMap[category] ?? category,
      assetKey: pattern.file,
      finishes: config.supportsFinish ? Object.values(FINISH) : [],
      manifestVersion,
      bundled: pattern.bundled,
      colorable: pattern.colorable
    })));
  // Keep the pre-parity synthetic pattern usable for existing integration tests.
  catalog.push({ patternId: 1001, category: EFFECT.LIPSTICK, assetKey: 'lipstick/1001',
    finishes: Object.values(FINISH), manifestVersion, bundled: false, colorable: true, legacy: true });
  return catalog;
}

function upstreamCategory(category) {
  const resolved = resolveUpstreamCategory(category);
  return resolved === 'eyeline' ? EFFECT.EYELINER : resolved;
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
      wasmVersion: null,
      wasmSha256: null,
      wasmLoadStatus: 'not_attempted',
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
    this.operationId = 0;
    this.eventListeners = new Set();
    this.morphState = new Map();
    this.wireframe = false;
    this.blur = false;
    this.capabilityReport = this.core.capabilities();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(callback);
    return () => this.listeners.get(event)?.delete(callback);
  }

  onEvent(callback) {
    this.eventListeners.add(callback);
    return () => this.eventListeners.delete(callback);
  }

  emit(event, payload) {
    for (const callback of this.listeners.get(event) ?? []) callback(payload);
    const unified = this.#unifiedEvent(event, payload);
    if (unified) for (const callback of this.eventListeners) callback(unified);
  }

  #unifiedEvent(event, payload) {
    const base = {
      sdkVersion: this.core.sdkVersion,
      manifestVersion: this.core.manifestVersion,
      operationId: payload?.operationId ?? 0,
      category: payload?.category,
      status: payload?.status ?? STATUS.OK,
      timestamp: Date.now()
    };
    if (event === 'state') return { ...base, type: EVENT.STATE_CHANGED, state: payload };
    if (event === 'effect') return { ...base, type: EVENT.OPERATION_COMPLETED, params: payload.params };
    if (event === 'frame') return { ...base, type: EVENT.TRACKING_STATUS, tracking: payload.tracking };
    if (event === 'error') {
      return { ...base, type: EVENT.ERROR, status: payload?.status ?? STATUS.INTERNAL_ERROR,
        error: payload };
    }
    return null;
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
      const rendererEffects = this.renderer.supportedEffects ?? [EFFECT.LIPSTICK];
      const supportsEffects = Object.fromEntries(EFFECTS.map((effect) => [effect, rendererEffects.includes(effect)]));
      this.core.configureCapabilities?.({
        rendererVersion: this.options.rendererVersion ?? 1,
        trackerVersion: this.options.trackerVersion ?? 1,
        cameraAvailable: true,
        trackerAvailable: true,
        rendererAvailable: true,
        supportsEffects
      });
      assertStatus(await this.core.initialize?.() ?? STATUS.OK,
        'Core initialization failed');
      this.capabilityReport = {
        ...this.core.capabilities({
          rendererBackend: this.options.rendererBackend ?? 'webgl',
          trackerBackend: this.options.trackerBackend ?? 'injected'
        }),
        cameraAvailable: true,
        trackerAvailable: true,
        rendererAvailable: true,
        supportsEffects,
        knownLimitations: rendererEffects.length === 1 && rendererEffects[0] === EFFECT.LIPSTICK
          ? ['Only lipstick is enabled in the first renderer milestone.']
          : []
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
    assertStatus(await this.core.start?.() ?? STATUS.OK, 'Core start failed');
    this.started = true;
    try {
      assertStatus(await this.camera.start((frame) => this.#onFrame(frame)), 'Camera start failed');
    } catch (error) {
      this.started = false;
      await this.core.stop?.();
      throw error;
    }
    this.setState(STATE.TRACKING);
  }

  async apply(params) {
    this.ensureInitialized();
    if (!params || !upstreamCategory(params.category)) {
      throw new SdkError(STATUS.INVALID_ARGUMENT, `Unknown makeup category: ${params?.category}`);
    }
    const category = upstreamCategory(params.category);
    const finish = params.finish == null ? null : normalizeFinish(params.finish);
    if (!this.capabilityReport.supportsEffects?.[category]) {
      throw new SdkError(STATUS.UNSUPPORTED_EFFECT, `Effect is not supported by the active renderer: ${category}`);
    }
    const pattern = params.patternId == null
      ? null
      : this.catalog.find((entry) => String(entry.patternId) === String(params.patternId) && entry.category === category);
    const supportsFinish = UPSTREAM_CATEGORIES[category === EFFECT.EYELINER ? 'eyeline' : category]?.supportsFinish ?? false;
    if ((params.patternId != null && !pattern) || (supportsFinish && finish != null && pattern && !pattern.finishes.includes(finish))) {
      throw new SdkError(STATUS.ASSET_LOAD_FAILED, 'Pattern or finish is unavailable');
    }
    if (!Number.isFinite(params.intensity) || params.intensity < 0 || params.intensity > 1) {
      throw new SdkError(STATUS.INVALID_ARGUMENT, 'Intensity must be between 0 and 1');
    }
    const generation = (this.generation.get(category) ?? 0) + 1;
    this.generation.set(category, generation);
    if (params.patternId != null) {
      await this.resources.loadPattern(params.patternId, this.core.manifestVersion);
    }
    if (this.generation.get(category) !== generation || this.disposed) {
      throw new SdkError(STATUS.OPERATION_CANCELLED, 'A newer effect operation superseded this one');
    }
    const normalized = { ...params, category, finish };
    assertStatus(await this.core.apply?.(normalized) ?? STATUS.OK,
      'Core effect application failed');
    this.core.layers.set(category, normalized);
    const operationId = ++this.operationId;
    this.emit('effect', { category, operationId, params: normalized });
    return { status: STATUS.OK, operationId, params: normalized };
  }

  async clear(category) {
    this.ensureInitialized();
    const normalizedCategory = upstreamCategory(category);
    if (!normalizedCategory) throw new SdkError(STATUS.INVALID_ARGUMENT, `Unknown makeup category: ${category}`);
    this.generation.set(normalizedCategory, (this.generation.get(normalizedCategory) ?? 0) + 1);
    assertStatus(await this.core.clear?.(normalizedCategory) ?? STATUS.OK, 'Core effect clear failed');
    this.core.layers.delete(normalizedCategory);
    return { status: STATUS.OK, operationId: ++this.operationId, category: normalizedCategory };
  }

  async clearAll() {
    this.ensureInitialized();
    assertStatus(await this.core.clearAll?.() ?? STATUS.OK, 'Core clearAll failed');
    this.core.layers.clear();
    return { status: STATUS.OK, operationId: ++this.operationId };
  }

  async capture() {
    this.ensureInitialized();
    if (!this.core.lastFrame) throw new SdkError(STATUS.NO_FRAME, 'No valid rendered frame');
    const capture = await this.renderer.capture();
    if (!capture) throw new SdkError(STATUS.CAPTURE_FAILED, 'Renderer did not return a capture');
    assertStatus(await this.core.capture?.() ?? STATUS.OK, 'Core capture failed');
    this.setState(STATE.CAPTURED);
    const metadata = {
      timestampNs: this.core.lastFrame.timestampNs,
      width: this.core.lastFrame.width,
      height: this.core.lastFrame.height,
      orientation: this.core.lastFrame.orientation,
      mirrored: this.core.lastFrame.mirrored,
      sdkVersion: this.core.sdkVersion,
      manifestVersion: this.core.manifestVersion,
      rendererVersion: this.options.rendererVersion ?? 1
    };
    return {
      ...capture,
      path: capture.path,
      timestampNs: metadata.timestampNs,
      width: metadata.width,
      height: metadata.height,
      orientation: metadata.orientation,
      mirrored: metadata.mirrored,
      sdkVersion: metadata.sdkVersion,
      manifestVersion: metadata.manifestVersion,
      rendererVersion: metadata.rendererVersion,
      metadata,
      layers: Object.fromEntries(this.core.layers)
    };
  }

  async stop() {
    this.ensureInitialized();
    if (!this.started) return;
    assertStatus(await this.camera.stop(), 'Camera stop failed');
    assertStatus(await this.tracker.reset(), 'Tracker reset failed');
    assertStatus(await this.core.stop?.() ?? STATUS.OK, 'Core stop failed');
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
    await this.core.dispose?.();
    this.started = false;
    this.initialized = false;
    this.disposed = true;
    this.setState(STATE.DISPOSED);
  }

  getPatterns(category) {
    const resolved = resolveUpstreamCategory(category);
    if (!resolved) return [];
    return UPSTREAM_CATEGORIES[resolved].patterns.map(({ number, id, bundled, colorable, file }) =>
      ({ number, id, bundled, colorable, file }));
  }

  morph(map = {}) {
    for (const [name, value] of Object.entries(map)) this.setMorph(name, value);
  }

  setMorph(name, value) {
    if (typeof name !== 'string' || !Number.isFinite(value)) {
      throw new SdkError(STATUS.INVALID_ARGUMENT, 'Morph name and value are required');
    }
    if (value < -1 || value > 2) {
      throw new SdkError(STATUS.INVALID_ARGUMENT, 'Morph value must be between -1 and 2');
    }
    const valid = UPSTREAM_MORPH_CONTROLS[name] || UPSTREAM_MORPH_TARGETS_EXTRA.includes(name) || /^facemesh\d+(\.\d+)?$/.test(name);
    if (!valid) throw new SdkError(STATUS.INVALID_ARGUMENT, `Unknown morph target: ${name}`);
    this.morphState.set(name, value);
    this.renderer?.setMorph?.(name, value);
    return { name, value };
  }

  resetMorph() {
    this.morphState.clear();
    this.renderer?.resetMorph?.();
  }

  getMorphTargets() {
    return [...Object.keys(UPSTREAM_MORPH_CONTROLS), ...UPSTREAM_MORPH_TARGETS_EXTRA];
  }

  setWireframe(on) {
    this.wireframe = Boolean(on);
    this.renderer?.setWireframe?.(this.wireframe);
  }

  setBlur(on) {
    this.blur = Boolean(on);
    this.renderer?.setBlur?.(this.blur);
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
      assertStatus(await this.core.submitFrame?.(frame, tracking) ?? STATUS.OK,
        'Core frame submission failed');
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
  let wasmLoadStatus = 'not_attempted';
  if (!core && runtime !== 'ts-js') {
    try {
      if (typeof options.wasmFactory === 'function') {
        core = await options.wasmFactory(options);
      } else if (options.wasmUrl || options.wasmManifest || options.wasmManifestUrl || options.wasmLoader) {
        core = await loadWasmCore(options);
      } else if (runtime === 'wasm') {
        throw new SdkError(STATUS.INTERNAL_ERROR,
          'WASM runtime requires wasmUrl, wasmManifest or wasmFactory',
          { code: 'WASM_CONFIGURATION_REQUIRED' });
      }
      if (core) {
        runtime = 'wasm';
        wasmLoadStatus = 'loaded';
      }
    } catch (error) {
      wasmLoadStatus = 'failed';
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
  session.capabilityReport.wasmLoadStatus = core?.wasmLoadStatus ?? wasmLoadStatus;
  session.capabilityReport.wasmVersion = core?.wasmVersion ?? null;
  session.capabilityReport.wasmSha256 = core?.wasmSha256 ?? null;
  if (fallbackReason) {
    session.capabilityReport.knownLimitations = [
      ...session.capabilityReport.knownLimitations,
      `WASM initialization failed; using TS/JS fallback: ${fallbackReason}`
    ];
  }
  return session;
}

export { MakeupSdkSession as MakeupSdk };
