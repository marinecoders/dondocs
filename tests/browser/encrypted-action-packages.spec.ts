import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { randomBytes, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(120_000);
const NOW = Date.UTC(2026, 10, 15, 12);
const PASSWORD = 'synthetic-package-password';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function initialize(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: 'light', editorLayout: 'scroll' } }));
  });
  await page.clock.install({ time: NOW });
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
}
async function packages(page: Page) {
  const drawer = page.getByRole('dialog', { name: 'Documents', exact: true });
  if (!(await drawer.isVisible())) await page.getByRole('button', { name: 'Open workspace', exact: true })
    .or(page.getByRole('button', { name: /^Packages(?:\s|$)/ })).first().click();
  if (await drawer.isVisible()) await drawer.getByRole('button', { name: /^Packages(?:\s|$)/ }).click();
  return page.getByRole('dialog', { name: 'Action packages', exact: true });
}
async function openShare(page: Page, input: string | Buffer, password = PASSWORD) {
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open from share link', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Open shared document', exact: true });
  if (typeof input === 'string') await dialog.getByLabel('Share link', { exact: true }).fill(input);
  else await dialog.getByLabel('Encrypted share file', { exact: true }).setInputFiles({ name: 'package.encrypted.json', mimeType: 'application/json', buffer: input });
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Decrypt and review', exact: true }).click();
  return page.getByRole('dialog');
}
async function generate(page: Page) {
  const modal = page.getByRole('dialog', { name: 'Action packages', exact: true });
  await modal.getByRole('button', { name: 'Share encrypted package', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Share action package', exact: true });
  await dialog.getByLabel('Package password', { exact: true }).fill(PASSWORD);
  await dialog.getByLabel('Package expiration', { exact: true }).selectOption('hour');
  await dialog.getByRole('checkbox', { name: /^I reviewed every included member/ }).check();
  await dialog.getByRole('button', { name: 'Generate encrypted package', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Download encrypted package file', exact: true })).toBeVisible();
  return dialog;
}

test('encrypted package link and file preserve reviewed content across fresh browser import and reload', async ({ page, browser, baseURL }, info) => {
  // This full flow includes real rendering, password/tamper/expiry checks, reload and downloads.
  test.setTimeout(180_000);
  await initialize(page);
  await page.getByLabel('Import draft file', { exact: true }).setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'ENCRYPTED PACKAGE SOURCE', classLevel: 'unclassified', unitLine1: 'FICTIONAL TRAINING UNIT', from: 'Training Office', to: 'Training Officer', date: '15 Nov 26', ssic: '1000', serial: '001', sigFirst: 'Alex', sigLast: 'Example' }, paragraphs: [{ text: 'Synthetic package content. See enclosure (1).', level: 0 }], references: [], enclosures: [], copyTos: [],
  })) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  let modal = await packages(page);
  await modal.getByLabel('Package name', { exact: true }).fill('Encrypted training action');
  await modal.getByRole('button', { name: 'Create package', exact: true }).click();
  await modal.getByRole('button', { name: 'Capture current document', exact: true }).click();
  await expect(modal.getByRole('heading', { name: '1. ENCRYPTED PACKAGE SOURCE', exact: true })).toBeVisible();
  let dialog = await generate(page);
  const link = await dialog.getByLabel('Encrypted package link', { exact: true }).inputValue();
  expect(link.length).toBeLessThanOrEqual(8000);
  await dialog.getByRole('button', { name: 'Close sharing', exact: true }).click();
  // A valid original with incompressible metadata forces the file fallback.
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.setSubject(randomBytes(24_000).toString('hex'));
  const original = Buffer.from(await pdf.save());
  await modal.getByLabel('New member role', { exact: true }).selectOption('enclosure');
  await modal.getByRole('checkbox', { name: 'Uploaded original is signed (preserve unchanged)', exact: true }).check();
  await modal.getByLabel('Add original PDF', { exact: true }).setInputFiles({ name: 'signed-original.pdf', mimeType: 'application/pdf', buffer: original });
  await expect(modal.getByText('Signed original PDF', { exact: false })).toBeVisible();
  await modal.getByRole('button', { name: 'Check readiness and assemble', exact: true }).click();
  await expect(modal.getByRole('heading', { name: 'Package readiness: ready', exact: true })).toBeVisible();
  await modal.getByRole('checkbox', { name: /^I reviewed every included member/ }).check();
  await modal.getByRole('button', { name: 'Assemble and retain PDF', exact: true }).click();
  await expect(modal.getByRole('status')).toContainText('Assembled PDF retained.', { timeout: 60_000 });
  await modal.getByRole('button', { name: 'Download retained PDF', exact: true }).click();
  await modal.getByRole('checkbox', { name: /^I reviewed every included member/ }).check();
  const retainedPending = page.waitForEvent('download');
  await modal.getByRole('button', { name: 'Download reviewed retained PDF', exact: true }).click();
  const retained = await readFile((await (await retainedPending).path())!);
  dialog = await generate(page);
  await expect(dialog).toContainText('too large for a reliable link');
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download encrypted package file', exact: true }).click();
  const download = await pending;
  const encrypted = await readFile((await download.path())!);
  expect(encrypted.toString()).not.toContain('ENCRYPTED PACKAGE SOURCE');
  await download.saveAs(info.outputPath(download.suggestedFilename()));

  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  const receiver = await context.newPage();
  try {
    await initialize(receiver);
    await receiver.getByRole('textbox', { name: 'Subject', exact: true }).fill('RECEIVER DRAFT PRESERVED');
    await receiver.clock.runFor(2_000);
    await expect(receiver.getByRole('banner').getByText(/^Saved(?:\s|$)/)).toBeVisible();
    let review = await openShare(receiver, encrypted, 'wrong-password');
    await expect(review.getByRole('alert')).toBeVisible();
    await review.getByRole('button', { name: 'Cancel', exact: true }).click();
    const tampered = JSON.parse(encrypted.toString());
    const index = Math.floor(tampered.payload.length / 2);
    tampered.payload = tampered.payload.slice(0, index) + (tampered.payload[index] === 'A' ? 'B' : 'A') + tampered.payload.slice(index + 1);
    review = await openShare(receiver, Buffer.from(JSON.stringify(tampered)));
    await expect(review.getByRole('alert')).toBeVisible();
    await review.getByRole('button', { name: 'Cancel', exact: true }).click();
    await receiver.goto('about:blank');
    await receiver.goto(link); // A full navigation exercises initial hash dispatch.
    review = receiver.getByRole('dialog', { name: 'Open shared document', exact: true });
    await review.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await review.getByRole('button', { name: 'Decrypt and review', exact: true }).click();
    review = receiver.getByRole('dialog');
    await expect(review.getByRole('heading', { name: 'Review shared action package', exact: true })).toBeVisible();
    await expect(review).not.toContainText('signed-original.pdf'); // exact earlier selected revision
    await expect(review.getByRole('button', { name: 'Open reviewed package', exact: true })).toBeDisabled();
    await review.getByRole('checkbox', { name: /^I reviewed every included member/ }).check();
    await receiver.clock.setFixedTime(NOW + 3_600_000);
    await review.getByRole('button', { name: 'Open reviewed package', exact: true }).click();
    await expect(review.getByRole('alert')).toContainText('expired');
    await review.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(receiver.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('RECEIVER DRAFT PRESERVED');
    review = await openShare(receiver, encrypted);
    await expect(review.getByRole('alert')).toContainText('expired');
    await review.getByRole('button', { name: 'Cancel', exact: true }).click();
    await receiver.clock.setFixedTime(NOW);
    modal = await packages(receiver);
    await modal.getByLabel('Import editable package', { exact: true }).setInputFiles({ name: 'package.encrypted.json', mimeType: 'application/json', buffer: encrypted });
    review = receiver.getByRole('dialog', { name: 'Open shared document', exact: true });
    await review.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await review.getByRole('button', { name: 'Decrypt and review', exact: true }).click();
    review = receiver.getByRole('dialog', { name: 'Review shared action package', exact: true });
    await expect(review.getByRole('heading', { name: 'Review shared action package', exact: true })).toBeVisible();
    await expect(review).toContainText('signed-original.pdf');
    await review.getByRole('checkbox', { name: /^I reviewed every included member/ }).check();
    await review.getByRole('button', { name: 'Open reviewed package', exact: true }).click();
    modal = receiver.getByRole('dialog', { name: 'Action packages', exact: true });
    await expect(modal.getByText('Signed original PDF', { exact: false })).toBeVisible();
    await modal.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(receiver.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('RECEIVER DRAFT PRESERVED');
    await receiver.reload();
    modal = await packages(receiver);
    await modal.getByLabel('Saved packages', { exact: true }).selectOption({ label: 'Encrypted training action' });
    await expect(modal.getByRole('heading', { name: '1. ENCRYPTED PACKAGE SOURCE', exact: true })).toBeVisible();
    await modal.getByRole('button', { name: 'Download retained PDF', exact: true }).click();
    await modal.getByRole('checkbox', { name: /^I reviewed every included member/ }).check();
    const receivedRetained = receiver.waitForEvent('download');
    await modal.getByRole('button', { name: 'Download reviewed retained PDF', exact: true }).click();
    expect(hash(await readFile((await (await receivedRetained).path())!))).toBe(hash(retained));
    // The UI offers exact original download after import/reload; validate actual bytes.
    const originalPending = receiver.waitForEvent('download');
    await modal.getByRole('button', { name: 'Download unchanged original', exact: true }).click();
    await modal.getByRole('checkbox', { name: /^I reviewed every included member/ }).check();
    await modal.getByRole('button', { name: 'Download reviewed unchanged original', exact: true }).click();
    expect(hash(await readFile((await (await originalPending).path())!))).toBe(hash(original));
    await receiver.screenshot({ path: info.outputPath('imported-encrypted-package.png') });
  } finally { await context.close(); }
});

for (const placement of ['enclosure', 'basic-letter', 'figure'] as const) {
  test(`blocks restricted text inside a captured native ${placement} PDF before encrypted handoff`, async ({ page }, info) => {
    await initialize(page);
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText('SECRET', { x: 50, y: 700, size: 16 });
    const bytes = Buffer.from(await pdf.save());
    const inline = { name: 'training-attachment.pdf', size: bytes.length, data: bytes.toString('base64') };
    const source = {
      documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
      formData: { subject: `SYNTHETIC ${placement.toUpperCase()}`, classLevel: 'unclassified', ...(placement === 'basic-letter' ? { basicLetterFile: inline } : {}) },
      paragraphs: [{ id: 'synthetic-body', text: 'Synthetic unclassified visible draft text.', level: 0,
        ...(placement === 'figure' ? { figure: { name: inline.name, type: 'application/pdf', data: inline.data } } : {}) }],
      references: [], copyTos: [], enclosures: placement === 'enclosure' ? [{ id: 'embedded-enclosure', title: 'Training attachment', hasFile: true, file: inline }] : [],
    };
    await page.getByLabel('Import draft file', { exact: true }).setInputFiles({ name: 'synthetic-embedded.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    const modal = await packages(page);
    await modal.getByLabel('Package name', { exact: true }).fill(`Embedded ${placement} review`);
    await modal.getByRole('button', { name: 'Create package', exact: true }).click();
    await modal.getByRole('button', { name: 'Capture current document', exact: true }).click();
    await expect(modal.getByRole('heading', { name: `1. SYNTHETIC ${placement.toUpperCase()}`, exact: true })).toBeVisible();
    await modal.getByRole('button', { name: 'Share encrypted package', exact: true }).click();
    const sharing = page.getByRole('dialog', { name: 'Share action package', exact: true });
    await expect(sharing.getByRole('alert')).toContainText('markings outside');
    await expect(sharing.getByRole('button', { name: 'Generate encrypted package', exact: true })).toBeDisabled();
    await expect(sharing.getByRole('button', { name: 'Download encrypted package file', exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`blocked-embedded-${placement}.png`) });
  });
}
