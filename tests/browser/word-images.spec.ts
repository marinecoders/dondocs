import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { docxImageFixture } from '../_helpers/docxImageFixture';

test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);

for (const figureType of ['png', 'jpeg'] as const) {
test(`custom business ${figureType} figures and signature images survive reload and embed in Word and PDF`, async ({ page }, testInfo) => {
  const images = await docxImageFixture();
  const figureBytes = figureType === 'png' ? images.figure : images.jpeg;
  const figureName = figureType === 'png' ? 'figure.png' : 'figure.jpg';
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: 'light', editorLayout: 'scroll' }, version: 1 }));
  });
  await page.goto('/');
  const draft = { documentCategory: 'correspondence', documentMode: 'custom', docType: 'business_letter',
    formData: { subject: 'WORD IMAGE CHECK', to: 'Training Office', date: 'November 13, 2026', sigFirst: 'Alex', sigLast: 'Example', signatureType: 'image',
      signatureImage: { name: 'signature.png', size: images.signature.length, data: images.signature.toString('base64') } },
    paragraphs: [{ text: 'This fictional letter contains a diagram and a visual signature.', level: 0 }, { text: 'Training layout', level: 0 }],
    references: [], enclosures: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'business-images.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await page.getByRole('button', { name: 'Block kind: paragraph. Change', exact: true }).last().click();
  expect(await page.getByRole('menu').evaluate(menu => {
    const bounds = menu.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= window.innerWidth;
  })).toBe(true);
  await page.getByRole('menuitemradio', { name: /Figure — an image/ }).click();
  await page.getByLabel('Image for figure 2', { exact: true }).setInputFiles({ name: figureName, mimeType: `image/${figureType}`, buffer: figureBytes });
  await expect(page.getByText(figureName, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Document tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Formatting…', exact: true }).click();
  const formatting = page.getByRole('dialog', { name: 'Document formatting', exact: true });
  await formatting.getByRole('tab', { name: 'Compliant', exact: true }).click();
  await formatting.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByText(figureName, { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('business-figure-editor.png') });
  // Let the normal debounced workspace save complete before a fresh page.
  await page.waitForTimeout(1100);
  await page.reload();
  await expect(page.getByText(figureName, { exact: true }).first()).toBeVisible();
  // JPEG uploads are re-encoded to apply orientation and remove camera tags.
  // Compare Word against the persisted draft bytes, rather than the raw photo.
  const savingDraft = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Export draft (.json)', exact: true }).click();
  const savedDraft = JSON.parse(await readFile((await (await savingDraft).path())!, 'utf8'));
  const savedFigure = Buffer.from(savedDraft.paragraphs[1].figure.data, 'base64');
  expect(savedFigure.length).toBeGreaterThan(0);
  if (figureType === 'png') expect(savedFigure.equals(figureBytes)).toBe(true);
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true }).click();
  const download = await pending;
  expect(await download.failure()).toBeNull();
  await download.saveAs(testInfo.outputPath('word-images.docx'));
  const bytes = await readFile(testInfo.outputPath('word-images.docx'));
  const zip = await JSZip.loadAsync(bytes);
  const media = await Promise.all(Object.values(zip.files).filter(file => file.name.startsWith('word/media/') && !file.dir).map(file => file.async('uint8array')));
  expect(media.some(bytes => Buffer.from(bytes).equals(images.signature))).toBe(true);
  expect(media.some(bytes => Buffer.from(bytes).equals(savedFigure))).toBe(true);
  const xml = await zip.file('word/document.xml')!.async('string');
  expect(xml).toContain('descr="Handwritten signature image"');
  expect(xml).toContain('descr="Training layout"');
  expect(xml).toContain('cx="1371600" cy="342900"');
  expect(xml).toContain('cx="5943600" cy="2971800"');
  expect(xml).toContain('Figure 1.');
  expect(xml).not.toContain('blob:');

  const showPreview = page.getByRole('button', { name: 'Preview', exact: true });
  let exportPdf: () => Promise<void>;
  if (await showPreview.getAttribute('aria-haspopup') === 'dialog') {
    await showPreview.click();
    const download = page.getByRole('dialog', { name: 'PDF preview', exact: true }).getByRole('button', { name: 'Download', exact: true });
    await expect(download).toBeVisible({ timeout: 60_000 });
    exportPdf = () => download.click();
  } else {
    if (await showPreview.getAttribute('aria-pressed') !== 'true') await showPreview.click();
    await expect(page.locator('.workspace-preview [title="Document preview"]').first()).toBeAttached({ timeout: 60_000 });
    exportPdf = async () => {
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      await page.getByRole('menuitem', { name: /^Download PDF(?:\s|$)/ }).click();
    };
  }
  if (testInfo.project.name === 'mobile-chrome-ios') {
    const opening = page.waitForEvent('popup');
    await exportPdf();
    const popup = await opening;
    try {
      const frame = popup.locator('iframe');
      await expect(frame).toHaveAttribute('src', /^data:application\/pdf;base64,/, { timeout: 30_000 });
      await expectPdfImages(Buffer.from((await frame.getAttribute('src'))!.split(',')[1], 'base64'));
      const saving = popup.waitForEvent('download');
      await popup.getByRole('link', { name: 'Download PDF', exact: true }).click();
      const download = await saving;
      expect(await download.failure()).toBeNull();
      await download.saveAs(testInfo.outputPath('word-images.pdf'));
    } finally { await popup.close(); }
  } else {
    const savingPdf = page.waitForEvent('download');
    await exportPdf();
    const pdfDownload = await savingPdf;
    expect(await pdfDownload.failure()).toBeNull();
    await pdfDownload.saveAs(testInfo.outputPath('word-images.pdf'));
  }
  await expectPdfImages(await readFile(testInfo.outputPath('word-images.pdf')));
});
}

async function expectPdfImages(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBeGreaterThan(0);
  const dimensions = pdf.context.enumerateIndirectObjects().flatMap(([, object]) =>
    object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')
      ? [`${object.dict.get(PDFName.of('Width'))}x${object.dict.get(PDFName.of('Height'))}`] : []);
  expect(dimensions).toContain('360x90');
  expect(dimensions).toContain('480x240');
}

test('a successful figure preview closes an earlier missing-image error and restores document tools', async ({ page, isMobile }) => {
  test.skip(isMobile, 'This recovery checks the always-visible desktop preview.');
  const images = await docxImageFixture();
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: 'light', editorLayout: 'scroll' }, version: 1 }));
  });
  await page.goto('/');
  const draft = { documentCategory: 'correspondence', documentMode: 'custom', docType: 'business_letter',
    formData: { subject: 'FIGURE PREVIEW RECOVERY', to: 'Training Office', date: 'November 13, 2026', sigFirst: 'Alex', sigLast: 'Example' },
    paragraphs: [{ text: 'Training layout', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'figure-recovery.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  // Hold the pending file read so the empty figure preview fails before upload completes.
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer;
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    File.prototype.arrayBuffer = function () {
      return this.name === 'figure.png' ? pending.then(() => read.call(this)) : read.call(this);
    };
    (window as unknown as { finishFigureUpload: () => void }).finishFigureUpload = release;
  });
  await page.getByRole('button', { name: 'Block kind: paragraph. Change', exact: true }).click();
  await page.getByRole('menuitemradio', { name: /Figure — an image/ }).click();
  await page.getByLabel('Image for figure 1', { exact: true }).setInputFiles({ name: 'figure.png', mimeType: 'image/png', buffer: images.figure });
  const error = page.getByRole('dialog', { name: 'Preview compile failed', exact: true });
  await expect(error).toContainText('Figure 1 has no image', { timeout: 30_000 });
  await page.evaluate(() => (window as unknown as { finishFigureUpload: () => void }).finishFigureUpload());
  await expect(page.getByText('figure.png', { exact: true }).first()).toBeVisible();
  await expect(error).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('.workspace-preview [title="Document preview"]').first()).toBeAttached({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Document tools', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Formatting…', exact: true })).toBeVisible();
});
