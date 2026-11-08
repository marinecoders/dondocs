import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { assetType } from '../../scripts/release-artifact.mjs';

interface Fault { status?: number; body?: string; contentType?: string; delayMs?: number }

/** Same-origin deployments with origin headers, retained immutable files, and explicit faults. */
export async function startUpgradeServer(options: { root: () => string; workerRevision?: () => string }) {
  const retained = new Set<string>();
  const faults = new Map<string, Fault>();
  const requests: { path: string; status: number }[] = [];
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url!, 'http://localhost').pathname);
      if (pathname === '/holding.html') {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }).end('<!doctype html><title>Worker control</title>');
        return;
      }
      const fault = faults.get(pathname);
      if (fault?.delayMs) await new Promise(done => setTimeout(done, fault.delayMs));
      const relative = pathname === '/' ? '/index.html' : pathname;
      const immutable = /^\/(?:assets\/|releases\/|runtimes\/|templates\/.*\/revisions\/)/.test(pathname);
      let bytes: Buffer | undefined;
      for (const root of [resolve(options.root()), ...(immutable ? retained : [])]) {
        const file = resolve(root, `.${relative}`);
        if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
        try { bytes = await readFile(file); break; } catch { /* Try an explicitly retained build. */ }
      }
      if (fault?.body !== undefined) bytes = Buffer.from(fault.body);
      if (!bytes && !fault?.status) { requests.push({ path: pathname, status: 404 }); res.writeHead(404).end(); return; }
      bytes ??= Buffer.alloc(0);
      if (pathname === '/sw.js' && options.workerRevision) bytes = Buffer.concat([bytes, Buffer.from(`\n// upgrade-test-${options.workerRevision()}\n`)]);
      const etag = `"${createHash('sha256').update(bytes).digest('hex')}"`;
      const status = fault?.status ?? (req.headers['if-none-match'] === etag ? 304 : 200);
      requests.push({ path: pathname, status });
      res.writeHead(status, {
        'Content-Type': fault?.contentType ?? assetType(relative.replace(/^\/(?:releases|runtimes)\/[^/]+\//, '').replace(/^\//, '')),
        'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache, must-revalidate',
        ETag: etag,
      }).end(status === 304 ? undefined : bytes);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No upgrade test server address');
  return {
    origin: `http://127.0.0.1:${address.port}`, faults, requests,
    retain: (root: string) => { retained.add(resolve(root)); },
    close: () => new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())),
  };
}
