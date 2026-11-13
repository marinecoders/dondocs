import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { docxImageFixture } from '../_helpers/docxImageFixture';

test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);

test('custom business figures and signature images survive reload and embed in Word', async ({ page }, testInfo) => {
  const images = await docxImageFixture();
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
  await page.getByLabel('Image for figure 2', { exact: true }).setInputFiles({ name: 'figure.png', mimeType: 'image/png', buffer: images.figure });
  await expect(page.getByText('figure.png', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Document tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Formatting…', exact: true }).click();
  const formatting = page.getByRole('dialog', { name: 'Document formatting', exact: true });
  await formatting.getByRole('tab', { name: 'Compliant', exact: true }).click();
  await formatting.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByText('figure.png', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('business-figure-editor.png') });
  // Let the normal debounced workspace save complete before a fresh page.
  await page.waitForTimeout(1100);
  await page.reload();
  await expect(page.getByText('figure.png', { exact: true }).first()).toBeVisible();
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
  expect(media.some(bytes => Buffer.from(bytes).equals(images.figure))).toBe(true);
  const xml = await zip.file('word/document.xml')!.async('string');
  expect(xml).toContain('descr="Handwritten signature image"');
  expect(xml).toContain('descr="Training layout"');
  expect(xml).toContain('cx="1371600" cy="342900"');
  expect(xml).toContain('cx="5943600" cy="2971800"');
  expect(xml).toContain('Figure 1.');
  expect(xml).not.toContain('blob:');
});
