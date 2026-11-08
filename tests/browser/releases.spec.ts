import { test, expect, type Page } from '@playwright/test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startUpgradeServer } from './upgradeServer';
import { releaseManifest } from '../../src/lib/releases';
import { PDFDocument } from 'pdf-lib';

let server: Awaited<ReturnType<typeof startUpgradeServer>>, root: string;
let workerRevision = '';
const first = process.env.RELEASE_BUILD_A, second = process.env.RELEASE_BUILD_B;
const third = process.env.RELEASE_BUILD_C, broken = process.env.RELEASE_BUILD_BROKEN, legacy = process.env.RELEASE_BUILD_LEGACY;
let firstId: string, secondId: string;
test.beforeAll(async () => {
  if (!first || !second || !third || !broken || !legacy) throw new Error('Set RELEASE_BUILD_A/B/C/BROKEN/LEGACY to the qualification artifacts');
  firstId = JSON.parse(await readFile(resolve(first, 'release.json'), 'utf8')).id;
  secondId = JSON.parse(await readFile(resolve(second, 'release.json'), 'utf8')).id;
  expect(firstId).not.toBe(secondId);
  expect(await readFile(resolve(first, 'sw.js'), 'utf8')).toBe(await readFile(resolve(second, 'sw.js'), 'utf8'));
  server = await startUpgradeServer({ root: () => root, workerRevision: () => workerRevision });
  for (const build of [first, second, third, broken, legacy]) server.retain(build);
});
test.afterAll(async () => { await server?.close(); });
test.beforeEach(() => { root = resolve(first!); workerRevision = ''; server.faults.clear(); server.requests.length = 0; });

async function ready(page: Page, id: string) {
  await expect.poll(() => page.evaluate(async id => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.active) return false;
    return new Promise<boolean>(resolve => {
      const channel = new MessageChannel(), timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 2000);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data?.ready === true); };
      registration.active!.postMessage({ type: 'IS_RELEASE_READY', id }, [channel.port2]);
    });
  }, id), { timeout: 120000 }).toBe(true);
}
async function start(page: Page) {
  await page.addInitScript(() => localStorage.setItem('dondocs-welcome-shown', '3.0'));
  await page.goto(server.origin);
  await ready(page, firstId);
  await expect(page.getByText('Compilation complete', { exact: true })).toBeAttached({ timeout: 60000 });
  const subject = page.locator('#subject:visible, #body-subject:visible');
  await subject.fill('RELEASE CHECKPOINT');
  await expect(subject).toHaveValue('RELEASE CHECKPOINT');
  await expect(page.locator('[title^="Saved "]')).toBeVisible({ timeout: 15000 });
}

async function workerRequest(page: Page, message: object, waiting = false) {
  return page.evaluate(async ({ message, waiting }) => {
    const registration = await navigator.serviceWorker.getRegistration();
    const worker = waiting ? registration?.waiting : registration?.active;
    if (!worker) throw new Error('No worker');
    return new Promise<{ ready?: boolean; error?: string }>((resolve, reject) => {
      const channel = new MessageChannel(), timer = setTimeout(() => { channel.port1.close(); reject(new Error('Worker request timed out')); }, 120000);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
      worker.postMessage(message, [channel.port2]);
    });
  }, { message, waiting });
}

async function attachmentBytes(page: Page, seed = false) {
  return page.evaluate(async seed => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      if (seed) await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['documents', 'attachments'], 'readwrite');
        const request = tx.objectStore('documents').getAll();
        request.onsuccess = () => {
          const doc = request.result[0];
          doc.session.enclosures = [{ title: 'Release proof', hasFile: true, fileRef: { id: 'release-proof', name: 'proof.txt', type: 'text/plain', size: 5 } }];
          tx.objectStore('documents').put(doc);
          tx.objectStore('attachments').put({ id: 'release-proof', name: 'proof.txt', type: 'text/plain', size: 5, data: new Uint8Array([0, 1, 2, 254, 255]).buffer });
        };
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      });
      return await new Promise<number[]>((resolve, reject) => {
        const request = db.transaction('attachments').objectStore('attachments').get('release-proof');
        request.onsuccess = () => resolve([...new Uint8Array(request.result.data)]); request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  }, seed);
}

test('keeps the confirmed target when a newer release arrives', async ({ page, context }) => {
  await start(page); root = resolve(second!);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const update = page.getByRole('button', { name: 'Update Available', exact: true });
  await expect(update).toBeVisible({ timeout: 120000 }); await update.click();
  root = resolve(third!);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const thirdId = JSON.parse(await readFile(resolve(third!, 'release.json'), 'utf8')).id;
  await ready(page, thirdId);
  await page.getByRole('button', { name: 'Update Now', exact: true }).click();
  await expect(page.locator('meta[name="dondocs-release"]')).toHaveAttribute('content', secondId);
  await expect(page.locator('#subject:visible, #body-subject:visible')).toHaveValue('RELEASE CHECKPOINT');
  const fresh = await context.newPage(); await fresh.goto(server.origin);
  await expect(fresh.locator('meta[name="dondocs-release"]')).toHaveAttribute('content', thirdId);
});

test('refuses acceptance if staged files were evicted and cannot be fetched again', async ({ page, context }) => {
  await start(page); root = resolve(second!);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const update = page.getByRole('button', { name: 'Update Available', exact: true });
  await expect(update).toBeVisible({ timeout: 120000 });
  const original = await page.evaluate(() => performance.timeOrigin);
  await page.evaluate(() => caches.delete('dondocs-release-files-v1'));
  const manifest = releaseManifest.parse(JSON.parse(await readFile(resolve(second!, 'release.json'), 'utf8')));
  const missing = manifest.assets.find(asset => asset.group === 'shell' && asset.url.endsWith('.js'))!;
  // Firefox's browser offline emulation does not consistently stop worker fetches.
  server.faults.set(missing.url, { status: 503 });
  await context.setOffline(true);
  await update.click(); await page.getByRole('button', { name: 'Update Now', exact: true }).click();
  await expect(page.getByRole('alertdialog', { name: 'Update paused' })).toBeVisible({ timeout: 30000 });
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(original);
  await expect(page.locator('#subject:visible, #body-subject:visible')).toHaveValue('RELEASE CHECKPOINT');
});

test('recovers a hash-valid broken application once without clearing saved data', async ({ page }) => {
  await start(page); root = resolve(broken!);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const update = page.getByRole('button', { name: 'Update Available', exact: true });
  await expect(update).toBeVisible({ timeout: 120000 });
  await page.locator('#subject:visible, #body-subject:visible').fill('RECOVER THIS LAST EDIT');
  await update.click(); await page.getByRole('button', { name: 'Update Now', exact: true }).click();
  await expect(page.locator('meta[name="dondocs-release"]')).toHaveAttribute('content', 'broken');
  await expect(page.locator('meta[name="dondocs-release"]')).toHaveAttribute('content', firstId, { timeout: 30000 });
  await expect(page.locator('#subject:visible, #body-subject:visible')).toHaveValue('RECOVER THIS LAST EDIT');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('dondocs-update-restore'))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('dondocs-failed-release'))).toBe('broken');
  await ready(page, 'broken');
  await expect(page.getByRole('button', { name: 'Update Available', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('meta[name="dondocs-release"]')).toHaveAttribute('content', firstId);
  await expect(page.locator('#subject:visible, #body-subject:visible')).toHaveValue('RECOVER THIS LAST EDIT');
});

test('preserves an unresponsive client’s caches across a transport-worker replacement', async ({ playwright, browserName }) => {
  // Exercise durable browser storage; WebKit's ephemeral contexts discard worker caches on replacement.
  const profile = await mkdtemp(resolve(tmpdir(), 'dondocs-transport-'));
  const context = await playwright[browserName].launchPersistentContext(profile, { viewport: { width: 1440, height: 1000 } });
  try {
    const page = context.pages()[0];
    await start(page);
    const original = await page.evaluate(() => performance.timeOrigin);
    const previousWorker = await page.evaluateHandle(async () => (await navigator.serviceWorker.getRegistration())!.active);
    const manifest = releaseManifest.parse(JSON.parse(await readFile(resolve(first!, 'release.json'), 'utf8')));
    for (const asset of manifest.assets) server.faults.set(asset.url, { status: 503 });
    // This deliberately changes only transport bytes, not the application release.
    workerRevision = 'replacement';
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    await expect.poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      return page.evaluate(async previous => {
        const active = (await navigator.serviceWorker.getRegistration())?.active;
        return active !== previous && active?.state === 'activated';
      }, previousWorker);
    }, { timeout: 20000 }).toBe(true);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(original);
    const restarted = await workerRequest(page, { type: 'IS_RELEASE_READY', id: firstId });
    expect(restarted).toMatchObject({ ready: true });
    // Restore the origin before staging later releases, which may need shared lazy runtimes.
    server.faults.clear();
    const inactive = await context.newPage(); await inactive.goto(`${server.origin}/holding.html`);
    const thirdId = JSON.parse(await readFile(resolve(third!, 'release.json'), 'utf8')).id;
    for (const id of [secondId, thirdId, 'broken']) expect((await workerRequest(page, { type: 'PREPARE_RELEASE', id })).error).toBeUndefined();
    await page.evaluate(() => navigator.serviceWorker.controller!.postMessage({ type: 'COLLECT_RELEASES' }));
    await page.waitForTimeout(2000); // Exceed the worker's explicit client-response deadline.
    expect(await page.evaluate(async id => !!await (await caches.open('dondocs-release-meta-v1')).match('/__dd_release/' + id), secondId)).toBe(true);
    await inactive.close();
    await page.evaluate(() => navigator.serviceWorker.controller!.postMessage({ type: 'COLLECT_RELEASES' }));
    await expect.poll(() => page.evaluate(async id => !!await (await caches.open('dondocs-release-meta-v1')).match('/__dd_release/' + id), secondId)).toBe(false);
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});

test('keeps a legacy editor intact until legacy tabs close, ignoring SKIP_WAITING', async ({ page, context }) => {
  root = resolve(legacy!);
  await page.addInitScript(() => localStorage.setItem('dondocs-welcome-shown', '3.0'));
  await page.goto(server.origin);
  await page.locator('#subject:visible, #body-subject:visible').fill('LEGACY EDITOR');
  await expect(page.locator('[title^="Saved "]')).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // Establish a genuinely legacy-controlled editor before deployment.
  await expect(page.locator('#subject:visible, #body-subject:visible')).toHaveValue('LEGACY EDITOR');
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const original = await page.evaluate(() => performance.timeOrigin);
  root = resolve(first!);
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed');
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.waiting!.postMessage({ type: 'SKIP_WAITING' }));
  const modern = await context.newPage(); await modern.goto(`${server.origin}/releases/${firstId}/index.html`);
  await expect(modern.locator('meta[name="dondocs-release"]')).toHaveAttribute('content', firstId);
  expect((await workerRequest(modern, { type: 'ACTIVATE_WORKER' }, true)).error).toContain('Legacy or inactive tabs');
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(original);
  await expect(page.locator('#subject:visible, #body-subject:visible')).toHaveValue('LEGACY EDITOR');
  await page.close();
  await modern.evaluate(() => window.dispatchEvent(new Event('focus')));
  await ready(modern, firstId);
  await expect(modern.locator('#subject:visible, #body-subject:visible')).toHaveValue('LEGACY EDITOR');
});

test('updates only the accepting tab and reopens the staged release offline', async ({ page, context }) => {
  await start(page);
  const bytes = await attachmentBytes(page, true);
  await page.reload(); // Load the seeded attachment before deploying the new release.
  await expect(page.locator('#subject:visible, #body-subject:visible')).toHaveValue('RELEASE CHECKPOINT');
  await ready(page, firstId);
  const other = await context.newPage(); await other.goto(server.origin);
  await expect(other.locator('#subject:visible, #body-subject:visible')).toHaveValue('RELEASE CHECKPOINT');
  await expect(other.getByText('Compilation complete', { exact: true })).toBeAttached({ timeout: 60000 });
  const original = await page.evaluate(() => performance.timeOrigin);
  root = resolve(second!);
  await other.bringToFront(); await other.evaluate(() => window.dispatchEvent(new Event('focus')));
  const update = other.getByRole('button', { name: 'Update Available', exact: true });
  await expect(update).toBeVisible({ timeout: 120000 });
  await expect(other.getByRole('dialog')).toHaveCount(0);
  await update.click(); await other.getByRole('button', { name: 'Update Now', exact: true }).click();
  await expect(other.locator('meta[name="dondocs-release"]')).toHaveAttribute('content', secondId);
  expect(await attachmentBytes(other)).toEqual(bytes);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(original);
  await expect(page.locator('meta[name="dondocs-release"]')).toHaveAttribute('content', firstId);
  await page.locator('#subject:visible, #body-subject:visible').fill('STILL EDITING THE ORIGINAL');
  await context.setOffline(true);
  await other.reload();
  await expect(other.locator('meta[name="dondocs-release"]')).toHaveAttribute('content', secondId);
  await expect(other.locator('#subject:visible, #body-subject:visible')).toBeVisible();
  expect(await attachmentBytes(other)).toEqual(bytes);
});

test('does not advertise an incomplete release and retries after the origin recovers', async ({ page }) => {
  await start(page);
  const next = releaseManifest.parse(JSON.parse(await readFile(resolve(second!, 'release.json'), 'utf8')));
  const missing = next.assets.find(asset => asset.group === 'shell' && asset.url.endsWith('.js'));
  if (!missing) throw new Error('Missing shell script fixture');
  server.faults.set(missing.url, { status: 503 }); root = resolve(second!);
  const original = await page.evaluate(() => performance.timeOrigin);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => server.requests.some(request => request.path === missing.url && request.status === 503)).toBe(true);
  await expect(page.getByRole('button', { name: 'Update Available', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(original);
  server.faults.clear(); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: 'Update Available', exact: true })).toBeVisible({ timeout: 120000 });
});

test('restores the accepting tab’s last edit when another tab has a different document open', async ({ page, context }) => {
  await start(page);
  const other = await context.newPage(); await other.goto(server.origin);
  await other.getByRole('button', { name: 'New document', exact: true }).click();
  await other.getByRole('menuitem', { name: 'New correspondence', exact: true }).click();
  await other.locator('#subject:visible, #body-subject:visible').fill('OTHER DOCUMENT');
  await expect(other.locator('[title^="Saved "]')).toBeVisible({ timeout: 15000 });
  root = resolve(second!);
  await page.bringToFront(); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const update = page.getByRole('button', { name: 'Update Available', exact: true });
  await expect(update).toBeVisible({ timeout: 120000 });
  await page.locator('#subject:visible, #body-subject:visible').fill('LAST EDIT BEFORE ACCEPTANCE');
  const otherOrigin = await other.evaluate(() => performance.timeOrigin);
  await update.click(); await page.getByRole('button', { name: 'Update Now', exact: true }).click();
  await expect(page.locator('meta[name="dondocs-release"]')).toHaveAttribute('content', secondId);
  await expect(page.locator('#subject:visible, #body-subject:visible')).toHaveValue('LAST EDIT BEFORE ACCEPTANCE');
  expect(await other.evaluate(() => performance.timeOrigin)).toBe(otherOrigin);
  await expect(other.locator('#subject:visible, #body-subject:visible')).toHaveValue('OTHER DOCUMENT');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('dondocs-update-restore'))).toBeNull();
});

test('keeps the page and edit intact when a document write fails during acceptance', async ({ page }) => {
  await start(page); root = resolve(second!);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const update = page.getByRole('button', { name: 'Update Available', exact: true });
  await expect(update).toBeVisible({ timeout: 120000 });
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'documents') throw new DOMException('Test storage failure', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await page.locator('#subject:visible, #body-subject:visible').fill('KEEP THE UNSAVED EDIT');
  const original = await page.evaluate(() => performance.timeOrigin);
  await update.click(); await page.getByRole('button', { name: 'Update Now', exact: true }).click();
  await expect(page.getByRole('alertdialog', { name: 'Update paused' })).toBeVisible();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(original);
  await expect(page.locator('#subject:visible, #body-subject:visible')).toHaveValue('KEEP THE UNSAVED EDIT');
  expect(await page.evaluate(() => sessionStorage.getItem('dondocs-update-restore'))).toBeNull();
  expect(await page.locator('.workspace-shell').getAttribute('inert')).toBeNull();
});

test('preserves settings changed in a draft that is not yet in Recents', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('dondocs-welcome-shown', '3.0'));
  await page.goto(server.origin); await ready(page, firstId);
  await page.getByRole('combobox', { name: 'Document section' }).selectOption('letterhead');
  root = resolve(second!); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const update = page.getByRole('button', { name: 'Update Available', exact: true });
  await expect(update).toBeVisible({ timeout: 120000 });
  await expect(page.getByText('Compilation complete', { exact: true })).toBeAttached({ timeout: 60000 });
  await page.locator('#unitLine1').fill('SETTINGS ONLY UNIT');
  await update.click(); await page.getByRole('button', { name: 'Update Now', exact: true }).click();
  await expect(page.locator('meta[name="dondocs-release"]')).toHaveAttribute('content', secondId);
  await expect(page.locator('#unitLine1')).toHaveValue('SETTINGS ONLY UNIT');
});

test('pauses an update during a PDF read and accepts it after the attachment is saved', async ({ page }) => {
  await start(page);
  await page.getByRole('combobox', { name: 'Document section' }).selectOption('enclosures');
  root = resolve(second!); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const update = page.getByRole('button', { name: 'Update Available', exact: true });
  await expect(update).toBeVisible({ timeout: 120000 });
  await expect(page.getByText('Compilation complete', { exact: true })).toBeAttached({ timeout: 60000 });
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    const waiting = new Promise<void>(resolve => Object.assign(window, { finishFileRead: () => { File.prototype.arrayBuffer = original; resolve(); } }));
    File.prototype.arrayBuffer = async function () { await waiting; return original.call(this); };
  });
  const pdf = await PDFDocument.create(); pdf.addPage();
  await page.getByLabel('Upload enclosure PDFs', { exact: true }).setInputFiles({ name: 'update-proof.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  const original = await page.evaluate(() => performance.timeOrigin);
  await update.click(); await page.getByRole('button', { name: 'Update Now', exact: true }).click();
  await expect(page.getByRole('alertdialog', { name: 'Update paused' })).toBeVisible();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(original);
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.evaluate(() => (window as unknown as { finishFileRead(): void }).finishFileRead());
  await expect(page.getByText('update-proof.pdf', { exact: true }).first()).toBeVisible();
  await expect(page.locator('[title^="Saved "]')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Compilation complete', { exact: true })).toBeAttached({ timeout: 60000 });
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      const transaction = original.apply(this, args);
      if (transaction.mode === 'readonly' && transaction.objectStoreNames.contains('attachments') && document.querySelector('.workspace-shell[inert]')) {
        Object.defineProperty(transaction, 'oncomplete', { set(handler: IDBTransaction['oncomplete']) {
          transaction.addEventListener('complete', event => Object.assign(window, { finishCheckpointRead: () => {
            IDBDatabase.prototype.transaction = original; handler?.call(transaction, event);
          } }));
        } });
      }
      return transaction;
    };
  });
  await update.click(); await page.getByRole('button', { name: 'Update Now', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { finishCheckpointRead?: unknown }).finishCheckpointRead === 'function')).toBe(true);
  await page.keyboard.press('Control+k');
  await expect(page.locator('.workspace-document')).toBeVisible();
  await page.evaluate(() => (window as unknown as { finishCheckpointRead(): void }).finishCheckpointRead());
  await expect(page.locator('meta[name="dondocs-release"]')).toHaveAttribute('content', secondId);
  await expect(page.getByText('update-proof.pdf', { exact: true }).first()).toBeVisible();
});

for (const source of ['legacy cache', 'unindexed request'] as const) test(`preserves offline Word resources (${source})`, async ({ page, context }) => {
  await start(page);
  if (source === 'legacy cache') {
    await page.evaluate(async () => {
      const legacy = await caches.open('pandoc-wasm-review');
      await legacy.put('/lib/pandoc/pandoc.wasm.part0', new Response(new Uint8Array([0])));
    });
  } else {
    await page.reload(); // Establish control before a request for an as-yet unindexed runtime.
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    const url = '/runtimes/unindexed/lib/pandoc/pandoc.wasm.part0';
    server.faults.set(url, { status: 503 });
    expect(await page.evaluate(async url => (await fetch(url)).status, url)).toBe(503);
  }
  root = resolve(second!); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const update = page.getByRole('button', { name: 'Update Available', exact: true });
  await expect(update).toBeVisible({ timeout: 120000 });
  const manifest = releaseManifest.parse(JSON.parse(await readFile(resolve(second!, 'release.json'), 'utf8')));
  const word = manifest.assets.filter(asset => /\/pandoc\.wasm(?:\.part\d+|\.manifest\.json)?$/.test(asset.url));
  expect(word.length).toBeGreaterThan(1);
  expect(word.every(asset => server.requests.some(request => request.path === asset.url && request.status === 200))).toBe(true);
  await expect(page.getByText('Compilation complete', { exact: true })).toBeAttached({ timeout: 60000 });
  for (const asset of word) server.faults.set(asset.url, { status: 503 });
  await context.setOffline(true);
  await update.click(); await page.getByRole('button', { name: 'Update Now', exact: true }).click();
  await expect(page.locator('meta[name="dondocs-release"]')).toHaveAttribute('content', secondId);
  await expect(page.locator('#subject:visible, #body-subject:visible')).toHaveValue('RELEASE CHECKPOINT');
});
