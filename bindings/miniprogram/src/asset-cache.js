import { STATUS, SdkError } from './constants.js';
import { sha256Hex } from './wasm-loader.js';

function asBytes(data) {
  if (data?.data != null && data.data !== data) return asBytes(data.data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

function arrayBufferOf(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/**
 * Disk cache for remotely hosted makeup assets. Files are stored by the
 * manifest SHA-256 under the host user-data directory. A hit checks size
 * only; the checksum is verified once, when the file is first stored.
 */
export function createWechatAssetCache({ userDataPath, manifest, stat, writeFile, mkdir } = {}) {
  const directory = `${String(userDataPath ?? '').replace(/\/$/, '')}/makeup-sdk-assets`;
  const entries = new Map();
  for (const file of manifest?.files ?? []) {
    if (file?.path && typeof file.sha256 === 'string' && Number.isInteger(file.size) && file.size > 0) {
      entries.set(file.path, file);
    }
  }
  const localPaths = new Map();
  let directoryReady = null;

  const ensureDirectory = async () => {
    if (typeof mkdir !== 'function') return;
    if (!directoryReady) directoryReady = Promise.resolve(mkdir(directory)).catch(() => {});
    await directoryReady;
  };
  const cachePath = (entry) => `${directory}/${entry.sha256}`;

  return {
    entry(relativePath) { return entries.get(relativePath) ?? null; },
    filesInGroup(group) { return [...entries.values()].filter((file) => file.group === group); },
    localPath(relativePath) { return localPaths.get(relativePath) ?? null; },
    async ensureLocal(relativePath) {
      const entry = entries.get(relativePath);
      if (!entry || typeof stat !== 'function') return null;
      const path = cachePath(entry);
      let size;
      try { size = await stat(path); } catch { return null; }
      if (size !== entry.size) return null;
      localPaths.set(relativePath, path);
      return path;
    },
    async writeBytes(relativePath, data) {
      const entry = entries.get(relativePath);
      const bytes = asBytes(data);
      if (!entry || !bytes || typeof writeFile !== 'function') return null;
      if (bytes.byteLength !== entry.size) {
        throw new SdkError(STATUS.ASSET_LOAD_FAILED, `Asset size mismatch: ${relativePath}`);
      }
      const hash = (await sha256Hex(arrayBufferOf(bytes))).toLowerCase();
      if (hash !== entry.sha256.toLowerCase()) {
        throw new SdkError(STATUS.ASSET_LOAD_FAILED, `Asset checksum mismatch: ${relativePath}`);
      }
      await ensureDirectory();
      const path = cachePath(entry);
      await writeFile(path, arrayBufferOf(bytes));
      localPaths.set(relativePath, path);
      return path;
    }
  };
}
