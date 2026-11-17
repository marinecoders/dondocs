import { expect, test, type Page } from '@playwright/test';
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { downloadBrowserPdf } from '../_helpers/downloadBrowserPdf';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(180_000);
test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning')); });
async function importLetter(page: Page, subject: string, text: string, docType = 'standard_letter', original = false) {
  await page.getByLabel('Import draft file', { exact: true }).setInputFiles({ name: 'letter.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    documentCategory: 'correspondence', documentMode: 'custom', docType,
    formData: { subject, from: 'Training Marine', to: 'Training Office', unitLine1: 'TRAINING COMMAND', date: '16 Nov 26', signatureType: 'none', classLevel: 'unclassified' },
    paragraphs: [{ id: 'training-body', level: 0, header: 'Purpose', text }], references: [], enclosures: original ? [{ title: 'Original signed PDF' }] : [], copyTos: [], distributions: [],
  })) });
  const review = page.getByRole('dialog', { name: 'Review draft', exact: true });
  await review.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await expect(review).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue(subject);
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

for (const docType of ['standard_letter', 'naval_letter']) {
  test(`exports actual structured ${docType} content and blocks an unsupported original attachment`, async ({ page }, info) => {
    await page.goto('/');
    await importLetter(page, 'TAGGED TRAINING LETTER', Array.from({ length: 45 }, (_, i) => `Training sentence ${i + 1} retains meaningful **bold** text across line wraps and page boundaries.`).join(' '), docType);
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
    await expect(page.getByRole('dialog', { name: 'Downloaded', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Downloaded', exact: true })).toBeHidden();
    // An original PDF is a separate package member, never silently retagged.
    await importLetter(page, 'ORIGINAL PACKAGE', 'Keep the original signed member.', docType, true);
    const unsupported = await taggedDialog(page);
    await expect(unsupported.getByRole('status')).toContainText('cannot include original PDFs or enclosures');
    await expect(unsupported.getByRole('button', { name: 'Export tagged PDF', exact: true })).toBeDisabled();
    await unsupported.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await page.getByRole('textbox', { name: 'Subject', exact: true }).inputValue()).toBe('ORIGINAL PACKAGE');
  });
}

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
  const dialog = await taggedDialog(page);
  const downloads: string[] = []; const record = () => { downloads.push('unexpected delivery'); }; page.on('download', record);
  await dialog.getByRole('button', { name: 'Export tagged PDF', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { taggedCompileBarrier: { held: boolean } }).taggedCompileBarrier.held)).toBe(true);
  await page.getByRole('button', { name: 'Cancel export', exact: true }).click();
  await page.evaluate(() => (window as unknown as { taggedCompileBarrier: { release(): void } }).taggedCompileBarrier.release());
  await expect(page.getByRole('button', { name: 'Cancel export', exact: true })).toBeHidden({ timeout: 60_000 });
  expect(downloads).toEqual([]); page.off('download', record);
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
