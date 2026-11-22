import { expect, test, type Page } from '@playwright/test';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { downloadBrowserPdf } from '../_helpers/downloadBrowserPdf';
import { wordDrawing, wordImportFixture, wordParagraph } from '../_helpers/wordImportFixture';
import { docxImageFixture } from '../_helpers/docxImageFixture';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(180_000);
test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning')); });
async function importLetter(page: Page, subject: string, text: string, docType = 'standard_letter', original = false, linkedReference = false) {
  await page.getByLabel('Import draft file', { exact: true }).setInputFiles({ name: 'letter.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    documentCategory: 'correspondence', documentMode: 'custom', docType,
    formData: { subject, from: 'Training Marine', to: 'Training Office', unitLine1: 'TRAINING COMMAND', date: '16 Nov 26', signatureType: 'none', classLevel: 'unclassified', includeHyperlinks: linkedReference },
    paragraphs: [{ id: 'training-body', level: 0, header: 'Purpose', text }], references: linkedReference ? [{ letter: 'a', title: 'Training reference for the supported tagged external link.', url: 'https://example.test/training?chapter=1&section=2' }] : [], enclosures: original ? [{ title: 'Original signed PDF' }] : [], copyTos: [], distributions: [],
  })) });
  const review = page.getByRole('dialog', { name: 'Review draft', exact: true });
  await review.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await expect(review).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue(subject);
}
async function warmEngine(page: Page) {
  const preview = page.getByRole('button', { name: 'Preview', exact: true });
  const mobile = await preview.getAttribute('aria-haspopup') === 'dialog';
  if (mobile || await preview.getAttribute('aria-pressed') !== 'true') await preview.click();
  await expect(page.locator('[data-pdf-layer="active"] canvas').first()).toBeVisible({ timeout: 60_000 });
  if (mobile) await page.getByRole('button', { name: 'Close preview', exact: true }).click();
}
async function taggedDialog(page: Page) {
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Tagged PDF (experimental)', exact: true }).click();
  return page.getByRole('dialog', { name: 'Export tagged PDF', exact: true });
}
async function textOf(bytes: Buffer) {
  const document = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  try { return (await Promise.all(Array.from({ length: document.numPages }, async (_, i) => (await (await document.getPage(i + 1)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ')))).join('\n'); }
  finally { await document.destroy(); }
}

test('exports edited imported Word tables and images through the tagged native profile', async ({ page }, info) => {
  const image = (await docxImageFixture()).figure;
  const table = '<w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc>' + wordParagraph('Item')
    + '</w:tc><w:tc>' + wordParagraph('Status') + '</w:tc></w:tr><w:tr><w:tc>' + wordParagraph('Training record')
    + '</w:tc><w:tc>' + wordParagraph('Pending') + '</w:tc></w:tr></w:tbl>';
  const bytes = await wordImportFixture(wordParagraph('16 Nov 26') + wordParagraph('From: Training Marine')
    + wordParagraph('To: Training Office') + wordParagraph('Subj: WORD TO TAGGED TRAINING')
    + wordParagraph('1. Preserve this imported body.') + table + `<w:p>${wordDrawing}</w:p>`
    + wordParagraph('2. Retain this closing body.'), { 'word/media/test.png': image,
    'docProps/core.xml': '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:description>RETAINED_ORIGINAL_ONLY_SYNTHETIC</dc:description></cp:coreProperties>' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Import letter…', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Import a letter', exact: true });
  await review.getByLabel('Choose a PDF or Word file', { exact: true }).setInputFiles({
    name: 'word-to-tagged.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(bytes),
  });
  await expect(review.getByText('Editable tables', { exact: true })).toBeVisible();
  await review.getByRole('button', { name: 'Import into editor', exact: true }).click();
  await expect(review).toBeHidden();
  await page.getByRole('textbox', { name: 'Table 2, row 2, column 2', exact: true }).fill('Reviewed');
  const alternative = 'Blue rectangle and red circle used for training.';
  await page.getByLabel('Alternative text for image 3', { exact: true }).fill(alternative);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Table 2, row 2, column 2', exact: true })).toHaveValue('Reviewed');
  await expect(page.getByLabel('Alternative text for image 3', { exact: true })).toHaveValue(alternative);
  await warmEngine(page);
  const dialog = await taggedDialog(page);
  const output = await downloadBrowserPdf(page, info.project.name, () => dialog.getByRole('button', { name: 'Export tagged PDF', exact: true }).click());
  const pdf = await PDFDocument.load(output);
  const dictionaries = pdf.context.enumerateIndirectObjects().map(([, object]) => object).filter((object): object is PDFDict => object instanceof PDFDict);
  expect(dictionaries.filter(object => object.get(PDFName.of('S')) === PDFName.of('TH'))).toHaveLength(2);
  const figures = dictionaries.filter(object => object.get(PDFName.of('S')) === PDFName.of('Figure'));
  expect(figures).toHaveLength(1);
  const alt = figures[0].get(PDFName.of('Alt'));
  expect(alt instanceof PDFString || alt instanceof PDFHexString ? alt.decodeText() : null).toBe(alternative);
  const text = await textOf(output);
  for (const value of ['WORD TO TAGGED TRAINING', 'Preserve this imported body.', 'Training record', 'Reviewed', 'Retain this closing body.']) expect(text).toContain(value);
  expect(text).not.toContain('RETAINED_ORIGINAL_ONLY_SYNTHETIC');
  await info.attach('imported-word-tagged.pdf', { body: output, contentType: 'application/pdf' });
});

for (const docType of ['standard_letter', 'naval_letter']) {
  test(`exports actual structured ${docType} content and blocks an unsupported original attachment`, async ({ page }, info) => {
    await page.goto('/');
    await importLetter(page, 'TAGGED TRAINING LETTER', Array.from({ length: 45 }, (_, i) => `Training sentence ${i + 1} retains meaningful **bold** text across line wraps and page boundaries.`).join(' '), docType);
    await warmEngine(page);
    const dialog = await taggedDialog(page);
    await expect(dialog).toContainText('native screen-reader qualification and PDF/UA conformance have not been established');
    const output = await downloadBrowserPdf(page, info.project.name, () => dialog.getByRole('button', { name: 'Export tagged PDF', exact: true }).click());
    const pdf = await PDFDocument.load(output);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    expect(pdf.getTitle()).toBe('TAGGED TRAINING LETTER');
    const tree = pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
    expect(tree.lookup(PDFName.of('ParentTree'), PDFDict).lookup(PDFName.of('Nums'), PDFArray).size()).toBe(pdf.getPageCount() * 2);
    expect(await textOf(output)).toContain('Training sentence 45');
    await info.attach(`${docType}-tagged.pdf`, { body: output, contentType: 'application/pdf' });
    await page.getByRole('button', { name: 'Download', exact: true }).click({ trial: true });
    // An original PDF is a separate package member, never silently retagged.
    await importLetter(page, 'ORIGINAL PACKAGE', 'Keep the original signed member.', docType, true);
    const unsupported = await taggedDialog(page);
    await expect(unsupported.getByRole('status')).toContainText('cannot include original PDFs or enclosures');
    await expect(unsupported.getByRole('button', { name: 'Export tagged PDF', exact: true })).toBeDisabled();
    await unsupported.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await page.getByRole('textbox', { name: 'Subject', exact: true }).inputValue()).toBe('ORIGINAL PACKAGE');
  });
}

test('exports the deepest supported native hierarchy with blank rich-block headings and an empty table cell', async ({ page }, info) => {
  const image = (await docxImageFixture()).figure;
  await page.goto('/');
  await page.getByLabel('Import draft file', { exact: true }).setInputFiles({ name: 'nested-rich-letter.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    documentCategory: 'correspondence', documentMode: 'custom', docType: 'standard_letter',
    formData: { subject: 'DEEP RICH TAGGED LETTER', from: 'Training Marine', to: 'Training Office', date: '16 Nov 26', signatureType: 'none', classLevel: 'unclassified' },
    paragraphs: [
      ...Array.from({ length: 6 }, (_, level) => ({ id: `deep-native-${level}`, level, text: `Native hierarchy level ${level} retains its text.` })),
      { id: 'blank-table-caption', level: 0, text: '', header: ' \t ', bodyTable: { rows: [['Item', 'Status'], ['Training record', '']], headerRows: 1 } },
      { id: 'blank-image-caption', level: 0, text: '', header: ' \t ', figure: { name: 'training.png', type: 'image/png', width: 480, height: 240, placement: 'body', altText: 'Training rectangle and circle.', data: image.toString('base64') } },
    ], references: [], enclosures: [], copyTos: [], distributions: [],
  })) });
  const review = page.getByRole('dialog', { name: 'Review draft', exact: true });
  await review.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await expect(review).toBeHidden();
  await warmEngine(page);
  const dialog = await taggedDialog(page);
  await dialog.getByRole('button', { name: 'Export tagged PDF', exact: true }).click();
  const structure = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Check paragraph structure', exact: true }) });
  await expect(structure).toBeVisible();
  // Review releases the initial iOS tab. Final approval opens the delivery tab.
  const output = await downloadBrowserPdf(page, info.project.name,
    () => structure.getByRole('button', { name: 'Download anyway', exact: true }).click());
  const pdf = await PDFDocument.load(output);
  const root = pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict).lookup(PDFName.of('K'), PDFArray);
  const document = pdf.context.lookup(root.get(0), PDFDict);
  const depths: number[] = [];
  const visit = (element: PDFDict, depth: number) => {
    depths.push(depth);
    const children = element.get(PDFName.of('K'));
    if (children instanceof PDFArray) for (const child of children.asArray()) {
      const next = pdf.context.lookup(child);
      if (next instanceof PDFDict && next.has(PDFName.of('S'))) visit(next, depth + 1);
    }
  };
  visit(document, 0);
  expect(Math.max(...depths)).toBe(19);
  const elements = pdf.context.enumerateIndirectObjects().map(([, object]) => object).filter((object): object is PDFDict => object instanceof PDFDict);
  expect(elements.filter(element => element.get(PDFName.of('S')) === PDFName.of('Caption'))).toHaveLength(0);
  expect(elements.filter(element => element.get(PDFName.of('S')) === PDFName.of('TH'))).toHaveLength(2);
  expect(elements.filter(element => element.get(PDFName.of('S')) === PDFName.of('Figure'))).toHaveLength(1);
  expect(elements.some(element => element.get(PDFName.of('S')) === PDFName.of('TD') && element.lookup(PDFName.of('K'), PDFArray).size() === 0)).toBe(true);
  const text = await textOf(output);
  for (let level = 0; level < 6; level++) expect(text).toContain(`Native hierarchy level ${level}`);
  expect(text).toContain('Training record');
  await info.attach('deep-rich-tagged.pdf', { body: output, contentType: 'application/pdf' });
});

test('cancels an owned actual worker job then exports a different fresh document with the normal profile', async ({ page }, info) => {
  await page.addInitScript(() => {
    const original = Worker.prototype.postMessage;
    const profiles = new WeakMap<Worker, string>();
    const barrier = { held: false, armed: true, release: () => {} };
    Object.assign(window, { taggedCompileBarrier: barrier });
    Worker.prototype.postMessage = function (message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
      const value = message as { cmd?: string; url?: string };
      if (value?.cmd === 'setmainfile') profiles.set(this, value.url ?? '');
      const send = () => Reflect.apply(original, this, options === undefined ? [message] : [message, options]);
      if (barrier.armed && profiles.get(this) === 'dondocs-tagged-main.tex' && value?.cmd === 'compilelatex') {
        barrier.held = true;
        barrier.release = () => { barrier.armed = false; barrier.held = false; send(); };
      } else send();
    };
  });
  await page.goto('/'); await importLetter(page, 'CANCELLED TAGGED SUBJECT', 'CANCELLED TAGGED BODY.');
  await warmEngine(page);
  const dialog = await taggedDialog(page);
  const downloads: string[] = []; const record = () => { downloads.push('unexpected delivery'); }; page.on('download', record);
  await dialog.getByRole('button', { name: 'Export tagged PDF', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { taggedCompileBarrier: { held: boolean } }).taggedCompileBarrier.held), { timeout: 30_000 }).toBe(true);
  await page.getByRole('button', { name: 'Cancel export', exact: true }).click();
  await page.evaluate(() => (window as unknown as { taggedCompileBarrier: { release(): void } }).taggedCompileBarrier.release());
  await expect(page.getByRole('button', { name: 'Cancel export', exact: true })).toBeHidden({ timeout: 60_000 });
  expect(downloads).toEqual([]); page.off('download', record);
  await page.getByRole('button', { name: 'Download', exact: true }).click({ trial: true });
  await importLetter(page, 'FOLLOWING NORMAL SUBJECT', 'FOLLOWING NORMAL BODY contains only the new document.');
  const output = await downloadBrowserPdf(page, info.project.name, async () => {
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Download PDF/ }).click();
  });
  const pdf = await PDFDocument.load(output);
  expect(pdf.catalog.has(PDFName.of('StructTreeRoot'))).toBe(false);
  const text = await textOf(output); expect(text).toContain('FOLLOWING NORMAL SUBJECT'); expect(text).toContain('FOLLOWING NORMAL BODY'); expect(text).not.toContain('CANCELLED TAGGED');
  await info.attach('following-normal.pdf', { body: output, contentType: 'application/pdf' });
});

for (const docType of ['standard_letter', 'naval_letter']) {
  test(`exports source-bound external reference links for ${docType}`, async ({ page }, info) => {
    await page.goto('/');
    await importLetter(page, 'LINKED TAGGED TRAINING', 'Use reference (a) for the retained training source.', docType, false, true);
    await warmEngine(page);
    const dialog = await taggedDialog(page);
    const output = await downloadBrowserPdf(page, info.project.name, () => dialog.getByRole('button', { name: 'Export tagged PDF', exact: true }).click());
    const pdf = await PDFDocument.load(output);
    const annotations = pdf.getPages().flatMap(page => page.node.Annots()?.asArray() ?? []);
    expect(annotations.length).toBeGreaterThan(0);
    for (const value of annotations) {
      const annotation = pdf.context.lookup(value, PDFDict);
      expect(annotation.get(PDFName.of('Subtype'))).toBe(PDFName.of('Link'));
      const uri = annotation.lookup(PDFName.of('A'), PDFDict).lookup(PDFName.of('URI'));
      expect(uri instanceof PDFString || uri instanceof PDFHexString ? uri.decodeText() : '').toBe('https://example.test/training?chapter=1&section=2');
      expect(annotation.has(PDFName.of('StructParent'))).toBe(true);
    }
    const reader = await getDocument({ data: new Uint8Array(output), useSystemFonts: false }).promise;
    try {
      const page = await reader.getPage(1);
      const structure = await page.getStructTree();
      expect(JSON.stringify(structure)).toContain('Link');
      expect((await page.getAnnotations()).some(annotation => annotation.url === 'https://example.test/training?chapter=1&section=2')).toBe(true);
    } finally { await reader.destroy(); }
    await info.attach(`${docType}-tagged-reference.pdf`, { body: output, contentType: 'application/pdf' });
  });
}
