import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const assetsRoot = join(root, 'assets');
const output = join(root, 'dist', 'openmakeup-assets.manifest.json');
const upstreamCommit = '12c5a8023aab0fcec7eef4fbdc0d1a29cf9989dd';

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const files = [];
for (const path of await filesUnder(assetsRoot)) {
  const bytes = await readFile(path);
  const info = await stat(path);
  files.push({
    path: relative(assetsRoot, path).split('\\').join('/'),
    size: info.size,
    sha256: createHash('sha256').update(bytes).digest('hex')
  });
}
files.sort((a, b) => a.path.localeCompare(b.path));
const patterns = JSON.parse(await readFile(join(assetsRoot, 'patterns/patterns.json'), 'utf8'));
const categoryCounts = Object.fromEntries(Object.entries(patterns.categories).map(([key, value]) => [key, value.length]));
const manifest = {
  schemaVersion: 1,
  sdkVersion: process.env.MAKEUP_SDK_VERSION ?? '0.1.0',
  upstream: { repository: 'https://github.com/ehsanwwe/OpenMakeupSDK', commit: upstreamCommit, license: 'MIT' },
  assetRoot: 'assets',
  patternManifest: 'patterns/patterns.json',
  patternManifestVersion: patterns.version,
  patternCount: Object.values(categoryCounts).reduce((sum, count) => sum + count, 0),
  categoryCounts,
  files
};
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${output} (${files.length} files)`);
