import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const assetsRoot = join(root, 'assets');
const output = join(root, 'dist', 'openmakeup-assets.manifest.json');
const upstreamCommit = '12c5a8023aab0fcec7eef4fbdc0d1a29cf9989dd';

const SHARED_SHADER = new Map([
  ['shaders/foundation_mask.PNG', 'shader:blush'],
  ['shaders/foundation_mask2.PNG', 'shader:eyeshadow'],
  ['shaders/foundation_mask3.PNG', 'shader:foundation']
]);

const SHADER_GROUP = new Map([
  ['lip', 'shader:lipstick'],
  ['eyeshadow', 'shader:eyeshadow'],
  ['blush', 'shader:blush'],
  ['foundation', 'shader:foundation'],
  ['eyeline', 'shader:eyeliner'],
  ['mascara', 'shader:mascara'],
  ['bluremask', 'shader:blur'],
  ['facewarp', 'shader:facewarp']
]);

function excluded(path) {
  const base = path.split('/').pop();
  if (base === 'package.json' || base === 'README.md' || base.endsWith('.d.ts') || base.endsWith('.md') || base.endsWith('.gitkeep')) return true;
  if (path.startsWith('blender/') || path === 'shaders/uv-checker.png') return true;
  return false;
}

function groupFor(path) {
  if (path.startsWith('mediapipe-face-mesh/')) return 'faceMesh';
  if (path.startsWith('models/')) return 'model';
  if (path === 'patterns/patterns.json') return 'catalog';
  const pattern = path.match(/^patterns\/([^/]+)\//);
  if (pattern) return `pattern:${pattern[1]}`;
  if (SHARED_SHADER.has(path)) return SHARED_SHADER.get(path);
  const shader = path.match(/^shaders\/([^/]+)\//);
  if (shader) return SHADER_GROUP.get(shader[1]) ?? `shader:${shader[1]}`;
  return 'other';
}

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
  const info = await stat(path);
  const rel = relative(assetsRoot, path).split('\\').join('/');
  if (excluded(rel) || info.size <= 0) continue;
  const bytes = await readFile(path);
  files.push({
    path: rel,
    size: info.size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    group: groupFor(rel)
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
  delivery: 'remote',
  faceMesh: 'simd',
  patternManifest: 'patterns/patterns.json',
  patternManifestVersion: patterns.version,
  patternCount: Object.values(categoryCounts).reduce((sum, count) => sum + count, 0),
  categoryCounts,
  files
};
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${output} (${files.length} files)`);
