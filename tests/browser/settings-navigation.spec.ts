import { test, expect, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Document actions', exact: true })).toBeVisible();
});

async function openWorkspaceTool(page: Page, name: string) {
  const workspace = page.getByRole('button', { name: 'Open workspace', exact: true });
  if (await workspace.isVisible()) await workspace.click();
  await page.getByRole('button', { name, exact: true }).click();
}

async function expectBackupControls(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  const heading = dialog.getByRole('heading', { name: 'Backup & restore', exact: true });
  await heading.scrollIntoViewIfNeeded();
  await expect(heading).toBeInViewport({ ratio: 1 });
  for (const name of ['Download workspace backup', 'Restore from backup']) {
    const button = dialog.getByRole('button', { name, exact: true });
    await button.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await expect(button).toBeInViewport({ ratio: 1 });
    await expect(button).toBeEnabled();
    const contained = await button.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const scroll = element.closest('section')!.parentElement!.getBoundingClientRect();
      return bounds.left >= scroll.left - 1 && bounds.right <= scroll.right + 1
        && bounds.top >= scroll.top - 1 && bounds.bottom <= scroll.bottom + 1;
    });
    expect(contained).toBe(true);
  }
  const overflow = await dialog.evaluate(element => element.scrollWidth > element.clientWidth);
  expect(overflow).toBe(false);
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 320, height: 568 }, { width: 568, height: 320 }]) {
  test.describe(`Settings at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('backup controls remain reachable inside Settings and closing restores keyboard focus', async ({ page }, testInfo) => {
      await openWorkspaceTool(page, 'Settings');
      const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
      await expect(dialog.getByRole('radio', { checked: true })).toBeFocused();
      await expectBackupControls(page);
      await page.screenshot({ path: testInfo.outputPath('settings-backup.png') });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      const workspace = page.getByRole('button', { name: 'Open workspace', exact: true });
      await expect(await workspace.isVisible() ? workspace : page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
    });
  });
}

test('Help and search still open Settings directly at backups', async ({ page }) => {
  await openWorkspaceTool(page, 'Help');
  await page.getByRole('button', { name: 'Backup & restore', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Backup & restore', exact: true })).toBeFocused();
  await expectBackupControls(page);
  await expect(page.getByRole('dialog', { name: 'Help', exact: true })).toBeHidden();
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Command search' }).fill('Backup and restore settings');
  await expect(page.getByRole('option', { name: /^Backup and restore settings/ })).toBeVisible();
  await page.getByRole('combobox', { name: 'Command search' }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Backup & restore', exact: true })).toBeFocused();
  await expectBackupControls(page);
  await expect(page.getByRole('dialog', { name: 'Search workspace', exact: true })).toBeHidden();
});

test('backup tour highlights workspace navigation rather than document actions', async ({ page }, testInfo) => {
  await openWorkspaceTool(page, 'Help');
  await page.getByRole('button', { name: 'Take optional tour', exact: true }).click();
  const title = page.getByRole('heading', { name: 'Download workspace backup', exact: true });
  for (let step = 0; step < 8 && !await title.isVisible(); step++) {
    await page.getByRole('button', { name: 'Next', exact: true }).click();
  }
  await expect(title).toBeVisible();
  const target = page.locator('[data-tour="settings"], [data-tour="workspace-menu"][aria-haspopup="dialog"]').first();
  await expect(target).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('dialog', { name: 'Documents', exact: true })).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('backup-tour.png') });
  await page.keyboard.press('Escape');
  await expect(title).toBeHidden();
});


async function seedLettersWithPdf(page: Page, pdf: Uint8Array, count: number, size: number) {
  // Leave startxref and EOF at the end. Padding between the cross-reference
  // table and startxref is valid PDF whitespace and does not change its offsets.
  const trailer = Buffer.from(pdf).lastIndexOf('startxref');
  expect(trailer).toBeGreaterThan(0);
  return page.evaluate(async ({ bytes, count, size, trailer }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('dondocs');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const original = new Uint8Array(bytes);
      const data = new Uint8Array(size);
      data.fill(32);
      data.set(original.subarray(0, trailer));
      data.set(original.subarray(trailer), size - (original.length - trailer));
      const attachmentIds: string[] = [];
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(['documents', 'attachments'], 'readwrite');
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
        for (let index = 0; index < count; index++) {
          const id = `workspace-limit-${index}`;
          const attachment = { id: crypto.randomUUID(), name: `support-${index}.pdf`, type: 'application/pdf', size };
          attachmentIds.push(attachment.id);
          const subject = `SYNTHETIC WORKSPACE BACKUP ${index}`;
          transaction.objectStore('attachments').put({ ...attachment, data: data.buffer });
          transaction.objectStore('documents').put({
            id, meta: { id, docType: 'naval_letter', title: subject, updatedAt: Date.now() },
            session: {
              documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter', formType: 'navmc_10274',
              formData: { subject }, paragraphs: [{ id: 'example-body', level: 0, text: 'Synthetic support enclosed.' }],
              references: [], enclosures: [{ title: 'Support', hasFile: true, fileRef: attachment }],
              copyTos: [], distributions: [], endItems: [], publicationTables: {}, timestamp: Date.now(),
            },
          });
        }
      });
      return attachmentIds;
    } finally { db.close(); }
  }, { bytes: Array.from(pdf), count, size, trailer });
}

test('auto-backup keeps an existing file intact and writes updates to the new mirror', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'Exercise Chromium file-system handles through the Settings folder action.');
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { value: () => navigator.storage.getDirectory() });
  });
  const original = JSON.stringify({ kind: 'dondocs-backup', version: 5, documents: [] });
  await page.evaluate(async raw => {
    const root = await navigator.storage.getDirectory();
    const existing = await root.getFileHandle('dondocs-backup.json', { create: true });
    const writer = await existing.createWritable();
    await writer.write(raw);
    await writer.close();
  }, original);
  await page.reload();
  const subject = page.getByRole('textbox', { name: 'Subject', exact: true });
  await subject.fill('BACKUP SAFETY TEST');
  await openWorkspaceTool(page, 'Settings');
  const settings = page.getByRole('region', { name: 'Backup & restore', exact: true });
  await settings.getByRole('button', { name: 'Choose auto-backup folder' }).click();
  await expect(settings.getByText(/Auto-backup file: dondocs-backup-2\.json/)).toBeVisible();
  await settings.getByRole('button', { name: 'Update backup file' }).click();
  const savedFiles = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    async function readBackup(name: string) {
      return (await (await root.getFileHandle(name)).getFile()).text();
    }
    return Promise.all([readBackup('dondocs-backup.json'), readBackup('dondocs-backup-2.json')]);
  });
  expect(savedFiles[0]).toBe(original);
  expect(savedFiles[1]).toContain('BACKUP SAFETY TEST');
});

test('workspace backup downloads a restorable PDF enclosure and refuses an oversized collection', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'chromium', 'The full-size IndexedDB fixture is exercised in the desktop Chromium job.');
  test.setTimeout(90_000);
  const source = await PDFDocument.create();
  source.addPage([612, 792]);
  const pdf = await source.save({ useObjectStreams: false });
  const [attachmentId] = await seedLettersWithPdf(page, pdf, 1, pdf.length);
  await page.reload();
  await openWorkspaceTool(page, 'Settings');
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  const download = page.waitForEvent('download');
  await settings.getByRole('button', { name: 'Download workspace backup' }).click();
  const saved = await download;
  expect(await saved.failure()).toBeNull();
  const path = (await saved.path())!;
  const bundle = JSON.parse(await readFile(path, 'utf8'));
  expect(bundle.attachments).toContainEqual(expect.objectContaining({ id: attachmentId, data: Buffer.from(pdf).toString('base64') }));

  const recipient = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const receiving = await recipient.newPage();
    await receiving.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
    await receiving.goto(page.url());
    await openWorkspaceTool(receiving, 'Settings');
    const restore = receiving.getByRole('region', { name: 'Backup & restore', exact: true });
    await restore.getByLabel('Backup file').setInputFiles(path);
    await expect(restore.getByRole('status')).toContainText(/Restored .*1 attachment/);
    const restored = await receiving.evaluate(async id => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('dondocs');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<number[]>((resolve, reject) => {
          const request = db.transaction('attachments').objectStore('attachments').get(id);
          request.onsuccess = () => resolve(Array.from(new Uint8Array(request.result.data)));
          request.onerror = () => reject(request.error);
        });
      } finally { db.close(); }
    }, attachmentId);
    expect(restored).toEqual(Array.from(pdf));
  } finally { await recipient.close(); }

  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperties(window, {
      backupPickerCalls: { value: calls },
      showSaveFilePicker: { value: () => calls.push('destructive picker') },
      showDirectoryPicker: {
        value: async () => {
          calls.push(navigator.userActivation.isActive ? 'folder with user gesture' : 'folder without user gesture');
          return { getFileHandle: () => { calls.push('file requested'); throw new Error('Should stop before touching the file'); } };
        },
      },
    });
  });
  await seedLettersWithPdf(page, pdf, 8, 10_060_000);
  await page.reload();
  await openWorkspaceTool(page, 'Settings');
  let startedDownload = false;
  page.on('download', () => { startedDownload = true; });
  await settings.getByRole('button', { name: 'Download workspace backup' }).click();
  await expect(settings.getByRole('alert')).toContainText('100 MiB restore limit');
  await expect(settings.getByRole('alert')).toContainText('Export draft (.json)');
  await expect(settings.getByRole('button', { name: 'Download workspace backup' })).toBeEnabled();
  expect(startedDownload).toBe(false);

  await settings.getByRole('button', { name: 'Choose auto-backup folder' }).click();
  await expect(settings.getByRole('alert')).toContainText('100 MiB restore limit');
  await expect(settings.getByRole('button', { name: 'Choose auto-backup folder' })).toBeEnabled();
  const pickerCalls = await page.evaluate(() => (window as Window & { backupPickerCalls?: string[] }).backupPickerCalls);
  expect(pickerCalls).toEqual(['folder with user gesture']);
});
