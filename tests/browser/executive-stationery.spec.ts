import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';

test.use({ serviceWorkers: 'block', actionTimeout: 20_000 });
test.setTimeout(240_000);
test('changes executive stock deliberately and exports actual paper sizes without stale geometry', async ({ page, isMobile }, info) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: 'light', editorLayout: 'scroll', previewVisible: true }, version: 1 }));
  });
  await page.goto('/');
  const draft = { documentCategory: 'correspondence', documentMode: 'custom', docType: 'executive_correspondence', formData: { fontSize: '12pt', fontFamily: 'times', date: '', to: '', subject: '', salutation: 'Dear Admiral:', sigFirst: 'A', sigLast: 'SMITH', signatureType: 'none', unitLine1: 'AUTHORIZED TITLE' }, paragraphs: [{ id: 'first', level: 0, text: 'BODYPROBE Thank you for your support.' }], references: [], enclosures: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'executive.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  // Export geometry is the subject of this test; readiness recovery has its own
  // browser coverage. Establish a painted preview before the first export.
  if (isMobile) {
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.getByRole('dialog').locator('canvas').first()).toBeVisible({ timeout: 90_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } else {
    await expect(page.locator('.workspace-preview')).toHaveAttribute('data-preview-state', 'ready', { timeout: 90_000 });
  }

  for (const [label, width, height] of [['Flag stationery · 5 × 7 in', 360, 504], ['Flag stationery · 7 × 9 in', 504, 648], ['US Letter · 8.5 × 11 in', 612, 792]] as const) {
    await page.getByLabel('Stationery size', { exact: true }).click();
    await page.getByRole('option', { name: label, exact: true }).click();
    await expect(page.getByLabel('Letterhead style', { exact: true })).toContainText('Preprinted stationery');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const savingPdf = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByRole('menuitem', { name: /^Download PDF/ }).click();
    const pdf = await savingPdf;
    expect(await pdf.failure()).toBeNull();
    const pdfBytes = await readFile((await pdf.path())!);
    await info.attach(`${width}-stock.pdf`, { body: pdfBytes, contentType: 'application/pdf' });
    expect((await PDFDocument.load(pdfBytes)).getPage(0).getSize()).toEqual({ width, height });
    if (width === 360) {
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const savingWord = page.waitForEvent('download', { timeout: 120_000 });
      await page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true }).click();
      const word = await savingWord;
      const xml = await (await JSZip.loadAsync(await readFile((await word.path())!))).file('word/document.xml')!.async('string');
      expect(xml).toContain('w:w="7200" w:h="10080"');
      expect(xml).toContain('BODYPROBE');
    }
  }
  await page.getByLabel('Stationery size', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('stationery-picker.png') });
});
