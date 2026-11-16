import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { signingPdfDownload } from '../_helpers/signingBrowser';

test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);
async function pdfBytes(text: string) {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([400, 600]).drawText(text, { x: 20, y: 500, font, size: 12 });return Buffer.from(await pdf.save());
}
async function openSigning(page: Page) {
  await page.getByRole('button', { name: 'Download', exact: true }).click();await page.getByRole('menuitem', { name: 'Signing workspace', exact: true }).click();
  return page.getByRole('dialog', { name: 'Signing workspace', exact: true });
}
async function startHandoff(page: Page) {
  await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));await page.goto('/');
  const dialog = await openSigning(page), source = await pdfBytes('SYNTHETIC SIGNING RETURN SOURCE');
  await dialog.getByLabel('Unsigned PDF for signing').setInputFiles({ name: 'Same name.pdf', mimeType: 'application/pdf', buffer: source });
  await expect(dialog.getByText('Exact source PDF saved. Add the fields you need.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add signature box', exact: true }).click();
  await dialog.getByLabel('Signer name', { exact: true }).fill('TRAINING SIGNER');
  await dialog.getByRole('checkbox', { name: /^I reviewed every page,/ }).check();
  await dialog.getByRole('button', { name: 'Save exact signing handoff', exact: true }).click();
  await expect(dialog.getByText('Exact signing handoff saved. Download it when you are ready to share.')).toBeVisible();
  const saving = page.waitForEvent('download');await dialog.getByRole('button', { name: 'Download handoff 1', exact: true }).click();
  const zip = await JSZip.loadAsync(await readFile((await (await saving).path())!));
  return { dialog, source, handoff: await zip.file('ready-to-sign.pdf')!.async('nodebuffer'), manifest: JSON.parse(await zip.file('manifest.json')!.async('string')) };
}
test('associates a returned PDF, preserves its bytes through reload and transfers it to another browser', async ({ page, browser }, info) => {
  const { dialog, source, handoff } = await startHandoff(page);
  const returned = await PDFDocument.load(handoff);
  // Structural signature fixture: the UI must continue to say authenticity is unverified.
  returned.getForm().getFields()[0].acroField.dict.set(PDFName.of('V'), returned.context.obj({ Type: 'Sig', ByteRange: [0, 0, 0, 0] }));
  const bytes = Buffer.from(await returned.save());
  await dialog.getByLabel('Returned PDF', { exact: true }).setInputFiles({ name: 'Returned.pdf', mimeType: 'application/pdf', buffer: bytes });
  await expect(dialog.getByRole('status')).toContainText('Page geometry, content streams and the handoff marker agree.');
  await dialog.getByRole('button', { name: 'View exact handoff', exact: true }).click();
  await expect(dialog.getByLabel('Exact handoff PDF', { exact: true }).locator('canvas').first()).toBeVisible();
  await dialog.getByRole('button', { name: 'View returned file', exact: true }).click();
  await expect(dialog.getByLabel('Candidate returned PDF', { exact: true }).locator('canvas').first()).toBeVisible();
  await dialog.getByRole('checkbox', { name: /^I compared every page/ }).check();
  await dialog.getByRole('button', { name: 'Associate returned PDF', exact: true }).click();
  await expect(dialog.getByText(/Return 1: Returned.pdf · associated, signer authenticity unverified/)).toBeVisible();
  await page.reload();const reopened = await openSigning(page);
  await reopened.getByRole('button', { name: 'Preview saved return 1', exact: true }).click();
  await reopened.getByRole('checkbox', { name: /^I reviewed this retained returned PDF/ }).check();
  expect(await signingPdfDownload(page, info.project.name, () => reopened.getByRole('button', { name: 'Download unchanged returned PDF', exact: true }).click())).toEqual(bytes);
  await reopened.getByRole('checkbox', { name: /^I reviewed every page,/ }).check();
  const backup = page.waitForEvent('download');await reopened.getByRole('button', { name: 'Download signing record', exact: true }).click();
  const portable = await readFile((await (await backup).path())!), record = JSON.parse(portable.toString());
  expect(Buffer.from(record.source.data, 'base64')).toEqual(source);expect(Buffer.from(record.handoffs[0].pdf.data, 'base64')).toEqual(handoff);
  expect(record.returns[0].status).toBe('associated-unverified');expect(record.returns[0].pdf.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    await context.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
    const receiver = await context.newPage();await receiver.goto('/');const imported = await openSigning(receiver);
    await imported.getByLabel('Import signing record').setInputFiles({ name: 'returned-record.json', mimeType: 'application/json', buffer: portable });
    await expect(imported.getByText(/Return 1: Returned.pdf · associated, signer authenticity unverified/)).toBeVisible();
  } finally { await context.close(); }
});
test('requires an explicit mismatch decision for a different PDF with the same filename and forged marker', async ({ page }) => {
  const { dialog, manifest } = await startHandoff(page), wrong = await PDFDocument.load(await pdfBytes('A DIFFERENT DOCUMENT'));
  wrong.setKeywords([`DonDocs handoff ${manifest.handoffId}`]);
  await dialog.getByLabel('Returned PDF', { exact: true }).setInputFiles({ name: 'Same name.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await wrong.save()) });
  await expect(dialog.getByRole('status')).toContainText('The returned file differs');
  await dialog.getByRole('checkbox', { name: /^I compared every page/ }).check();
  await expect(dialog.getByRole('button', { name: 'Associate returned PDF', exact: true })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /^I understand this file is unchanged/ }).check();
  await dialog.getByRole('button', { name: 'Associate returned PDF', exact: true }).click();
  await expect(dialog.getByText(/Return 1: Same name.pdf · associated, signer authenticity unverified/)).toBeVisible();
});
