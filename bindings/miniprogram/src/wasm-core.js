import { SdkError, STATE, STATUS } from './constants.js';

const EFFECTS = ['lipstick', 'mascara', 'eyeliner', 'eyeshadow', 'blush', 'foundation'];
const EFFECT_LIPSTICK = 'lipstick';
const EFFECT_INDEX = Object.freeze({
  lipstick: 0,
  mascara: 1,
  eyeliner: 2,
  eyeshadow: 3,
  blush: 4,
  foundation: 5
});

const FINISH_INDEX = Object.freeze({
  matte: 0,
  glossy: 1,
  shimmer: 2,
  glitter: 3
});

const PIXEL_FORMAT = Object.freeze({ RGBA8: 1, BGRA8: 2 });

function splitU64(value) {
  const number = BigInt(value ?? 0);
  return {
    low: Number(number & 0xffffffffn),
    high: Number((number >> 32n) & 0xffffffffn)
  };
}

function toBytes(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}

function assertStatus(status, message) {
  if (status !== STATUS.OK) throw new SdkError(status, message);
}

function stateFromCode(code) {
  return Object.values(STATE)[code] ?? STATE.ERROR;
}

export class WasmCore {
  constructor({ instance, manifest, wasmLoadStatus = 'loaded' }) {
    this.instance = instance;
    this.exports = instance.exports;
    this.manifest = manifest;
    this.sdkVersion = manifest.sdkVersion;
    this.manifestVersion = manifest.manifestVersion;
    this.wasmVersion = manifest.wasmVersion;
    this.wasmSha256 = manifest.sha256;
    this.wasmLoadStatus = wasmLoadStatus;
    this.maxFrameWidth = 4096;
    this.maxFrameHeight = 4096;
    this.state = STATE.IDLE;
    this.layers = new Map();
    this.lastFrame = null;
    this.lastTracking = null;
    this.handle = null;
    this.frameBufferAddress = 0;
    this.frameBufferSize = 0;
    this.capabilityConfig = {
      rendererVersion: 1,
      trackerVersion: 1,
      cameraAvailable: false,
      trackerAvailable: false,
      rendererAvailable: false,
      supportsEffects: Object.fromEntries(
        EFFECTS.map((effect) => [effect, false])
      )
    };
  }

  ensureHandle() {
    if (this.handle !== null) return this.handle;
    this.handle = this.exports.mk2_wasm_create(this.manifestVersion);
    if (!this.handle) {
      throw new SdkError(STATUS.INTERNAL_ERROR, 'WASM core creation failed', {
        code: 'WASM_CORE_CREATE_FAILED'
      });
    }
    return this.handle;
  }

  capabilities(overrides = {}) {
    return {
      platform: 'wechat-miniprogram',
      runtime: 'wasm',
      sdkVersion: this.sdkVersion,
      apiVersion: this.manifest.apiVersion,
      manifestVersion: this.manifestVersion,
      wasmVersion: this.wasmVersion,
      wasmSha256: this.wasmSha256,
      wasmLoadStatus: this.wasmLoadStatus,
      rendererBackend: overrides.rendererBackend ?? 'unavailable',
      trackerBackend: overrides.trackerBackend ?? 'unavailable',
      maxFrameWidth: this.maxFrameWidth,
      maxFrameHeight: this.maxFrameHeight,
      supportsEffects: { ...this.capabilityConfig.supportsEffects },
      cameraAvailable: this.capabilityConfig.cameraAvailable,
      trackerAvailable: this.capabilityConfig.trackerAvailable,
      rendererAvailable: this.capabilityConfig.rendererAvailable,
      knownLimitations: []
    };
  }

  configureCapabilities({ rendererVersion = 1, trackerVersion = 1,
    cameraAvailable = true, trackerAvailable = true,
    rendererAvailable = true, supportsEffects } = {}) {
    this.ensureHandle();
    const support = supportsEffects ?? Object.fromEntries(
      EFFECTS.map((effect) => [effect, effect === EFFECT_LIPSTICK])
    );
    this.capabilityConfig = {
      rendererVersion,
      trackerVersion,
      cameraAvailable: Boolean(cameraAvailable),
      trackerAvailable: Boolean(trackerAvailable),
      rendererAvailable: Boolean(rendererAvailable),
      supportsEffects: { ...support }
    };
    const status = this.exports.mk2_wasm_bind_capabilities(
      this.handle,
      this.manifestVersion,
      rendererVersion,
      trackerVersion,
      this.maxFrameWidth,
      this.maxFrameHeight,
      cameraAvailable ? 1 : 0,
      trackerAvailable ? 1 : 0,
      rendererAvailable ? 1 : 0,
      support[EFFECT_LIPSTICK] ? 1 : 0
    );
    assertStatus(status, 'WASM capability binding failed');
  }

  initialize() {
    this.ensureHandle();
    assertStatus(this.exports.mk2_wasm_initialize(this.handle),
      'WASM core initialization failed');
    assertStatus(this.exports.mk2_wasm_pump(this.handle, 1),
      'WASM core initialization pump failed');
    this.refreshState();
    return STATUS.OK;
  }

  start() {
    this.ensureHandle();
    assertStatus(this.exports.mk2_wasm_start(this.handle), 'WASM core start failed');
    assertStatus(this.exports.mk2_wasm_pump(this.handle, 1),
      'WASM core start pump failed');
    this.refreshState();
    return STATUS.OK;
  }

  stop() {
    if (this.handle === null) return STATUS.OK;
    assertStatus(this.exports.mk2_wasm_stop(this.handle), 'WASM core stop failed');
    assertStatus(this.exports.mk2_wasm_pump(this.handle, 1),
      'WASM core stop pump failed');
    this.refreshState();
    return STATUS.OK;
  }

  apply(params) {
    this.ensureHandle();
    const patternId = splitU64(params.patternId);
    const status = this.exports.mk2_wasm_apply(
      this.handle,
      EFFECT_INDEX[params.category],
      FINISH_INDEX[params.finish],
      patternId.low,
      patternId.high,
      params.argb >>> 0,
      params.intensity
    );
    assertStatus(status, 'WASM effect application failed');
    assertStatus(this.exports.mk2_wasm_pump(this.handle, 1),
      'WASM effect application pump failed');
    this.layers.set(params.category, { ...params });
    this.refreshState();
    return STATUS.OK;
  }

  clear(category) {
    this.ensureHandle();
    assertStatus(this.exports.mk2_wasm_clear(this.handle, EFFECT_INDEX[category]),
      'WASM effect clear failed');
    assertStatus(this.exports.mk2_wasm_pump(this.handle, 1),
      'WASM effect clear pump failed');
    this.layers.delete(category);
    this.refreshState();
    return STATUS.OK;
  }

  clearAll() {
    this.ensureHandle();
    assertStatus(this.exports.mk2_wasm_clear_all(this.handle),
      'WASM clearAll failed');
    assertStatus(this.exports.mk2_wasm_pump(this.handle, 1),
      'WASM clearAll pump failed');
    this.layers.clear();
    this.refreshState();
    return STATUS.OK;
  }

  ensureFrameBuffer(size) {
    if (size <= this.frameBufferSize && this.frameBufferAddress !== 0) {
      return this.frameBufferAddress;
    }
    if (this.frameBufferAddress !== 0) {
      this.exports.mk2_wasm_free(this.frameBufferAddress);
    }
    this.frameBufferAddress = this.exports.mk2_wasm_alloc(size);
    if (!this.frameBufferAddress) {
      throw new SdkError(STATUS.INTERNAL_ERROR, 'WASM frame buffer allocation failed', {
        code: 'WASM_MEMORY_ALLOCATION_FAILED'
      });
    }
    this.frameBufferSize = size;
    return this.frameBufferAddress;
  }

  submitFrame(frame, tracking) {
    this.ensureHandle();
    const bytes = toBytes(frame.data);
    if (!bytes) throw new SdkError(STATUS.FRAME_INVALID, 'Frame data is required');
    const dataAddress = this.ensureFrameBuffer(bytes.byteLength);
    new Uint8Array(this.exports.memory.buffer, dataAddress, bytes.byteLength).set(bytes);
    const timestamp = splitU64(frame.timestampNs);
    const trackingTimestamp = splitU64(tracking.timestampNs ?? frame.timestampNs);
    const status = this.exports.mk2_wasm_submit_frame(
      this.handle,
      timestamp.low,
      timestamp.high,
      frame.width,
      frame.height,
      PIXEL_FORMAT[frame.pixelFormat ?? 'RGBA8'],
      frame.orientation ?? 0,
      frame.mirrored ? 1 : 0,
      dataAddress,
      bytes.byteLength,
      trackingTimestamp.low,
      trackingTimestamp.high,
      tracking.faceCount,
      tracking.confidence ?? 0
    );
    assertStatus(status, 'WASM frame submission failed');
    this.lastFrame = frame;
    this.lastTracking = tracking;
    this.refreshState();
    return STATUS.OK;
  }

  capture() {
    this.ensureHandle();
    assertStatus(this.exports.mk2_wasm_capture(this.handle),
      'WASM capture request failed');
    assertStatus(this.exports.mk2_wasm_pump(this.handle, 1),
      'WASM capture pump failed');
    this.refreshState();
    return STATUS.OK;
  }

  dispose() {
    if (this.handle === null) return STATUS.OK;
    if (this.frameBufferAddress !== 0) {
      this.exports.mk2_wasm_free(this.frameBufferAddress);
      this.frameBufferAddress = 0;
      this.frameBufferSize = 0;
    }
    const status = this.exports.mk2_wasm_destroy(this.handle);
    this.handle = null;
    this.layers.clear();
    this.state = STATE.DISPOSED;
    return status;
  }

  refreshState() {
    const code = this.exports.mk2_wasm_get_state(this.handle);
    this.state = stateFromCode(code);
    return this.state;
  }
}
