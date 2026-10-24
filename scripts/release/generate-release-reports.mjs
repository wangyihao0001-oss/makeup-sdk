import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const releaseDir = new URL('../../release/', import.meta.url);
const version = process.env.MAKEUP_SDK_VERSION ?? (await readFile(new URL('VERSION', root), 'utf8')).trim();
const commit = process.env.GITHUB_SHA ?? 'local';
const baseline = JSON.parse(await readFile(new URL('docs/performance/baseline.json', root), 'utf8'));

await mkdir(releaseDir, { recursive: true });
await writeFile(new URL(`compatibility-${version}.json`, releaseDir), `${JSON.stringify({
  schema_version: 1,
  sdk_version: version,
  commit,
  source: 'docs/compatibility/devices.yaml',
  status: 'pending-real-device-verification',
  devices: []
}, null, 2)}\n`);
await writeFile(new URL(`performance-${version}.json`, releaseDir), `${JSON.stringify({
  ...baseline,
  sdk_version: version,
  commit
}, null, 2)}\n`);
