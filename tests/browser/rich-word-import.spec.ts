import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { wordDrawing, wordImportFixture, wordParagraph, wordRun, WORD_NS } from '../_helpers/wordImportFixture';
import { docxImageFixture } from '../_helpers/docxImageFixture';
import { downloadBrowserPdf } from '../_helpers/downloadBrowserPdf';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(240_000);

async function download(page: Page, action: () => Promise<unknown>) {
  const pending = page.waitForEvent('download', { timeout: 120_000 });
  await action();
  const result = await pending;
  expect(await result.failure()).toBeNull();
  return readFile((await result.path())!);
}
async function actions(page: Page, name: string) {
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}
async function reviewDeepStructure(page: Page) {
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Check paragraph structure', exact: true }) });
  await expect(dialog).toContainText('only subparagraph');
  await dialog.getByRole('button', { name: 'Download anyway', exact: true }).click();
}
async function reviewRichStructure(page: Page) {
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Check paragraph structure', exact: true }) });
  await expect(dialog).toContainText('Paragraphs 2 and 3 have headings but paragraphs 1 and 4 do not');
  await dialog.getByRole('button', { name: 'Download anyway', exact: true }).click();
}
async function chooseWord(page: Page, bytes: Uint8Array) {
  await actions(page, 'Import letter…');
  const dialog = page.getByRole('dialog', { name: 'Import a letter', exact: true });
  await dialog.getByLabel('Choose a PDF or Word file', { exact: true }).setInputFiles({
    name: 'DepartmentTrainingReadinessReviewCommentsNovember2026SecondDraft.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(bytes),
  });
  return dialog;
}
async function pdfText(bytes: Uint8Array) {
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  try {
    const texts: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const content = await (await pdf.getPage(number)).getTextContent();
      texts.push(content.items.map(item => 'str' in item ? item.str : '').join(' '));
    }
    return texts.join(' ').replace(/\s+/g, ' ');
  } finally { await pdf.destroy(); }
}
async function preparePdf(page: Page) {
  const preview = page.getByRole('button', { name: 'Preview', exact: true });
  if (await preview.getAttribute('aria-haspopup') === 'dialog') {
    await preview.click();
    const modal = page.getByRole('dialog', { name: 'PDF preview', exact: true });
    const button = modal.getByRole('button', { name: 'Download', exact: true });
    await expect(button).toBeVisible({ timeout: 90_000 });
    return () => button.click();
  }
  if (await preview.getAttribute('aria-pressed') !== 'true') await preview.click();
  await expect(page.locator('.workspace-preview [title="Document preview"]').first()).toBeAttached({ timeout: 90_000 });
  return async () => {
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Download PDF(?:\s|$)/ }).click();
  };
}

for (const theme of ['light', 'dark', 'classic'] as const) {
  test(`rich Word content remains editable, portable and present in actual exports in ${theme}`, async ({ page, context }, info) => {
    await context.addInitScript(value => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'scroll' } }));
    }, theme);
    // Exercise the supported deployment-policy contract with fictional CUI-marked content.
    await context.route('**/classification.config.json?**', route => route.fulfill({ json: { maxLevel: 'cui', allowedLevels: ['unclassified', 'cui'] } }));
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('PRIOR WORD DRAFT');
    await page.getByRole('textbox', { name: 'Paragraph 1', exact: true }).fill('My prior draft stays independent.');

    const image = (await docxImageFixture()).figure;
    const header = `${wordParagraph('From: Training Office')}${wordParagraph('To: Fictional Marine')}${wordParagraph('Subj: RICH WORD TRAINING')}`;
    const introduction = `<w:p>${wordRun('Purpose', '<w:b/>')}${wordRun(' is to preserve this introduction before the table.')}</w:p>`;
    const table = `<w:tbl><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc>${wordParagraph('Name')}</w:tc><w:tc>${wordParagraph('Date')}</w:tc></w:tr><w:tr><w:tc>${wordParagraph('ORIGINAL MARINE')}</w:tc><w:tc>${wordParagraph('16 Nov 26')}</w:tc></w:tr></w:tbl>`;
    const list = `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${wordRun('Take the training action.')}</w:p>`;
    const source = await wordImportFixture(`${header}${introduction}${table}<w:p>${wordDrawing}</w:p>${list}`, {
      'word/media/test.png': image,
      'word/header1.xml': `<w:hdr xmlns:w="${WORD_NS}">${wordParagraph('CUI')}</w:hdr>`,
    });
    const review = await chooseWord(page, source);
    await expect(review.getByText('Editable tables', { exact: true })).toBeVisible();
    await expect(review.getByText('Body images', { exact: true })).toBeVisible();
    await expect(review.getByLabel('Word import notices')).toContainText('introductory content stays');
    await expect(review.getByText('CUI', { exact: true })).toBeVisible();
    await review.getByRole('button', { name: 'Import into editor', exact: true }).click();
    await expect(review).toBeHidden({ timeout: 30_000 });
    await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('RICH WORD TRAINING');
    // A valid unbroken source filename must not widen the native editor or
    // push the original-file action off a narrow phone screen.
    const originalViewport = page.viewportSize();
    await page.setViewportSize({ width: 320, height: 900 });
    const retained = page.getByRole('complementary', { name: 'Retained Word source', exact: true });
    await retained.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    for (const control of [retained, retained.getByRole('button', { name: 'Download original Word file', exact: true })]) {
      await expect.poll(async () => {
        const bounds = await control.boundingBox();
        return bounds !== null && bounds.x >= -1 && bounds.x + bounds.width <= 321;
      }).toBe(true);
    }
    await page.screenshot({ path: info.outputPath(`retained-word-${theme}-320.png`), fullPage: true, animations: 'disabled' });
    if (originalViewport) await page.setViewportSize(originalViewport);

    await expect(page.getByRole('textbox', { name: 'Paragraph 1', exact: true }).locator('strong')).toHaveText('Purpose');
    const cell = page.getByRole('textbox', { name: 'Table 2, row 2, column 1', exact: true });
    await expect(cell).toHaveValue('ORIGINAL MARINE');
    await cell.fill('UPDATED MARINE');
    await page.getByLabel('Alternative text for image 3', { exact: true }).fill('A blue rectangle and a red circle on a pale blue background.');
    const blocks = page.locator('.workspace-paragraph');
    for (const [index, heading] of [[1, 'Training table'], [2, 'Visual aid']] as const) {
      await blocks.nth(index).getByRole('button', { name: '+ Heading', exact: true }).click();
      await blocks.nth(index).getByPlaceholder('Heading', { exact: true }).fill(heading);
    }
    for (const index of [0, 1, 2, 3]) {
      await blocks.nth(index).getByRole('button', { name: 'Portion marking: Unclassified. Change', exact: true }).click();
      await page.getByRole('menuitemradio', { name: '(U) Unclassified', exact: true }).click();
    }
    await page.getByLabel('Graphic portion marking', { exact: true }).selectOption('CUI');
    await page.getByRole('textbox', { name: 'Controlled By', exact: true }).fill('Fictional Training Office');
    const category = page.getByLabel('CUI categories', { exact: true });
    await category.fill('General Privacy');
    await expect(category).toHaveValue('General Privacy');
    await expect(category).toHaveAttribute('aria-invalid', 'false');

    const word = await download(page, async () => {
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true }).click();
      await reviewRichStructure(page);
    });
    const zip = await JSZip.loadAsync(word, { checkCRC32: true });
    const document = new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'), 'text/xml');
    const nativeTables = Array.from(document.getElementsByTagNameNS(WORD_NS, 'tbl'));
    const editedTable = nativeTables.find(element => element.textContent?.includes('UPDATED MARINE'));
    expect(editedTable).toBeDefined();
    expect(editedTable!.getElementsByTagNameNS(WORD_NS, 'tr').length).toBe(2);
    expect(editedTable!.getElementsByTagNameNS(WORD_NS, 'tblHeader').length).toBe(1);
    const paragraphs = Array.from(document.getElementsByTagNameNS(WORD_NS, 'p'));
    const graphic = paragraphs.find(element => element.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'blip').length > 0 && element.textContent?.includes('Visual aid'));
    expect(graphic?.textContent).toContain('(CUI)');
    expect(graphic?.textContent).toContain('(U) Visual aid');
    expect(paragraphs.some(element => element.textContent?.includes('(U) Training table'))).toBe(true);
    expect(paragraphs.find(element => element.textContent?.includes('Purpose'))?.getElementsByTagNameNS(WORD_NS, 'b').length).toBeGreaterThan(0);
    const media = await Promise.all(Object.values(zip.files).filter(file => file.name.startsWith('word/media/') && !file.dir).map(file => file.async('nodebuffer')));
    expect(media.some(bytes => bytes.equals(image))).toBe(true);
    expect(await zip.file('word/document.xml')!.async('string')).toContain('A blue rectangle and a red circle');
    await writeFile(info.outputPath('rich-word-export.docx'), word);

    const exportPdf = await preparePdf(page);
    await exportPdf();
    const pdf = await downloadBrowserPdf(page, info.project.name, () => reviewRichStructure(page));
    const text = await pdfText(pdf);
    for (const expected of ['Purpose', 'preserve this introduction', 'UPDATED MARINE', '(U) Training table', '(CUI)', '(U) Visual aid', 'Take the training action.']) expect(text).toContain(expected);
    expect(text.match(/\bName\b/g)).toHaveLength(1);
    const loaded = await PDFDocument.load(pdf);
    const dimensions = loaded.context.enumerateIndirectObjects().flatMap(([, object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image') ? [`${object.dict.get(PDFName.of('Width'))}x${object.dict.get(PDFName.of('Height'))}`] : []);
    expect(dimensions).toContain('480x240');
    await writeFile(info.outputPath('rich-word-export.pdf'), pdf);
    const previewModal = page.getByRole('dialog', { name: 'PDF preview', exact: true });
    if (await previewModal.isVisible()) await page.getByRole('button', { name: 'Close preview', exact: true }).click();

    const draftBytes = await download(page, () => actions(page, 'Export draft (.json)'));
    const draft = JSON.parse(draftBytes.toString());
    expect(draft.version).toBe(4);
    expect(Buffer.from(draft.wordSourceFile.data, 'base64')).toEqual(Buffer.from(source));
    await page.reload();
    await expect(cell).toHaveValue('UPDATED MARINE');
    expect(await download(page, () => page.getByRole('button', { name: 'Download original Word file', exact: true }).click())).toEqual(Buffer.from(source));
    await expect(page.getByLabel('Alternative text for image 3', { exact: true })).toHaveValue('A blue rectangle and a red circle on a pale blue background.');
    await page.getByLabel('Import draft file', { exact: true }).setInputFiles({ name: 'complete-rich-draft.json', mimeType: 'application/json', buffer: draftBytes });
    const draftReview = page.getByRole('dialog', { name: 'Review draft', exact: true });
    await draftReview.getByRole('button', { name: 'Open as new document', exact: true }).click();
    await expect(draftReview).toBeHidden({ timeout: 30_000 });
    await expect(cell).toHaveValue('UPDATED MARINE');
    expect(await download(page, () => page.getByRole('button', { name: 'Download original Word file', exact: true }).click())).toEqual(Buffer.from(source));
    const previous = await page.evaluate(() => new Promise<unknown>((resolve, reject) => {
      const opening = indexedDB.open('dondocs');
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const db = opening.result, request = db.transaction('documents', 'readonly').objectStore('documents').getAll();
        request.onsuccess = () => { db.close();resolve(request.result.find(document => document.session.formData.subject === 'PRIOR WORD DRAFT')?.session.paragraphs[0].text); };
        request.onerror = () => { db.close();reject(request.error); };
      };
    }));
    expect(previous).toBe('My prior draft stays independent.');
    await page.screenshot({ path: info.outputPath('rich-word-editor.png'), fullPage: true });
  });
}

test('literal Word markers are rejected before replacing work or changing their visible characters', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('LITERAL SOURCE STAYS SAFE');
  const source = await wordImportFixture(wordParagraph('The exact literals are **literal**, *x*, and __name__.'));
  const dialog = await chooseWord(page, source);
  await expect(dialog.getByRole('alert')).toContainText('literal formatting markers');
  await expect(dialog.getByRole('button', { name: 'Import into editor', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('LITERAL SOURCE STAYS SAFE');
});

test('cropped and transformed Word images are rejected before exposing their original raster', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('PRIOR WORK REMAINS');
  for (const [name, drawing] of [
    ['cropped', wordDrawing.replace('<a:stretch>', '<a:srcRect l="25000"/><a:stretch>')],
    ['rotated', wordDrawing.replace('<a:xfrm>', '<a:xfrm rot="5400000">')],
  ]) {
    const source = await wordImportFixture(`<w:p>${drawing}</w:p>`);
    await writeFile(info.outputPath(`${name}-source.docx`), source);
    const dialog = await chooseWord(page, source);
    await expect(dialog.getByRole('alert')).toContainText('cropped or transformed image');
    await expect(dialog.getByRole('alert')).toContainText('Nothing has been imported');
    await expect(dialog.getByRole('button', { name: 'Import into editor', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('PRIOR WORK REMAINS');
    await expect(page.getByRole('button', { name: 'Download original Word file', exact: true })).toHaveCount(0);
  }
});

for (const department of ['usmc', 'navy'] as const) {
test(`a real DonDocs ${department} Word export round trips without duplicating letter scaffolding`, async ({ page }, info) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: 'light', editorLayout: 'scroll' } }));
  });
  await page.goto('/');
  let source: Buffer = await readFile(resolve('tests/fixtures/word/dondocs-naval-deep.docx'));
  if (department === 'navy') {
    const zip = await JSZip.loadAsync(source);
    const trailing = ['Copy to:', 'COPYTO-TRAINING-RECIPIENT', '', 'Distribution:', 'DISTRIBUTION-TRAINING-RECIPIENT'].map(wordParagraph).join('');
    const xml = (await zip.file('word/document.xml')!.async('string')).replace('UNITED STATES MARINE CORPS', 'DEPARTMENT OF THE NAVY').replace('<w:sectPr>', trailing + '<w:sectPr>');
    expect(xml).toContain('COPYTO-TRAINING-RECIPIENT');
    zip.file('word/document.xml', xml);source = await zip.generateAsync({ type: 'nodebuffer' });
  }
  const review = await chooseWord(page, source);
  await expect(review.getByLabel('Word import notices')).toContainText('scaffolding use native fields');
  await review.getByRole('button', { name: 'Import into editor', exact: true }).click();
  await expect(review).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('.workspace-paragraph')).toHaveCount(20);
  await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('WORD LAYOUT QUALIFICATION');
  await expect(page.getByRole('textbox', { name: 'Paragraph 5', exact: true })).toHaveText(/^DEPTH4 /);
  await expect(page.getByRole('textbox', { name: 'Paragraph 6', exact: true })).toHaveText(/^DEPTH5 /);
  await expect(page.getByRole('group', { name: /^Table in paragraph/ })).toHaveCount(0);
  const word = await download(page, async () => {
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true }).click();
    await reviewDeepStructure(page);
  });
  const archive = await JSZip.loadAsync(word, { checkCRC32: true });
  const document = new DOMParser().parseFromString(await archive.file('word/document.xml')!.async('string'), 'text/xml');
  // The five native layout tables remain; no second set of gridded body copies.
  expect(document.getElementsByTagNameNS(WORD_NS, 'tbl').length).toBe(5);
  const text = Array.from(document.getElementsByTagNameNS(WORD_NS, 't')).map(node => node.textContent ?? '').join(' ');
  expect(text.match(/WORD LAYOUT QUALIFICATION/g)).toHaveLength(1);
  expect(text.match(/REFERENCE0\b/g)).toHaveLength(1);
  expect(text.match(/J\. A\. DOE/g)).toHaveLength(1);
  expect(text).toContain(department === 'navy' ? 'DEPARTMENT OF THE NAVY' : 'UNITED STATES MARINE CORPS');
  if (department === 'navy') {
    expect(text.match(/COPYTO-TRAINING-RECIPIENT/g)).toHaveLength(1);
    expect(text.match(/DISTRIBUTION-TRAINING-RECIPIENT/g)).toHaveLength(1);
  }
  const exportPdf = await preparePdf(page);
  await exportPdf();
  const pdf = await downloadBrowserPdf(page, info.project.name, () => reviewDeepStructure(page));
  const delivered = await pdfText(pdf);
  expect(delivered.match(/REFERENCE0\b/g)).toHaveLength(1);
  expect(delivered.match(/J\.\s*A\.\s*DOE/g)).toHaveLength(1);
  for (const value of ['DEPTH0', 'DEPTH4', 'DEPTH5', 'BODY13', 'Commanding Officer, 1st Battalion', '15 Jan 26']) expect(delivered).toContain(value);
  expect(delivered).not.toContain('__1__');
  expect(delivered).toContain(department === 'navy' ? 'DEPARTMENT OF THE NAVY' : 'UNITED STATES MARINE CORPS');
  if (department === 'navy') {
    expect(delivered.match(/COPYTO-TRAINING-RECIPIENT/g)).toHaveLength(1);
    expect(delivered.match(/DISTRIBUTION-TRAINING-RECIPIENT/g)).toHaveLength(1);
  }
  await writeFile(info.outputPath('existing-word-roundtrip.docx'), word);
  await writeFile(info.outputPath('existing-word-roundtrip.pdf'), pdf);
});
}
