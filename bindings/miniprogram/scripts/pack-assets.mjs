import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const repo = resolve(root, '../..');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const destDir = join(repo, 'release');
const staging = join(destDir, `.assets-${version}`);
const archive = join(destDir, `makeup-sdk-miniprogram-assets-${version}.tgz`);

function included(src) {
  const base = src.split('/').pop();
  if (base === 'README.md' || base === 'package.json' || base.endsWith('.d.ts') || base.endsWith('.gitkeep')) return false;
  return true;
}

await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
for (const name of ['mediapipe-face-mesh', 'models', 'patterns', 'shaders']) {
  await cp(join(root, 'assets', name), join(staging, name), { recursive: true, filter: included });
}
await cp(join(root, 'dist/openmakeup-assets.manifest.json'), join(staging, 'openmakeup-assets.manifest.json'));
await mkdir(destDir, { recursive: true });
await new Promise((resolvePromise, reject) => {
  const child = spawn('tar', ['-czf', archive, '-C', staging, '.'], { stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', (code) => (code === 0 ? resolvePromise() : reject(new Error(`tar exited ${code}`))));
});
await rm(staging, { recursive: true, force: true });
const info = await stat(archive);
console.log(`wrote ${archive} (${info.size} bytes)`);
