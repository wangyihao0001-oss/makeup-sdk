import { STATUS, SdkError } from './makeup-sdk.js';

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
        stopSubscription = await subscribe(onFrame);
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
