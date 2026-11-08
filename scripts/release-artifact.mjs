import { createHash } from 'node:crypto';
import { readdir, readFile, mkdir, writeFile, rename, copyFile, rm } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';

export async function files(root, prefix = '') {
  const found = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Release contains a symlink: ${name}`);
    if (entry.isDirectory()) found.push(...await files(root, `${name}/`));
    else found.push(name);
  }
  return found.sort();
}

export async function runtimeRevision(root) {
  const hash = createHash('sha256');
  for (const file of (await files(root)).filter(file => /^(lib|tex)\//.test(file))) {
    hash.update(file).update('\0').update(await readFile(join(root, file))).update('\0');
  }
  return hash.digest('hex');
}

export function assetType(file) {
  return ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.wasm': 'application/wasm', '.pdf': 'application/pdf', '.txt': 'text/plain',
    '.tex': 'text/plain', '.sty': 'text/plain', '.cls': 'text/plain', '.cfg': 'text/plain',
  })[extname(file)] ?? (file.startsWith('tex/') || file.startsWith('lib/texlive/') ? 'text/plain' : 'application/octet-stream');
}

export async function packageRelease(root, info) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(info.id) || !/^[a-f0-9]{64}$/.test(info.runtime)) throw new Error('Invalid release build identity');
  const manifest = { schema: 1, id: info.id, version: info.version, createdAt: info.createdAt,
    dataFormat: 1, workerProtocol: 1, entry: `/releases/${info.id}/index.html`, assets: [] };
  const control = /^(?:_headers|_redirects|_routes.json|sw.js|sw-cleanup.js|workbox-[^/]+\.js|manifest.webmanifest|\.release-build.json)$/;
  for (const file of await files(root)) {
    if (control.test(file)) continue;
    const group = /^(lib|tex)\//.test(file) ? 'runtime' : /^templates\/.*\/revisions\//.test(file) ? 'form' : 'shell';
    const encoded = file.split('/').map(encodeURIComponent).join('/');
    const url = group === 'runtime' ? `/runtimes/${info.runtime}/${encoded}` : group === 'form' ? `/${encoded}` : `/releases/${info.id}/${encoded}`;
    const source = join(root, file), target = join(root, decodeURIComponent(url.slice(1)));
    const bytes = await readFile(source);
    manifest.assets.push({ url, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), type: assetType(file), group });
    if (source !== target) { await mkdir(dirname(target), { recursive: true }); await rename(source, target); }
  }
  const json = JSON.stringify(manifest);
  await writeFile(join(root, `releases/${info.id}/release.json`), json);
  await copyFile(join(root, manifest.entry.slice(1)), join(root, 'index.html'));
  await writeFile(join(root, 'release.json'), json);
  await rm(join(root, '.release-build.json'), { force: true });
  return manifest;
}
