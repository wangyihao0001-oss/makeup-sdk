import { create } from './makeup-sdk.js';

async function runCheck(name, fn) {
  try {
    const value = await fn();
    return { name, ok: value !== false, value };
  } catch (error) {
    return { name, ok: false, error: String(error?.message ?? error) };
  }
}

export async function runMiniProgramProbe(options = {}) {
  const checks = [];
  checks.push(await runCheck('wasm', async () => {
    if (typeof options.wasmAvailable === 'function') return options.wasmAvailable();
    return typeof WebAssembly !== 'undefined';
  }));
  checks.push(await runCheck('camera-frame', async () => options.camera?.probe?.() ?? false));
  checks.push(await runCheck('webgl', async () => options.renderer?.probe?.() ?? false));
  checks.push(await runCheck('tracker', async () => options.tracker?.probe?.() ?? false));
  checks.push(await runCheck('resources', async () => options.resources?.probe?.() ?? false));
  checks.push(await runCheck('capture', async () => options.renderer?.captureProbe?.() ?? false));

  let session;
  let capabilities;
  if (options.camera && options.tracker && options.renderer && options.resources) {
    session = await create(options);
    try {
      capabilities = await session.initialize();
    } catch (error) {
      capabilities = session.getCapabilities();
      checks.push({ name: 'initialize', ok: false, error: String(error?.message ?? error) });
    }
  }
  const runtimeCheckPassed = checks
    .filter((check) => check.name !== 'wasm' || capabilities?.runtime === 'wasm')
    .every((check) => check.ok);
  const passed = runtimeCheckPassed && capabilities?.supportsEffects?.lipstick === true;
  const report = {
    platform: 'wechat-miniprogram',
    runtime: capabilities?.runtime ?? (options.runtime ?? 'auto'),
    device: options.device ?? {},
    sdkVersion: capabilities?.sdkVersion ?? options.sdkVersion ?? 'unknown',
    manifestVersion: capabilities?.manifestVersion ?? options.manifestVersion ?? 0,
    checks,
    capabilities: capabilities ?? null,
    lipstickSupported: passed,
    knownLimitations: passed ? [] : ['The lipstick path is not production-capable until every probe passes.']
  };
  if (session) await session.dispose();
  return report;
}
