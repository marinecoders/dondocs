import { test, expect, type Page } from '@playwright/test';
import { documentIdentity } from './documentIdentity';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { startUpgradeServer } from './upgradeServer';

// Two real production builds share an origin, storage, and service-worker scope.
// No application modules or mocked service workers are injected into the page.
let server: Awaited<ReturnType<typeof startUpgradeServer>>;
let origin: string;
let root: string;
let workerRevision = '';
test.beforeEach(() => { workerRevision = '';server?.faults.clear(); });
const oldBuild = process.env.UPGRADE_OLD_BUILD;
const newBuild = resolve('dist');

test.beforeAll(async () => {
  if (!oldBuild) throw new Error('Set UPGRADE_OLD_BUILD to a production build of the release being upgraded');
  server = await startUpgradeServer({ root: () => root, workerRevision: () => workerRevision });
  server.retain(oldBuild);
  origin = server.origin;
});
test.afterAll(async () => { await server.close(); });

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

async function expectBaseline(page: Page) {
  // Concurrent tabs also start preview workers; allow the editor to mount
  // before testing edits and conflicts against the restored document.
  await expect(page.locator('#subject:visible, #body-subject:visible')).toHaveValue('UPGRADE BASELINE', { timeout: 15_000 });
}

async function start(page: Page) {
  await page.addInitScript(() => localStorage.setItem('dondocs-welcome-shown', '3.0'));
  await page.goto(origin);
  const subject = page.locator('#subject:visible, #body-subject:visible');
  await subject.click();
  await expect(subject).toBeFocused();
  await subject.fill('UPGRADE BASELINE');
  await expectBaseline(page);
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
  await expectBaseline(page);
}

async function reloadDuringUpdate(page: Page) {
  // The worker can supersede a Playwright navigation request. Trigger a real
  // reload, then require a new document rather than that request's completion.
  let previousDocument = '';
  await expect(async () => {
    previousDocument = await documentIdentity(page);
  }).toPass({ timeout: 15_000 });
  try { await page.evaluate(() => window.location.reload()); }
  catch (error) {
    if (!(error instanceof Error) || !/Execution context was destroyed/.test(error.message)) throw error;
  }
  await expect(async () => {
    expect(await documentIdentity(page)).not.toBe(previousDocument);
  }).toPass({ timeout: 15_000 });
  await expect(page.locator('#subject:visible, #body-subject:visible')).toBeVisible({ timeout: 15_000 });
}

test('old release upgrades with two tabs, committed edits, attachment bytes, and offline reload', async ({ page, context }) => {
  root = resolve(oldBuild!);
  await start(page);
  const other = await context.newPage();
  await other.goto(origin);
  await expectBaseline(other);
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
  const beforeActivation = await documentIdentity(page);
  await expect(async () => {
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      const worker = registration.waiting ?? registration.installing;
      if (worker?.state === 'installed') worker.postMessage({ type: 'SKIP_WAITING' });
    });
    // Let controllerchange finish the application's reload; a competing manual
    // reload can interrupt it. Each poll returns even during navigation.
    expect(await documentIdentity(page)).not.toBe(beforeActivation);
  }).toPass({ timeout: 15_000 });
  await expect(page.locator('#subject:visible, #body-subject:visible')).toHaveValue('EDIT JUST BEFORE UPGRADE', { timeout: 15_000 });
  const html = await readFile(resolve(newBuild, 'index.html'), 'utf8');
  const newScript = html.match(/type="module"[^>]*src="([^"]+)"/)?.[1];
  expect(newScript).toBeTruthy();
  await expect(page.locator('script[type="module"]')).toHaveAttribute('src', newScript!);
  // Workbox writes the navigation response asynchronously. Go offline only
  // after activation and the online navigation have cached the current shell.
  await expect(async () => {
    const state = await page.evaluate(async script => {
      const registration = await navigator.serviceWorker.ready;
      const state = {
        controlled: navigator.serviceWorker.controller === registration.active,
        installing: registration.installing?.state ?? null,
        waiting: registration.waiting?.state ?? null,
        cachedShell: false,
      };
      for (const name of await caches.keys()) {
        if (!name.startsWith('dondocs-app-shell-')) continue;
        const response = await (await caches.open(name)).match(location.origin + '/');
        if (response && (await response.text()).includes(script)) state.cachedShell = true;
      }
      return state;
    }, newScript!);
    expect(state).toEqual({ controlled: true, installing: null, waiting: null, cachedShell: true });
  }).toPass({ timeout: 15_000 });
  await context.setOffline(true);
  await reloadDuringUpdate(page);
  await expect(page.locator('#subject:visible, #body-subject:visible')).toHaveValue('EDIT JUST BEFORE UPGRADE');
  expect((await readSaved(page)).attachments).toEqual(before.attachments);
});

test('upgraded browser bypasses cached pre-TM templates and compiles TM/IETM online and offline', async ({ page, context }) => {
  root = resolve(oldBuild!);
  // Install the previous release's real worker without loading app scripts.
  await page.goto(`${origin}/holding.html`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  // Keep the old worker in use while the new application loads.
  const legacyTab = await context.newPage();
  await legacyTab.goto(`${origin}/holding.html`);

  // Retain a valid legacy bundle under the URL users already cached. Removing
  // this one template keeps the regression effective even when the PR base
  // already supports TM/IETM. The service worker and renderer are unmodified.
  const source = await readFile(resolve(newBuild, 'lib/latex-templates.js'), 'utf8');
  const legacySource = `${source}\ndelete window.LATEX_TEMPLATES['tex/templates/tm_ietm_front_matter.tex'];\n`;
  await page.evaluate(async source => {
    const cache = await caches.open('engine-core-cache-v1');
    await cache.put('/lib/latex-templates.js?rev=26', new Response(source, { headers: { 'Content-Type': 'text/javascript' } }));
  }, legacySource);
  // Prove the old worker serves the stale entry before switching releases.
  expect(await page.evaluate(async () => (await fetch('/lib/latex-templates.js?rev=26')).text())).toBe(legacySource);

  root = newBuild;
  const revision = createHash('sha256').update(source).digest('hex');
  // The old worker must also fetch the fresh URL successfully before it is
  // replaced. Keep this on the holding page so app-driven update reloads
  // cannot race the draft import or its PDF download.
  const oldWorkerHash = await page.evaluate(async revision => {
    const response = await fetch(`/lib/latex-templates.js?rev=${revision}`);
    const hash = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
    return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }, revision);
  expect(oldWorkerHash).toBe(revision);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register('/sw.js');
    await registration.update();
    const worker = registration.installing ?? registration.waiting ?? registration.active;
    if (!worker) throw new Error('Updated service worker is unavailable');
    await new Promise<void>((resolve, reject) => {
      const check = () => {
        if (worker.state === 'installed') worker.postMessage({ type: 'SKIP_WAITING' });
        if (worker.state === 'activated') resolve();
        if (worker.state === 'redundant') reject(new Error('Updated service worker failed to activate'));
      };
      worker.addEventListener('statechange', check);
      check();
    });
  });
  await page.reload();
  await legacyTab.close();
  await page.addInitScript(() => localStorage.setItem('dondocs-welcome-shown', '3.0'));
  await page.goto(origin);
  await expect(page.locator(`script[src="/lib/latex-templates.js?rev=${revision}"]`)).toBeAttached({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { LATEX_TEMPLATES?: Record<string, string> }).LATEX_TEMPLATES?.['tex/templates/tm_ietm_front_matter.tex']))).toBe(true);

  // Import through the public UI, then verify real SwiftLaTeX download bytes.
  // All identifiers and contact details below are fictional test data.
  const draft = {
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'tm_ietm_front_matter',
    paragraphs: [], references: [], enclosures: [], copyTos: [],
    formData: {
      docType: 'tm_ietm_front_matter', subject: 'PORTABLE TEST EQUIPMENT', nomenclature: 'CONTROLLER, Portable Test',
      shortTitle: 'TM 00000A-10/1', pcn: '00000000000', date: '30 Oct 26', publicationSigningDate: '2026-10-30',
      fontSize: '10pt', fontFamily: 'times', signatureType: 'digital', classLevel: 'unclassified', cuiDistStatement: 'A',
      unitLine1: 'TEST PROGRAM OFFICE', unitLine2: '', unitAddress: '123 Example Road\nQuantico, VA 22134',
      sigFirst: 'A.', sigLast: 'SAMPLE', sigTitle: 'Program Manager', controllingOffice: 'Test Program Office', byDirection: false,
      manualFrontMatter: {
        subtype: 'ietm', authorityBasis: 'pm_or_above', rightsAssessment: 'not_required',
        contentContact: 'Test Program Office, sample@example.usmc.mil.',
        endItems: [{ rowId: 'cache-test', nsn: '', tamcn: '', id: 'TEST-001', model: 'MODEL-1' }],
      },
    },
  };
  await page.getByLabel('Import draft file', { exact: true }).setInputFiles({ name: 'manual.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();

  async function downloadManual() {
    await expect(page.locator('.workspace-preview [title="Document preview"]').first()).toBeAttached({ timeout: 60_000 });
    await expect(page.locator('.workspace-preview [aria-live="polite"]')).toHaveText('Compilation complete', { timeout: 60_000 });
    await expect(page.locator('.workspace-preview').getByText('of 2', { exact: true })).toBeAttached({ timeout: 60_000 });
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Download PDF(?:\s|$)/ }).click();
    const download = await downloading;
    expect(await download.failure()).toBeNull();
    const bytes = await readFile((await download.path())!);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
    try {
      expect(pdf.numPages).toBe(2);
      const text = await (await pdf.getPage(1)).getTextContent();
      expect(text.items.map(item => 'str' in item ? item.str : '').join(' ')).toContain('INTERACTIVE ELECTRONIC TECHNICAL MANUAL');
    } finally { await pdf.destroy(); }
  }
  const preview = page.getByRole('button', { name: 'Preview', exact: true });
  if (await preview.getAttribute('aria-pressed') !== 'true') await preview.click();
  await downloadManual();

  // Warm caches must also support the next offline load with a fresh engine.
  await page.reload();
  // Cache the new shell online before disconnecting.
  await expect(page.locator('.workspace-preview [title="Document preview"]').first()).toBeAttached({ timeout: 60_000 });
  await page.context().setOffline(true);
  await page.reload();
  await downloadManual();
});

test('production worker serves content-versioned templates on first offline use', async ({ page, context }) => {
  root = newBuild;
  // Install without running the app, so no template runtime cache is warmed.
  await page.goto(`${origin}/holding.html`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const source = await readFile(resolve(newBuild, 'lib/latex-templates.js'));
  const revision = createHash('sha256').update(source).digest('hex');
  await context.setOffline(true);
  const result = await page.evaluate(async revision => {
    const response = await fetch(`/lib/latex-templates.js?rev=${revision}`);
    const hash = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
    return { status: response.status, hash: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('') };
  }, revision);
  expect(result).toEqual({ status: 200, hash: revision });
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
  await expectBaseline(other);
  const third = await context.newPage();
  await third.goto(origin);
  await expectBaseline(third);
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
  await other.getByRole('button', { name: 'Settings', exact: true }).click();
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
  const sidebar = page.getByRole('navigation', { name: 'Documents', exact: true });
  const profiles = sidebar.getByRole('button', { name: 'Profiles', exact: true });
  const beforeProfiles = await profiles.boundingBox();
  workerRevision = 'next';
  await page.evaluate(async () => { const registration = await navigator.serviceWorker.ready; await registration.update(); });
  const update = page.getByRole('button', { name: 'Update Available', exact: true });
  await expect(update).toBeVisible();
  expect(await profiles.boundingBox()).toEqual(beforeProfiles);
  const listBounds = await sidebar.locator('.overflow-y-auto').last().boundingBox();
  const updateBounds = await update.boundingBox();
  if (!listBounds || !updateBounds) throw new Error('Missing update control or document list');
  expect(listBounds.y + listBounds.height).toBeLessThanOrEqual(updateBounds.y);
  const beforeUpdate = await documentIdentity(page);
  await page.waitForTimeout(6000);
  expect(await documentIdentity(page)).toBe(beforeUpdate);
  await expect(page.getByRole('dialog', { name: 'Update Available', exact: true })).toHaveCount(0);
  await update.click();
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
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
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


test('runtime deployment policy refreshes without a rebuild and remains available offline', async ({ page, context }) => {
  root = newBuild;
  server.faults.set('/classification.config.json', { status: 200, body: 'null', contentType: 'application/json' });
  await page.goto(`${origin}/holding.html`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const readPolicy = () => page.evaluate(async () => (await fetch('/classification.config.json?deployment-policy=runtime', { cache: 'no-cache' })).json());
  expect(await readPolicy()).toBeNull();
  const updated = { maxLevel: 'secret', allowedLevels: ['unclassified', 'secret'] };
  server.faults.set('/classification.config.json', { status: 200, body: JSON.stringify(updated), contentType: 'application/json' });
  expect(await readPolicy()).toEqual(updated);
  await context.setOffline(true);
  try { expect(await readPolicy()).toEqual(updated); }
  finally { await context.setOffline(false); }
});
