import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { downloadBrowserPdf } from '../_helpers/downloadBrowserPdf';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import AxeBuilder from '@axe-core/playwright';
import { buildBaseline } from '../_helpers/compileMatrix';
import { capturePackageDocument } from '../_helpers/capturePackageDocument';
import { openPackageWorkspace, newBlankPackage, packageTool } from './_helpers/packageWorkspace';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(180_000);
async function open(page: Page, theme: string, enclosures: boolean) {
  await page.addInitScript(value => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: value, editorLayout: 'scroll', previewVisible: false }, version: 1 }));
  }, theme);
  await page.goto('/');
  const original = await readFile(resolve('tests/fixtures/permission-pdfs/source.pdf'));
  const base = buildBaseline('naval_letter');
  const draft = { ...base, documentMode: 'custom', documentCategory: 'correspondence', formData: { ...base.formData, subject: 'TABLE AND WORD DELIVERY', classLevel: 'unclassified' },
    paragraphs: [{ text: 'Synthetic training correspondence.', level: 0 }], references: [], copyTos: [], distributions: [],
    enclosures: enclosures ? [{ title: 'Captured source', hasFile: true, file: { name: 'source.pdf', size: original.length, data: original.toString('base64') } }] : [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'authoring.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await expect(page.getByRole('textbox', { name: /^Subject/ })).toHaveValue('TABLE AND WORD DELIVERY');
  return original;
}
async function draft(page: Page) {
  const saving = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Export draft (.json)', exact: true }).click();
  const file = await saving;expect(await file.failure()).toBeNull();
  return JSON.parse(await readFile((await file.path())!, 'utf8'));
}
async function word(page: Page, images: boolean) {
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const saving = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('menuitem', { name: images ? 'Word with enclosure page images' : 'Download Word (.docx)', exact: true }).click();
  if (images) {
    const review = page.getByRole('dialog', { name: 'Review export markings', exact: true });
    await expect(review).toContainText('noneditable images');
    await review.getByRole('button', { name: 'Continue export', exact: true }).click();
  }
  const file = await saving;expect(await file.failure()).toBeNull();
  return readFile((await file.path())!);
}
for (const theme of ['light', 'dark', 'classic']) {
  test(`native table layout remains editable and reaches actual Word output in ${theme}`, async ({ page }, info) => {
    await open(page, theme, false);
    await page.getByRole('button', { name: 'Add table', exact: true }).click();
    const table = page.getByRole('group', { name: 'Table in paragraph 2', exact: true });
    await table.getByRole('textbox', { name: 'Table 2, row 2, column 1', exact: true }).fill('RETAIN TABLE CELL');
    await table.getByText('Table formatting', { exact: true }).click();
    await table.getByLabel('Lines for table 2', { exact: true }).selectOption('outline');
    await table.getByLabel('Text size for table 2', { exact: true }).selectOption('10');
    await table.getByLabel('Width percentage for table 2 column 1', { exact: true }).first().fill('25');
    await table.getByLabel('Alignment for table 2 column 2', { exact: true }).last().selectOption('right');
    await table.getByRole('button', { name: 'Add table row', exact: true }).click();
    const accessibility = await new AxeBuilder({ page }).include('[aria-label="Table in paragraph 2"]').analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`table-${theme}.png`), fullPage: false });
    const saved = await draft(page), native = saved.paragraphs[1].bodyTable;
    expect(native).toMatchObject({ columnWidths: [25, 75], columnAlignments: ['left', 'right'], borders: 'outline', fontSize: 10 });
    expect(native.rows[1][0]).toBe('RETAIN TABLE CELL');
    const zip = await JSZip.loadAsync(await word(page, false)), xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('RETAIN TABLE CELL');expect(xml).toContain('w:w="2340"');expect(xml).toContain('w:w="7020"');
    expect(xml).toContain('<w:insideH w:val="nil"');expect(xml).toContain('<w:sz w:val="20"/>');
    expect(xml.match(/w:name="DonDocsBodyTable0"/g)).toHaveLength(1);
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Table 2, row 2, column 1', exact: true })).toHaveValue('RETAIN TABLE CELL');
    expect((await draft(page)).paragraphs[1].bodyTable).toEqual(native);
  });
  test(`Word enclosure images are opt-in and retain exact originals in ${theme}`, async ({ page }, info) => {
    const original = await open(page, theme, true), expected = (await PDFDocument.load(original)).getPageCount();
    const plain = await JSZip.loadAsync(await word(page, false));
    expect(await plain.file('word/document.xml')!.async('string')).not.toContain('DonDocsEnclosurePage');
    const bytes = await word(page, true);await info.attach('word-with-enclosure-images.docx', { body: bytes, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const zip = await JSZip.loadAsync(bytes), xml = await zip.file('word/document.xml')!.async('string');
    expect(xml.match(/name="DonDocsEnclosurePage\d+"/g)).toHaveLength(expected);
    expect(xml).toContain('rIdDonDocsEnclosureheader');
    for (let index = 1; index <= expected; index++) {
      const png = await zip.file(`word/media/dondocs-enclosure-${index}.png`)!.async('uint8array');
      const image = sharp(png), metadata = await image.metadata(), stats = await image.stats();
      expect(metadata.width).toBeGreaterThan(600);expect(stats.channels.some(channel => channel.min < 200)).toBe(true);
    }
    expect((await draft(page)).enclosures[0].file.data).toBe(original.toString('base64'));
  });
}
test('permission-locked enclosure pages reach Word without changing the original', async ({ page }) => {
  await open(page, 'light', false);
  const path = resolve('tests/fixtures/permission-pdfs/owner-aes.pdf');
  await page.getByLabel('Upload enclosure PDFs', { exact: true }).last().setInputFiles(path);
  const confirmation = page.getByRole('alertdialog', { name: 'Include PDF pages as images?', exact: true });
  await confirmation.getByRole('button', { name: 'Include page images', exact: true }).click();
  await expect(page.getByText('owner-aes.pdf', { exact: true })).toBeVisible();
  const zip = await JSZip.loadAsync(await word(page, true));
  expect(await zip.file('word/document.xml')!.async('string')).toContain('DonDocsEnclosurePage1');
  expect((await draft(page)).enclosures[0].file.data).toBe((await readFile(path)).toString('base64'));
});
test('saved package Word delivery includes optional images and unchanged originals', async ({ page }) => {
  const original = await open(page, 'light', true);
  const dialog = await openPackageWorkspace(page);
  await newBlankPackage(dialog, 'Word enclosure image package');
  await capturePackageDocument(dialog);
  const tool = await packageTool(dialog, 'Word package delivery');
  await tool.getByRole('checkbox', { name: /^Include each native document/ }).check();
  await tool.getByRole('button', { name: 'Review Word package', exact: true }).click();
  await tool.getByRole('checkbox', { name: /^I reviewed/ }).check();
  const saving = page.waitForEvent('download', { timeout: 120_000 });
  await tool.getByRole('button', { name: 'Download reviewed Word package', exact: true }).click();
  const file = await saving;expect(await file.failure()).toBeNull();
  const zip = await JSZip.loadAsync(await readFile((await file.path())!)), manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  const main = await JSZip.loadAsync(await zip.file(manifest.mainDocument)!.async('uint8array'));
  expect(await main.file('word/document.xml')!.async('string')).toContain('DonDocsEnclosurePage1');
  const pdfs = manifest.files.filter((entry: { kind: string; name: string }) => entry.kind === 'original' && entry.name.endsWith('.pdf'));
  expect(pdfs).toHaveLength(1);
  expect(await zip.file(pdfs[0].path)!.async('uint8array')).toEqual(new Uint8Array(original));
});

for (const size of ['narrow', 'tall'] as const) test(`${size} table identifiers render completely in the real browser PDF engine`, async ({ page }, info) => {
  const identifier = size === 'tall' ? '012345678901234567890123456789012345' : '012345678901234567';
  await open(page, 'light', false);
  await page.getByRole('button', { name: 'Add table', exact: true }).click();
  const table = page.getByRole('group', { name: 'Table in paragraph 2', exact: true });
  await table.getByText('Table formatting', { exact: true }).click();
  await table.getByLabel('Text size for table 2', { exact: true }).selectOption(size === 'tall' ? '12' : '10');
  await table.getByLabel('Width percentage for table 2 column 1', { exact: true }).fill('5');
  await table.getByRole('textbox', { name: 'Table 2, row 1, column 1', exact: true }).fill('ID');
  await table.getByRole('textbox', { name: 'Table 2, row 2, column 1', exact: true }).fill(`**${identifier}**`);
  await table.getByRole('textbox', { name: 'Table 2, row 2, column 2', exact: true }).fill('Retain the adjacent column.');
  const bytes = await downloadBrowserPdf(page, info.project.name, async () => {
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Download PDF/ }).click();
  });
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  try {
    const text: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) text.push((await (await pdf.getPage(number)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(''));
    expect(text.join('').replace(/\s/g, '')).toContain(identifier);
    expect(text.join('')).toContain('Retain the adjacent column.');
    expect(pdf.numPages).toBeGreaterThan(0);
  } finally { await pdf.destroy(); }
});

test('Word enclosure images preserve table text beyond the PDF font set', async ({ page }) => {
  await open(page, 'light', true);
  await page.getByRole('button', { name: 'Add table', exact: true }).click();
  await page.getByRole('textbox', { name: 'Table 2, row 2, column 1', exact: true }).fill('訓練');
  const zip = await JSZip.loadAsync(await word(page, true));
  const xml = await zip.file('word/document.xml')!.async('string');
  expect(xml).toContain('訓練');expect(xml).toContain('DonDocsEnclosurePage1');
});
