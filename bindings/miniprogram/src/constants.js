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

export const EVENT = Object.freeze({
  STATE_CHANGED: 'stateChanged',
  OPERATION_COMPLETED: 'operationCompleted',
  FRAME_REJECTED: 'frameRejected',
  RESOURCE_PROGRESS: 'resourceProgress',
  TRACKING_STATUS: 'trackingStatus',
  ERROR: 'error',
  PERFORMANCE: 'performance'
});

export class SdkError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.name = 'MakeupSdkError';
    this.status = status;
    this.details = details;
  }
}
