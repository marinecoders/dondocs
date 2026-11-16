import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);
test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning')); });
test('downloads an immutable handoff and transfers its exact source and placements to a fresh browser', async ({ page, browser }) => {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([400, 600]).drawText('SYNTHETIC HANDOFF SOURCE', { x: 20, y: 500, font, size: 12 });
  const source = Buffer.from(await pdf.save());
  await page.goto('/');
  await page.getByRole('button', { name: 'Download', exact: true }).click();await page.getByRole('menuitem', { name: 'Signing workspace', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Signing workspace', exact: true });
  await dialog.getByLabel('Unsigned PDF for signing').setInputFiles({ name: 'Handoff.pdf', mimeType: 'application/pdf', buffer: source });
  await expect(dialog.getByText('Exact source PDF saved. Add the fields you need.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add signature box', exact: true }).click();
  await dialog.getByLabel('Signer name', { exact: true }).fill('ORIGINAL SIGNER');await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Save exact signing handoff', exact: true }).click();
  await expect(dialog.getByText('Exact signing handoff saved. Download it when you are ready to share.')).toBeVisible();
  const handoffDownload = page.waitForEvent('download');await dialog.getByRole('button', { name: 'Download handoff 1', exact: true }).click();
  const zip = await JSZip.loadAsync(await readFile((await (await handoffDownload).path())!));
  const handoffBytes = await zip.file('ready-to-sign.pdf')!.async('nodebuffer'), manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  expect(createHash('sha256').update(handoffBytes).digest('hex')).toBe(manifest.pdfSha256);
  expect(manifest.sourceSha256).toBe(createHash('sha256').update(source).digest('hex'));
  await dialog.getByLabel('Signer name', { exact: true }).fill('LATER SIGNER');
  await dialog.getByRole('button', { name: 'Save signature placement', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Signature placement saved in this browser.');await dialog.getByRole('checkbox').check();
  const portableDownload = page.waitForEvent('download');await dialog.getByRole('button', { name: 'Download signing record', exact: true }).click();
  const portable = await readFile((await (await portableDownload).path())!);
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    await context.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
    const receiver = await context.newPage();await receiver.goto('/');
    await receiver.getByRole('button', { name: 'Download', exact: true }).click();await receiver.getByRole('menuitem', { name: 'Signing workspace', exact: true }).click();
    const imported = receiver.getByRole('dialog', { name: 'Signing workspace', exact: true });
    await imported.getByLabel('Import signing record').setInputFiles({ name: 'signing.json', mimeType: 'application/json', buffer: portable });
    await expect(imported.getByText('Signing record imported with its exact saved PDFs.')).toBeVisible();
    await expect(imported.getByLabel('Signer name', { exact: true })).toHaveValue('LATER SIGNER');
    await expect(imported.getByText('Signers: ORIGINAL SIGNER', { exact: true })).toBeVisible();await imported.getByRole('checkbox').check();
    const again = receiver.waitForEvent('download');await imported.getByRole('button', { name: 'Download handoff 1', exact: true }).click();
    const reopenedZip = await JSZip.loadAsync(await readFile((await (await again).path())!));
    expect(await reopenedZip.file('ready-to-sign.pdf')!.async('nodebuffer')).toEqual(handoffBytes);
  } finally { await context.close(); }
});

test('captures the current draft through the reviewed PDF export pipeline', async ({ page }) => {
  await page.goto('/');
  const preview = page.getByRole('button', { name: 'Preview', exact: true });
  const mobile = await preview.getAttribute('aria-haspopup') === 'dialog';
  if (mobile || await preview.getAttribute('aria-pressed') !== 'true') await preview.click();
  await expect(page.locator('[data-pdf-layer="active"] canvas').first()).toBeVisible({ timeout: 60_000 });
  if (mobile) await page.getByRole('button', { name: 'Close preview', exact: true }).click();
  await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('SYNTHETIC SIGNING CAPTURE');
  await page.getByRole('textbox', { name: 'Paragraph 1', exact: true }).fill('Fictional training text for the exact signing capture.');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Prepare current draft for signing', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Signing workspace', exact: true });
  await expect(dialog.getByText(/Captured draft:/)).toBeVisible({ timeout: 90_000 });
  await dialog.getByRole('checkbox').check();
  const saving = page.waitForEvent('download');await dialog.getByRole('button', { name: 'Download signing record', exact: true }).click();
  const record = JSON.parse(await readFile((await (await saving).path())!, 'utf8'));
  expect(record.sourceRevision.documentId).toBeTruthy();expect(record.sourceRevision.editSequence).toBeGreaterThan(0);
  expect(record.source.sha256).toBe(createHash('sha256').update(Buffer.from(record.source.data, 'base64')).digest('hex'));
  expect((await PDFDocument.load(Buffer.from(record.source.data, 'base64'))).getPageCount()).toBeGreaterThan(0);
});

test('keeps healthy records usable while damaged entries can be recovered and explicitly removed', async ({ page }) => {
  const pdf = await PDFDocument.create();pdf.addPage([400, 600]);const bytes = Buffer.from(await pdf.save());
  await page.goto('/');await page.getByRole('button', { name: 'Download', exact: true }).click();await page.getByRole('menuitem', { name: 'Signing workspace', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Signing workspace', exact: true });
  await dialog.getByLabel('Unsigned PDF for signing').setInputFiles({ name: 'Healthy.pdf', mimeType: 'application/pdf', buffer: bytes });
  await expect(dialog.getByText('Exact source PDF saved. Add the fields you need.')).toBeVisible();
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const opening = indexedDB.open('dondocs');opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result, transaction = db.transaction('app', 'readwrite'), store = transaction.objectStore('app');
      const request = store.getAll(IDBKeyRange.bound('signing-workspace:', 'signing-workspace:\uffff'));
      request.onsuccess = () => { const damaged = structuredClone(request.result[0].value);damaged.id = crypto.randomUUID();damaged.source.sha256 = '0'.repeat(64);store.put({ key: `signing-workspace:${damaged.id}`, value: damaged }); };
      transaction.oncomplete = () => { db.close();resolve(); };transaction.onerror = () => reject(transaction.error);
    };
  }));
  await page.reload();await page.getByRole('button', { name: 'Download', exact: true }).click();await page.getByRole('menuitem', { name: 'Signing workspace', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Unreadable signing records', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Add signature box', exact: true })).toBeEnabled();
  const saving = page.waitForEvent('download');await dialog.getByRole('button', { name: 'Download recovery data 1', exact: true }).click();
  const recovery = JSON.parse(await readFile((await (await saving).path())!, 'utf8'));
  expect(Buffer.from(recovery.source.data, 'base64')).toEqual(bytes);expect(recovery.source.sha256).toBe('0'.repeat(64));
  await dialog.getByRole('button', { name: 'Remove unreadable record 1', exact: true }).click();
  const confirmation = page.getByRole('alertdialog', { name: 'Remove unreadable signing record?', exact: true });
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Unreadable signing records', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove unreadable record 1', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Remove unreadable record', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Unreadable signing records', exact: true })).not.toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Add signature box', exact: true })).toBeEnabled();
});
