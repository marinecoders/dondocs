import { test, expect, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);
const letter = ['From: Commanding Officer, Fictional Unit', 'To: Training Officer', 'Subj: SCANNED LETTER EXERCISE', '', '1. This fictional letter verifies local scan import.', '', 'A. EXAMPLE'];

async function scanImage(page: Page) {
  const encoded = await page.evaluate(lines => {
    const canvas = document.createElement('canvas'); canvas.width = 1500; canvas.height = 1200;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'black'; context.font = '30px Arial';
    lines.forEach((line, index) => context.fillText(line, 80, 140 + index * 65));
    return canvas.toDataURL('image/png').split(',')[1];
  }, letter);
  return Buffer.from(encoded, 'base64');
}
async function openScan(page: Page) {
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Import letter…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import a letter', exact: true });
  await dialog.getByRole('button', { name: 'Scan or photo', exact: true }).click();
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
  await page.goto('/');
});

for (const format of ['image', 'mixed-pdf'] as const) {
  test(`local OCR, correction, reviewed import and retained draft from ${format}`, async ({ page }, testInfo) => {
    await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('PREVIOUS DRAFT PRESERVED');
    const png = await scanImage(page);
    let bytes = png;
    if (format === 'mixed-pdf') {
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const first = pdf.addPage([612, 792]);
      first.drawText('Training source first page', { x: 50, y: 720, font, size: 18 });
      const second = pdf.addPage([750, 600]);
      const image = await pdf.embedPng(png);
      second.drawImage(image, { x: 0, y: 0, width: 750, height: 600 });
      bytes = Buffer.from(await pdf.save());
    }
    const external: string[] = [];
    await page.context().route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.protocol.startsWith('http') && url.origin !== new URL(page.url()).origin) { external.push(url.href); return route.abort(); }
      return route.continue();
    });
    const dialog = await openScan(page);
    await dialog.getByLabel('Scanned PDF or image', { exact: true }).setInputFiles({ name: format === 'image' ? 'letter.png' : 'letter.pdf', mimeType: format === 'image' ? 'image/png' : 'application/pdf', buffer: bytes });
    const text = dialog.getByRole('textbox', { name: 'Corrected text for page 1', exact: true });
    await expect(text).toBeVisible({ timeout: 60_000 });
    expect(await text.inputValue()).toContain(format === 'image' ? 'SCANNED LETTER EXERCISE' : 'Training source first page');
    await expect(dialog.getByRole('button', { name: 'Review recognized letter', exact: true })).toBeDisabled();
    if (format === 'mixed-pdf') {
      await dialog.getByRole('checkbox').check();
      await dialog.getByRole('button', { name: 'Next page', exact: true }).click();
    }
    const corrected = dialog.getByRole('textbox', { name: `Corrected text for page ${format === 'image' ? 1 : 2}`, exact: true });
    expect(await corrected.inputValue()).toContain('SCANNED LETTER EXERCISE');
    await corrected.fill(letter.join('\n').replace('SCANNED LETTER EXERCISE', 'CORRECTED SCAN SUBJECT'));
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Review recognized letter', exact: true }).click();
    await expect(dialog.getByText('CORRECTED SCAN SUBJECT', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Correct scanned text', exact: true }).click();
    await expect(corrected).toHaveValue(letter.join('\n').replace('SCANNED LETTER EXERCISE', 'CORRECTED SCAN SUBJECT'));
    await dialog.getByRole('button', { name: 'Review recognized letter', exact: true }).click();
    await dialog.getByRole('button', { name: 'Import into editor', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('CORRECTED SCAN SUBJECT');
    await expect.poll(() => page.evaluate(() => new Promise<string[]>((resolve, reject) => {
      const request = indexedDB.open('dondocs');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const read = db.transaction('documents', 'readonly').objectStore('documents').getAll();
        read.onerror = () => { db.close(); reject(read.error); };
        read.onsuccess = () => { db.close(); resolve(read.result.map((record: { session: { formData: { subject: string } } }) => record.session.formData.subject)); };
      };
    }))).toEqual(expect.arrayContaining(['PREVIOUS DRAFT PRESERVED', 'CORRECTED SCAN SUBJECT']));
    expect(external).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`scan-${format}.png`) });
  });
}

test('a corrupt scan leaves the current document unchanged', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('KEEP THIS SUBJECT');
  const dialog = await openScan(page);
  await dialog.getByLabel('Scanned PDF or image', { exact: true }).setInputFiles({ name: 'corrupt.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') });
  await expect(dialog.getByRole('alert')).toBeVisible({ timeout: 60_000 });
  await expect(dialog.getByRole('button', { name: 'Review recognized letter', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('KEEP THIS SUBJECT');
});
