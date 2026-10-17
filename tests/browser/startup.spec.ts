import { test, expect, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

// Two real production builds share an origin, storage, and service-worker scope.
// No application modules or mocked service workers are injected into the page.
let server: Server;
let origin: string;
let root: string;
let workerRevision = '';
test.beforeEach(() => { workerRevision = ''; });
const newBuild = resolve('dist');
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.pdf': 'application/pdf' };

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url!, 'http://localhost').pathname);
      if (pathname === '/holding.html') { res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Worker control</title>'); return; }
      const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
      const bytes = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(pathname === '/sw.js' ? Buffer.concat([bytes, Buffer.from(`\n// upgrade-test-${workerRevision}\n`)]) : bytes);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test server address');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>(done => server.close(() => done())); });

async function readSaved(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('dondocs'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try {
      const tx = db.transaction(['documents', 'attachments'], 'readonly');
      const read = (store: string) => new Promise<unknown[]>((resolve, reject) => { const r = tx.objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const [documents, attachments] = await Promise.all([read('documents'), read('attachments')]);
      return { documents, attachments: attachments.map(value => { const a = value as { id: string; data: ArrayBuffer }; return { id: a.id, bytes: [...new Uint8Array(a.data)] }; }) };
    } finally { db.close(); }
  });
}

test('waits for slow storage initialization before accepting edits', async ({ page }) => {
  root = newBuild;
  await page.addInitScript(() => {
    localStorage.setItem('dondocs-welcome-shown', '3.0');
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args) {
      const request = open.apply(this, args);
      Object.defineProperty(request, 'onsuccess', {
        set(handler: (this: IDBOpenDBRequest, event: Event) => void) {
          request.addEventListener('success', event => setTimeout(() => handler.call(request, event), 2000));
        },
      });
      return request;
    };
  });
  await page.goto(origin);
  await expect(page.getByRole('status', { name: '' }).filter({ hasText: 'Opening your documents' })).toBeVisible();
  await expect(page.locator('#subject')).toHaveCount(0);
  await page.locator('#subject').fill('EDIT AFTER INITIALIZATION');
  await expect(async () => expect(JSON.stringify((await readSaved(page)).documents)).toContain('EDIT AFTER INITIALIZATION')).toPass({ timeout: 15_000 });
  await page.reload();
  await expect(page.locator('#subject')).toHaveValue('EDIT AFTER INITIALIZATION');
});
