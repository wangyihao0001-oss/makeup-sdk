import { SdkError, STATUS } from './constants.js';
import { WasmCore } from './wasm-core.js';

const WASM_MAGIC = Object.freeze([0, 97, 115, 109, 1, 0, 0, 0]);

export class WasmLoadError extends SdkError {
  constructor(code, message, details = undefined) {
    super(STATUS.INTERNAL_ERROR, message, { code, ...details });
    this.code = code;
  }
}

function asArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  if (value?.arrayBuffer instanceof Function) return value.arrayBuffer();
  throw new WasmLoadError('WASM_BYTES_INVALID', 'WASM loader did not return bytes');
}

async function defaultLoadBytes(url) {
  if (typeof fetch !== 'function') {
    throw new WasmLoadError('WASM_LOADER_REQUIRED',
      'A wasmLoader callback is required in this runtime');
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new WasmLoadError('WASM_DOWNLOAD_FAILED',
      `WASM download failed with status ${response.status}`);
  }
  return response.arrayBuffer();
}

function normalizeManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new WasmLoadError('WASM_MANIFEST_INVALID', 'WASM manifest is required');
  }
  const required = ['sdkVersion', 'apiVersion', 'wasmVersion', 'manifestVersion',
    'artifact', 'size', 'sha256', 'exports'];
  for (const key of required) {
    if (manifest[key] === undefined || manifest[key] === null) {
      throw new WasmLoadError('WASM_MANIFEST_INVALID', `WASM manifest field is missing: ${key}`);
    }
  }
  if (manifest.apiVersion !== 2 || !Array.isArray(manifest.exports) ||
      !Number.isInteger(manifest.size) || manifest.size <= 0 ||
      typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(manifest.sha256)) {
    throw new WasmLoadError('WASM_MANIFEST_INVALID', 'WASM manifest values are invalid');
  }
  return manifest;
}

async function loadManifest(options) {
  if (options.wasmManifest && typeof options.wasmManifest === 'object') {
    return normalizeManifest(options.wasmManifest);
  }
  const manifestUrl = typeof options.wasmManifest === 'string'
    ? options.wasmManifest
    : options.wasmManifestUrl;
  if (!manifestUrl) {
    throw new WasmLoadError('WASM_MANIFEST_REQUIRED', 'wasmManifest is required for WASM loading');
  }
  let value;
  if (typeof options.wasmManifestLoader === 'function') {
    value = await options.wasmManifestLoader({ url: manifestUrl, options });
  } else {
    if (typeof fetch !== 'function') {
      throw new WasmLoadError('WASM_MANIFEST_LOADER_REQUIRED',
        'A wasmManifestLoader callback is required in this runtime');
    }
    const response = await fetch(manifestUrl);
    if (!response.ok) {
      throw new WasmLoadError('WASM_MANIFEST_DOWNLOAD_FAILED',
        `WASM manifest download failed with status ${response.status}`);
    }
    value = await response.json();
  }
  if (typeof value === 'string') value = JSON.parse(value);
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    value = JSON.parse(new TextDecoder().decode(new Uint8Array(value)));
  }
  return normalizeManifest(value);
}

function rotr(value, amount) {
  return (value >>> amount) | (value << (32 - amount));
}

function sha256Fallback(bytes) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b,
    0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7,
    0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152,
    0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
    0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
    0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
    0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  const bitLength = bytes.byteLength * 8;
  const paddedLength = Math.ceil((bytes.byteLength + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.byteLength] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(words[i - 15], 7) ^ rotr(words[i - 15], 18) ^ (words[i - 15] >>> 3);
      const s1 = rotr(words[i - 2], 17) ^ rotr(words[i - 2], 19) ^ (words[i - 2] >>> 10);
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
    }
    let a = h0; let b = h1; let c = h2; let d = h3;
    let e = h4; let f = h5; let g = h6; let h = h7;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[i] + words[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((value) => value.toString(16).padStart(8, '0')).join('');
}

export async function sha256Hex(bytes, digest = undefined) {
  if (typeof digest === 'function') return digest(bytes);
  if (globalThis.crypto?.subtle) {
    const result = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(result)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }
  return sha256Fallback(new Uint8Array(bytes));
}

function verifyWasmHeader(bytes) {
  const view = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, WASM_MAGIC.length));
  if (view.length !== WASM_MAGIC.length || !WASM_MAGIC.every((value, index) => view[index] === value)) {
    throw new WasmLoadError('WASM_BINARY_INVALID', 'WASM binary header is invalid');
  }
}

function artifactUrl(options, manifest) {
  if (options.wasmUrl) return options.wasmUrl;
  if (typeof options.wasmManifest === 'string') {
    try { return new URL(manifest.artifact, options.wasmManifest).toString(); } catch { /* host-specific URL */ }
  }
  throw new WasmLoadError('WASM_URL_REQUIRED', 'wasmUrl is required when a manifest object is supplied');
}

export async function loadWasmCore(options = {}) {
  const manifest = await loadManifest(options);
  const url = artifactUrl(options, manifest);
  const loaded = typeof options.wasmLoader === 'function'
    ? await options.wasmLoader({ url, manifest, options })
    : await defaultLoadBytes(url);
  const bytes = await asArrayBuffer(loaded);
  verifyWasmHeader(bytes);
  if (bytes.byteLength !== manifest.size) {
    throw new WasmLoadError('WASM_SIZE_MISMATCH', 'WASM binary size does not match manifest');
  }
  const expectedHash = (options.wasmSha256 ?? manifest.sha256).toLowerCase();
  const actualHash = (await sha256Hex(bytes, options.sha256)).toLowerCase();
  if (actualHash !== expectedHash) {
    throw new WasmLoadError('WASM_HASH_MISMATCH', 'WASM binary hash does not match manifest', {
      expectedHash,
      actualHash
    });
  }
  const suppliedImports = options.wasmImports ?? {};
  const imports = {
    env: {
      emscripten_notify_memory_growth: () => {},
      ...(suppliedImports.env ?? {})
    },
    wasi_snapshot_preview1: {
      proc_exit: (code) => {
        throw new WasmLoadError('WASM_PROC_EXIT', `WASM runtime exited with code ${code}`);
      },
      ...(suppliedImports.wasi_snapshot_preview1 ?? {})
    }
  };
  let instantiated;
  try {
    instantiated = await WebAssembly.instantiate(bytes, imports);
  } catch (error) {
    throw new WasmLoadError('WASM_INSTANTIATION_FAILED', String(error?.message ?? error), { cause: error });
  }
  const instance = instantiated.instance ?? instantiated;
  for (const name of manifest.exports) {
    if (typeof instance.exports[name] !== 'function') {
      throw new WasmLoadError('WASM_EXPORT_MISSING', `WASM export is missing: ${name}`);
    }
  }
  if (typeof instance.exports.__wasm_call_ctors === 'function') {
    instance.exports.__wasm_call_ctors();
  }
  if (typeof instance.exports._initialize === 'function') {
    instance.exports._initialize();
  }
  if (instance.exports.mk2_wasm_api_version() !== manifest.apiVersion) {
    throw new WasmLoadError('WASM_API_MISMATCH', 'WASM API version does not match manifest');
  }
  return new WasmCore({ instance, manifest });
}
