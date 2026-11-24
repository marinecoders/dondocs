import { test, expect, type Page } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import { startUpgradeServer } from './upgradeServer';

const subject = 'OFFLINE WORD PREPARATION';
const paragraph = 'Synthetic correspondence for offline output verification.';
const isWord = (url: string) => /\/lib\/pandoc\//.test(url);

async function openSettings(page: Page) {
  const workspace = page.getByRole('button', { name: 'Open workspace', exact: true });
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  await expect(workspace.or(settings).first()).toBeVisible();
  if (await workspace.isVisible()) await workspace.click();
  await settings.click();
  return page.getByRole('region', { name: 'Offline exports', exact: true });
}

async function download(page: Page, format: 'PDF' | 'Word (.docx)') {
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await page.getByRole('menuitem', {
    name: format === 'PDF' ? /^Download PDF(?:\s|$)/ : 'Download Word (.docx)',
    exact: format !== 'PDF',
  }).click();
}

test.use({ serviceWorkers: 'allow', viewport: { width: 1440, height: 1000 } });

test('keeps Word resources off the PDF path and exports actual DOCX after offline preparation', async ({ page, context, browserName }) => {
  test.setTimeout(180_000);
  // Use desktop browser projects for PDF downloads and service-worker restart.
  test.skip(test.info().project.name.startsWith('mobile') || test.info().project.name.startsWith('ipad'), 'Desktop offline export workflow.');
  const packagedBuild = process.env.RELEASE_BUILD_A;
  // Firefox can still fetch from the origin through a service worker after setOffline.
  const build = packagedBuild ?? (browserName === 'firefox' ? 'dist' : undefined);
  const server = build && await startUpgradeServer({ root: () => resolve(build) });
  try {
    const url = server ? server.origin : '/';
    const wordRequests: string[] = [];
    context.on('request', request => { if (isWord(request.url())) wordRequests.push(request.url()); });
    await page.addInitScript(() => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { editorLayout: 'scroll' } }));
    });
    await page.goto(url);
    const draft = {
      documentCategory: 'correspondence', documentMode: 'compliant', docType: 'naval_letter',
      formData: { subject, from: 'Training Office', to: 'Training Officer', date: '23 Nov 26', sigLast: 'EXAMPLE', unitLine1: 'TRAINING UNIT', classLevel: 'unclassified' },
      paragraphs: [{ id: 'word-offline-fixture', text: paragraph, level: 0 }],
      references: [], enclosures: [], copyTos: [], distributions: [],
    };
    await page.getByLabel('Import draft file').setInputFiles({
      name: 'offline-word.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)),
    });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    await expect(page.locator('.workspace-preview [title="Document preview"]').first()).toBeAttached({ timeout: 60_000 });

    const savingPdf = page.waitForEvent('download', { timeout: 30_000 });
    await download(page, 'PDF');
    const pdf = await savingPdf;
    expect((await readFile((await pdf.path())!)).subarray(0, 5).toString()).toBe('%PDF-');
    await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active), { timeout: 60_000 }).toBe(true);
    await page.reload();
    await expect(page.locator('.workspace-preview [title="Document preview"]').first()).toBeAttached({ timeout: 60_000 });

    let exports = await openSettings(page);
    await expect(exports.getByRole('status').first()).toHaveText('Ready offline', { timeout: 30_000 });
    await expect(exports.getByRole('status').last()).toHaveText('Not ready offline');
    await expect(exports.getByText(/\d+.*MB to download for Word exports/)).toBeVisible();
    expect(wordRequests).toEqual([]);
    if (server) expect(server.requests.filter(request => isWord(request.path))).toEqual([]);
    await page.keyboard.press('Escape');

    // Firefox's offline emulation does not reliably stop service-worker fetches.
    if (server && browserName === 'firefox') {
      const wordPaths = packagedBuild
        ? (JSON.parse(await readFile(resolve(packagedBuild, 'release.json'), 'utf8')) as { assets: { url: string }[] }).assets.map(asset => asset.url).filter(isWord)
        : (await readdir(resolve('dist/lib/pandoc'))).map(file => `/lib/pandoc/${file}`);
      for (const path of wordPaths) server.faults.set(path, { status: 503 });
    }
    await context.setOffline(true);
    await download(page, 'Word (.docx)');
    await expect(page.getByText(/Word resources are unavailable offline.*prepare Word in Settings/)).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('Escape');
    await context.setOffline(false);
    if (server) server.faults.clear();

    exports = await openSettings(page);
    await exports.getByRole('button', { name: 'Prepare Word offline' }).click();
    await expect(exports.getByRole('status').last()).toHaveText('Ready offline', { timeout: 90_000 });
    await page.keyboard.press('Escape');
    const installedRelease = await page.evaluate(() => document.querySelector<HTMLMetaElement>('meta[name="dondocs-release"]')?.content);
    if (installedRelease) await page.evaluate(async id => {
      // The existing update worker adds Word to its retained release once
      // used. Exercise offline restart with that full release record.
      await new Promise<void>((resolve, reject) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = event => {
          channel.port1.close();
          if (event.data.ready) resolve();
          else reject(new Error(event.data.error ?? 'Release was not prepared.'));
        };
        navigator.serviceWorker.controller!.postMessage({ type: 'PREPARE_RELEASE', id }, [channel.port2]);
      });
    }, installedRelease);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue(subject);

    const savingWord = page.waitForEvent('download', { timeout: 90_000 });
    await download(page, 'Word (.docx)');
    const word = await savingWord;
    expect(word.suggestedFilename()).toMatch(/\.docx$/);
    const zip = await JSZip.loadAsync(await readFile((await word.path())!), { checkCRC32: true });
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain(subject);
    expect(xml).toContain(paragraph);

    // Firefox needs a fresh document after reconnection. Keep a tab open
    // during the handoff in Chromium, where Edge can exit with its last tab.
    if (browserName === 'firefox') await page.close();
    await context.setOffline(false);
    const repairPage = await context.newPage();
    if (!page.isClosed()) await page.close();
    // Suspend background repair before the updater starts so that Settings
    // fetches the evicted part on demand through the real worker.
    if (installedRelease) await repairPage.addInitScript(() => {
      const postMessage = ServiceWorker.prototype.postMessage;
      ServiceWorker.prototype.postMessage = function (message: { type?: string }, transfer?: Transferable[] | StructuredSerializeOptions) {
        if (message?.type === 'PREPARE_RELEASE' || message?.type === 'CHECK_RELEASE') {
          throw new Error('Background update paused during manual retry');
        }
        Reflect.apply(postMessage, this, [message, transfer]);
      };
    });
    await repairPage.goto(server && installedRelease ? `${server.origin}/releases/${installedRelease}/index.html` : url);
    await expect(repairPage.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue(subject);
    await expect.poll(() => repairPage.evaluate(() => navigator.onLine)).toBe(true);
    const evicted = await repairPage.evaluate(async () => {
      if (document.querySelector('meta[name="dondocs-release"]')) {
        const releaseId = document.querySelector<HTMLMetaElement>('meta[name="dondocs-release"]')!.content;
        const state = await (await caches.open('dondocs-release-meta-v1')).match(`/__dd_release/${releaseId}`);
        const manifest = (await state!.json()).manifest as { assets: { url: string; sha256: string }[] };
        const part = manifest.assets.find(asset => asset.url.endsWith('/pandoc.wasm.part0'))!;
        return (await caches.open('dondocs-release-files-v1')).delete(`/__dd_asset/${part.sha256}`);
      }
      const part = '/lib/pandoc/pandoc.wasm.part0';
      let removed = false;
      for (const name of await caches.keys()) {
        if (name.startsWith('pandoc-wasm-cache-')) {
          const deleted = await (await caches.open(name)).delete(part);
          removed = deleted || removed;
        }
      }
      return removed;
    });
    expect(evicted).toBe(true);
    exports = await openSettings(repairPage);
    await expect(exports.getByRole('status').first()).toHaveText('Ready offline');
    await expect(exports.getByRole('status').last()).toHaveText('Not ready offline');

    // Pause the missing Wasm part so the preceding cached assets have had
    // time to report progress. Most resources are still prepared.
    await repairPage.evaluate(() => {
      const originalFetch = window.fetch;
      window.fetch = (...args) => {
        if (String(args[0]).endsWith('/pandoc.wasm.part0')) {
          document.documentElement.dataset.wordRetryPaused = 'yes';
          return new Promise<Response>((resolve, reject) => {
            window.addEventListener('resume-word-test', () => originalFetch(...args).then(resolve, reject), { once: true });
          });
        }
        return originalFetch(...args);
      };
    });
    const estimate = exports.getByText(/MB to download for Word exports/);
    await expect(estimate).toBeVisible();
    const sizeLabel = await estimate.innerText();
    const downloadEstimate = Number.parseFloat(sizeLabel);
    await exports.getByRole('button', { name: 'Prepare Word offline' }).click();
    try {
      await expect(repairPage.locator('html')).toHaveAttribute('data-word-retry-paused', 'yes', { timeout: 45_000 });
      const progress = exports.getByRole('progressbar', { name: 'Word resources downloaded' });
      await expect.poll(async () => progress.evaluate((element: HTMLProgressElement) => (element.max - element.value) / 1_000_000))
        .toBeLessThanOrEqual(downloadEstimate + 0.1);
    } finally {
      await repairPage.evaluate(() => window.dispatchEvent(new Event('resume-word-test')));
    }
    await expect(exports.getByRole('status').last()).toHaveText('Ready offline', { timeout: 90_000 });
  } finally {
    if (server) await server.close();
  }
});

test.describe('offline readiness without a controlling worker', () => {
  test.use({ serviceWorkers: 'block' });

  test('keeps output readiness and download size unknown until the worker can check', async ({ page }) => {
    const build = process.env.RELEASE_BUILD_A;
    const server = build && await startUpgradeServer({ root: () => resolve(build) });
    try {
      await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
      await page.goto(server ? server.origin : '/');
      const exports = await openSettings(page);
      await expect(exports.getByRole('status')).toHaveText(['Readiness unknown', 'Readiness unknown']);
      await expect(exports.getByText('Reopen DonDocs while connected to check offline readiness.')).toBeVisible();
      await expect(exports.getByText(/MB to download/)).toHaveCount(0);
      await expect(exports.getByRole('button', { name: 'Prepare Word offline' })).toHaveCount(0);
    } finally {
      if (server) await server.close();
    }
  });
});

test('prompts to finish updating when the prior release worker cannot check output readiness', async ({ page }) => {
  const build = process.env.RELEASE_BUILD_A;
  test.skip(!build, 'The immutable release worker has its own readiness protocol.');
  const server = await startUpgradeServer({ root: () => resolve(build!) });
  try {
    await page.addInitScript(() => {
      localStorage.setItem('browser-test-visitor', 'returning');
      const postMessage = ServiceWorker.prototype.postMessage;
      ServiceWorker.prototype.postMessage = function (message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) {
        if (message && typeof message === 'object' && 'type' in message && message.type === 'GET_OFFLINE_OUTPUT_STATUS') {
          // This is the previous worker's response to the new command.
          const port = (Array.isArray(transfer) ? transfer : transfer?.transfer)?.find(item => item instanceof MessagePort);
          if (port instanceof MessagePort) port.postMessage({ protocol: 1, error: 'Unsupported release request' });
          return;
        }
        Reflect.apply(postMessage, this, [message, transfer]);
      };
    });
    await page.goto(server.origin);
    await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active), { timeout: 60_000 }).toBe(true);
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    const exports = await openSettings(page);
    await expect(exports.getByRole('status')).toHaveText(['Readiness unknown', 'Readiness unknown']);
    await expect(exports.getByText(/Close other DonDocs tabs.*finish the update and check offline readiness/)).toBeVisible();
    await expect(exports.getByText(/MB to download/)).toHaveCount(0);
    await expect(exports.getByRole('button', { name: 'Prepare Word offline' })).toHaveCount(0);
  } finally {
    await server.close();
  }
});
