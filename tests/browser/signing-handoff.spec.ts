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
