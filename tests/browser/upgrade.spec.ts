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
const oldBuild = process.env.UPGRADE_OLD_BUILD;
const newBuild = resolve('dist');
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.pdf': 'application/pdf' };

test.beforeAll(async () => {
  if (!oldBuild) throw new Error('Set UPGRADE_OLD_BUILD to a production build of the release being upgraded');
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

async function start(page: Page) {
  await page.addInitScript(() => localStorage.setItem('dondocs-welcome-shown', '3.0'));
  await page.goto(origin);
  await page.locator('#subject:visible, #body-subject:visible').fill('UPGRADE BASELINE');
  await expect(async () => expect(JSON.stringify((await readSaved(page)).documents)).toContain('UPGRADE BASELINE')).toPass({ timeout: 15_000 });
  // Add a deterministic attachment to the old release's saved document.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('dondocs'); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['documents', 'attachments'], 'readwrite');
      const request = tx.objectStore('documents').getAll();
      request.onsuccess = () => {
        const doc = request.result[0];
        doc.session.enclosures = [{ title: 'Upgrade attachment', hasFile: true, fileRef: { id: 'upgrade-blob', name: 'proof.txt', type: 'text/plain', size: 5 } }];
        tx.objectStore('documents').put(doc);
        tx.objectStore('attachments').put({ id: 'upgrade-blob', name: 'proof.txt', type: 'text/plain', size: 5, data: new Uint8Array([0, 1, 2, 254, 255]).buffer });
      };
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
    db.close();
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.locator('#subject:visible, #body-subject:visible')).toHaveValue('UPGRADE BASELINE');
}

async function reloadDuringUpdate(page: Page) {
  // The worker can supersede a Playwright navigation request. Trigger a real
  // reload, then require a new document rather than that request's completion.
  let previousDocument = 0;
  await expect(async () => {
    previousDocument = await page.evaluate(() => performance.timeOrigin);
  }).toPass({ timeout: 15_000 });
  try { await page.evaluate(() => window.location.reload()); }
  catch (error) {
    if (!(error instanceof Error) || !/Execution context was destroyed/.test(error.message)) throw error;
  }
  await expect(async () => {
    expect(await page.evaluate(() => performance.timeOrigin)).not.toBe(previousDocument);
  }).toPass({ timeout: 15_000 });
  await expect(page.locator('#subject:visible, #body-subject:visible')).toBeVisible({ timeout: 15_000 });
}

test('old release upgrades with two tabs, committed edits, attachment bytes, and offline reload', async ({ page, context }) => {
  root = resolve(oldBuild!);
  await start(page);
  const other = await context.newPage();
  await other.goto(origin);
  await expect(other.locator('#subject:visible, #body-subject:visible')).toHaveValue('UPGRADE BASELINE');
  const before = await readSaved(page);
  root = newBuild;
  await page.locator('#subject:visible, #body-subject:visible').fill('EDIT JUST BEFORE UPGRADE');
  await expect(async () => expect(JSON.stringify((await readSaved(page)).documents)).toContain('EDIT JUST BEFORE UPGRADE')).toPass({ timeout: 15_000 });
  // The old release must commit before navigation; it has no durable write journal.
  // Already-running legacy code cannot acquire a new release's update handler.
  await reloadDuringUpdate(page);
  await expect(async () => { await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; await r.update(); }); }).toPass({ timeout: 15_000 });
  await expect(async () => expect(JSON.stringify((await readSaved(page)).documents)).toContain('EDIT JUST BEFORE UPGRADE')).toPass({ timeout: 15_000 });
  await reloadDuringUpdate(other);
  await expect(other.locator('#subject:visible, #body-subject:visible')).toHaveValue('EDIT JUST BEFORE UPGRADE');
  await expect(async () => expect((await readSaved(other)).attachments).toEqual(before.attachments)).toPass({ timeout: 15_000 });
  // Claim the newest build before going offline, then prove stored work opens.
  await expect(async () => { await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; r.waiting?.postMessage({ type: 'SKIP_WAITING' }); }); }).toPass({ timeout: 15_000 });
  await reloadDuringUpdate(page);
  const html = await readFile(resolve(newBuild, 'index.html'), 'utf8');
  const newScript = html.match(/type="module"[^>]*src="([^"]+)"/)?.[1];
  expect(newScript).toBeTruthy();
  await expect(page.locator('script[type="module"]')).toHaveAttribute('src', newScript!);
  await context.setOffline(true);
  await reloadDuringUpdate(page);
  await expect(page.locator('#subject:visible, #body-subject:visible')).toHaveValue('EDIT JUST BEFORE UPGRADE');
  expect((await readSaved(page)).attachments).toEqual(before.attachments);
});

test('new release retains an edit across an immediate reload', async ({ page }) => {
  root = newBuild;
  await start(page);
  await page.locator('#subject:visible, #body-subject:visible').fill('PENDING EDIT');
  await page.reload();
  await expect(page.locator('#subject:visible, #body-subject:visible')).toHaveValue('PENDING EDIT');
});

test('recovers a failed write after a reload without losing attachment bytes', async ({ page }) => {
  root = newBuild;
  await start(page);
  const before = await readSaved(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'documents') throw new DOMException('Simulated full storage', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.locator('#subject:visible, #body-subject:visible').fill('RETRY AFTER STORAGE FAILURE');
  await expect(async () => expect(await page.evaluate(() => sessionStorage.getItem('dondocs-pending-writes'))).toContain('RETRY AFTER STORAGE FAILURE')).toPass({ timeout: 15_000 });
  expect(JSON.stringify((await readSaved(page)).documents)).not.toContain('RETRY AFTER STORAGE FAILURE');
  await page.reload();
  await expect(page.locator('#subject:visible, #body-subject:visible')).toHaveValue('RETRY AFTER STORAGE FAILURE');
  expect((await readSaved(page)).attachments).toEqual(before.attachments);
});

test('three tabs preserve repeated conflicts and include each copy in a backup', async ({ page, context }) => {
  root = newBuild;
  await start(page);
  const other = await context.newPage();
  await other.goto(origin);
  await expect(other.locator('#subject:visible, #body-subject:visible')).toHaveValue('UPGRADE BASELINE');
  const third = await context.newPage();
  await third.goto(origin);
  await expect(third.locator('#subject:visible, #body-subject:visible')).toHaveValue('UPGRADE BASELINE');
  await page.locator('#subject:visible, #body-subject:visible').fill('FIRST TAB EDIT');
  await expect(async () => expect(JSON.stringify((await readSaved(page)).documents)).toContain('FIRST TAB EDIT')).toPass({ timeout: 15_000 });
  await other.locator('#subject:visible, #body-subject:visible').fill('SECOND TAB EDIT');
  await other.getByRole('button', { name: 'Document actions', exact: true }).click();
  await expect(other.getByRole('menuitem', { name: /Open recovered copies/ })).toBeVisible({ timeout: 15_000 });
  await other.getByRole('menuitem', { name: /Open recovered copies/ }).click();
  await expect(other.locator('#subject:visible, #body-subject:visible')).toHaveValue('SECOND TAB EDIT');
  await expect(async () => {
    const documents = JSON.stringify((await readSaved(other)).documents);
    expect(documents).toContain('FIRST TAB EDIT');
    expect(documents).toContain('SECOND TAB EDIT');
  }).toPass({ timeout: 15_000 });
  await third.locator('#subject:visible, #body-subject:visible').fill('THIRD TAB EDIT');
  await third.getByRole('button', { name: 'Document actions', exact: true }).click();
  await third.getByRole('menuitem', { name: /Open recovered copies/ }).click();
  await expect(async () => expect(JSON.stringify((await readSaved(third)).documents)).toContain('THIRD TAB EDIT')).toPass({ timeout: 15_000 });
  await other.getByRole('button', { name: 'Backup & restore', exact: true }).click();
  const downloading = other.waitForEvent('download');
  await other.getByRole('button', { name: 'Download workspace backup', exact: true }).click();
  const download = await downloading;
  const backup = JSON.parse(await readFile((await download.path())!, 'utf8'));
  const subjects = backup.documents.map((record: { session: { formData: { subject: string } } }) => record.session.formData.subject);
  expect(subjects).toContain('FIRST TAB EDIT');
  expect(subjects).toContain('SECOND TAB EDIT');
  expect(subjects).toContain('THIRD TAB EDIT');
});

test('an uncontrolled first-install tab reloads after accepting an update', async ({ page, context }) => {
  root = newBuild;
  await page.addInitScript(() => localStorage.setItem('dondocs-welcome-shown', '3.0'));
  await page.goto(origin);
  await page.locator('#subject:visible, #body-subject:visible').fill('FIRST INSTALL EDIT');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  // Keep the old worker in use so the next worker waits for explicit acceptance.
  const controlled = await context.newPage();
  await controlled.goto(`${origin}/holding.html`);
  expect(await controlled.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  // The application deliberately prompts only after the first five seconds.
  await page.waitForTimeout(5100);
  workerRevision = 'next';
  await page.evaluate(async () => { const registration = await navigator.serviceWorker.ready; await registration.update(); });
  await page.getByRole('button', { name: 'Update Now', exact: true }).click();
  await expect(async () => {
    const status = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return { controlled: Boolean(navigator.serviceWorker.controller), waiting: registration.waiting?.state, installing: registration.installing?.state, active: registration.active?.state, pending: sessionStorage.getItem('dondocs-pending-writes'), alert: document.querySelector('[role=alertdialog]')?.textContent };
    });
    expect(status).toMatchObject({ controlled: true });
  }).toPass({ timeout: 15_000 });
  await expect(page.locator('#subject:visible, #body-subject:visible')).toHaveValue('FIRST INSTALL EDIT');
});


test('restoring an older backup keeps another tab’s newer edit and restores attachments', async ({ page, context }) => {
  root = newBuild;
  await start(page);
  await page.getByRole('button', { name: 'Backup & restore', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download workspace backup', exact: true }).click();
  const download = await downloading;
  const backupPath = (await download.path())!;
  const other = await context.newPage();
  await other.goto(origin);
  await other.locator('#subject:visible, #body-subject:visible').fill('NEWER THAN BACKUP');
  await expect(async () => expect(JSON.stringify((await readSaved(other)).documents)).toContain('NEWER THAN BACKUP')).toPass({ timeout: 15_000 });
  await page.getByLabel('Backup file', { exact: true }).setInputFiles(backupPath);
  await expect(page.getByRole('status').filter({ hasText: /Restored 0 docs.*kept 1 newer/ })).toBeVisible();
  await other.reload();
  await expect(other.locator('#subject:visible, #body-subject:visible')).toHaveValue('NEWER THAN BACKUP');
  expect((await readSaved(other)).attachments[0].bytes).toEqual([0, 1, 2, 254, 255]);
});

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
  await expect(page.getByRole('status', { name: '' }).filter({ hasText: 'Opening workspace' })).toBeVisible();
  await expect(page.locator('#subject:visible, #body-subject:visible')).toHaveCount(0);
  await page.locator('#subject:visible, #body-subject:visible').fill('EDIT AFTER INITIALIZATION');
  await expect(async () => expect(JSON.stringify((await readSaved(page)).documents)).toContain('EDIT AFTER INITIALIZATION')).toPass({ timeout: 15_000 });
  await page.reload();
  await expect(page.locator('#subject:visible, #body-subject:visible')).toHaveValue('EDIT AFTER INITIALIZATION');
});
