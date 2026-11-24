import { test, expect, type Page, type Download } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { utils, write } from 'xlsx';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { instructionWordSource } from '../_helpers/publicationWordQualification';

test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);

const SUBJECT = 'BROWSER EXPORT VERIFICATION';
const BODY = 'This fictional training document verifies the downloaded content.';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
});

async function start(page: Page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Subject', exact: true }).fill(SUBJECT);
  await page.getByRole('textbox', { name: 'Paragraph 1', exact: true }).fill(BODY);
}

async function chooseExport(page: Page, name: string) {
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await page.getByRole('menuitem', { name: name === 'Download PDF' ? /^Download PDF(?:\s|$)/ : name, exact: name !== 'Download PDF' }).click();
}

async function downloadBytes(download: Download) {
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect(path).toBeTruthy();
  return readFile(path!);
}

async function expectPdf(bytes: Uint8Array, expectedText: string[] = []) {
  expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe('%PDF-');
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  try {
    expect(pdf.numPages).toBeGreaterThan(0);
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const content = await (await pdf.getPage(number)).getTextContent();
      pages.push(content.items.map(item => 'str' in item ? item.str : '').join(' '));
    }
    const text = pages.join(' ').replace(/\s+/g, ' ');
    for (const expected of expectedText) expect(text).toContain(expected);
  } finally {
    await pdf.destroy();
  }
}

async function preparePdfExport(page: Page) {
  const preview = page.getByRole('button', { name: 'Preview', exact: true });
  if (await preview.getAttribute('aria-haspopup') === 'dialog') {
    await preview.click();
    const modal = page.getByRole('dialog', { name: 'PDF preview', exact: true });
    const download = modal.getByRole('button', { name: 'Download', exact: true });
    await expect(download).toBeVisible({ timeout: 60_000 });
    return () => download.click();
  }
  if (await preview.getAttribute('aria-pressed') !== 'true') await preview.click();
  await expect(page.locator('.workspace-preview [title="Document preview"]').first()).toBeAttached({ timeout: 60_000 });
  return () => chooseExport(page, 'Download PDF');
}

async function expectPdfExport(page: Page, projectName: string, exportPdf: () => Promise<void>, filename: RegExp, expectedText: string[] = []) {
  if (projectName === 'mobile-chrome-ios') {
    const pending = page.waitForEvent('popup');
    await exportPdf();
    const popup = await pending;
    try {
      const frame = popup.locator('iframe');
      await expect(frame).toHaveAttribute('src', /^data:application\/pdf;base64,/, { timeout: 30_000 });
      await expectPdf(Buffer.from((await frame.getAttribute('src'))!.split(',')[1], 'base64'), expectedText);
      const saving = popup.waitForEvent('download');
      await popup.getByRole('link', { name: 'Download PDF', exact: true }).click();
      const download = await saving;
      expect(download.suggestedFilename()).toMatch(filename);
      const bytes = await downloadBytes(download);
      await expectPdf(bytes, expectedText);
      return bytes;
    } finally { await popup.close(); }
  } else {
    const pending = page.waitForEvent('download');
    await exportPdf();
    const download = await pending;
    expect(download.suggestedFilename()).toMatch(filename);
    const bytes = await downloadBytes(download);
    await expectPdf(bytes, expectedText);
    return bytes;
  }
}

async function expectWord(download: Download) {
  expect(download.suggestedFilename()).toMatch(/browser-export-verification\.docx$/);
  const zip = await JSZip.loadAsync(await downloadBytes(download), { checkCRC32: true });
  expect(zip.file('[Content_Types].xml')).toBeTruthy();
  const xml = await zip.file('word/document.xml')!.async('string');
  expect(xml).toContain(SUBJECT);
  expect(xml).toContain(BODY);
}

test('an Excel roster generates real PDFs and downloads their exact saved results as ZIP', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('BATCH ZIP FOR {{NAME}}');
  await page.getByRole('textbox', { name: 'Paragraph 1', exact: true }).fill('Fictional batch PDF: {{BODY}}');
  await page.getByRole('button', { name: 'Batch', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Batch generation', exact: true });
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([
    ['NAME', 'BODY'], ['CON', 'First training document.'], ['_CON', 'Second training document.'],
  ]), 'Roster');
  await modal.getByLabel('Upload Excel roster (.xlsx)').setInputFiles({
    name: 'fictional-zip-roster.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: write(workbook, { type: 'buffer', bookType: 'xlsx' }),
  });
  await modal.getByRole('button', { name: 'Map 2 roster rows', exact: true }).click();
  await modal.getByRole('button', { name: 'Apply Mapping', exact: true }).click();
  await expect(modal.getByRole('textbox', { name: 'Row 1: NAME', exact: true })).toHaveValue('CON');
  await expect(modal.getByRole('textbox', { name: 'Row 2: NAME', exact: true })).toHaveValue('_CON');
  await expect(modal.getByRole('textbox', { name: 'Row 1: BODY', exact: true })).toHaveValue('First training document.');
  await expect(modal.getByRole('textbox', { name: 'Row 2: BODY', exact: true })).toHaveValue('Second training document.');
  const generate = modal.getByRole('button', { name: 'Generate 2 PDFs', exact: true });
  await expect(generate).toBeEnabled({ timeout: 60_000 });
  await generate.click();
  await expect(modal.getByRole('status').filter({ hasText: 'Batch complete' })).toContainText('2/2 generated', { timeout: 60_000 });

  const savedBytes = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('dondocs', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<number[][]>((resolve, reject) => {
        const request = db.transaction('app', 'readonly').objectStore('app').getAll();
        request.onsuccess = () => {
          const records = request.result as Array<{ key: string; value: Uint8Array }>;
          resolve(records.filter(record => record.key.startsWith('batch:')).map(record => Array.from(record.value)));
        };
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  });
  expect(savedBytes).toHaveLength(2);
  const pending = page.waitForEvent('download', { predicate: download => download.suggestedFilename().endsWith('.zip') });
  await modal.getByRole('button', { name: 'Download ZIP', exact: true }).click();
  const zip = await JSZip.loadAsync(await downloadBytes(await pending), { checkCRC32: true });
  expect(Object.keys(zip.files)).toEqual(['_CON (2).pdf', '_CON.pdf']);
  const remaining = savedBytes.map(bytes => Buffer.from(bytes));
  for (const [filename, body] of [['_CON (2).pdf', 'First training document.'], ['_CON.pdf', 'Second training document.']]) {
    const packed = await zip.file(filename)!.async('nodebuffer');
    const match = remaining.findIndex(bytes => bytes.equals(packed));
    expect(match).toBeGreaterThanOrEqual(0);
    remaining.splice(match, 1);
    await expectPdf(packed, [`Fictional batch PDF: ${body}`]);
  }
  expect(remaining).toHaveLength(0);
  await expect(modal.getByText('ZIP ready: 2 PDFs included; 0 rows omitted.')).toBeVisible();
});

test('batch ZIP downloads retain duplicate PDFs and identify omitted results', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Batch', exact: true })).toBeEnabled();
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('Fictional batch ZIP sample');
  const bytes = Array.from(await pdf.save());
  await page.evaluate(async data => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('dondocs', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('app', 'readwrite');
        for (const id of ['zip-one', 'zip-two']) transaction.objectStore('app').put({ key: `batch:${id}`, value: new Uint8Array(data) });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally { db.close(); }
    localStorage.setItem('dondocs-batch-job', JSON.stringify({ version: 0, state: {
      source: null, jobId: 'zip-browser-test', status: 'complete', title: 'Fictional batch', placeholders: [], recoveryError: '', rows: [
        { id: 'one', values: {}, status: 'success', outputId: 'zip-one', filename: 'Sample.pdf' },
        { id: 'two', values: {}, status: 'success', outputId: 'zip-two', filename: 'Sample.pdf' },
        { id: 'failed', values: {}, status: 'error', error: 'Sample generation failure' },
        { id: 'missing', values: {}, status: 'success', outputId: 'zip-missing', filename: 'missing.pdf' },
      ],
    } }));
  }, bytes);
  await page.reload();
  await page.getByRole('button', { name: 'Batch', exact: true }).click();
  await page.getByRole('button', { name: 'Download ZIP', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review ZIP download' });
  await expect(review).toContainText('source text for this saved result is unavailable');
  const pending = page.waitForEvent('download');
  await review.getByRole('button', { name: 'Download ZIP without text review' }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('dondocs-batch-results.zip');
  const zip = await JSZip.loadAsync(await downloadBytes(download), { checkCRC32: true });
  expect(Object.keys(zip.files)).toEqual(['Sample.pdf', 'Sample (2).pdf']);
  for (const filename of ['Sample.pdf', 'Sample (2).pdf']) {
    await expectPdf(await zip.file(filename)!.async('uint8array'), ['Fictional batch ZIP sample']);
  }
  await expect(page.getByText('ZIP ready: 2 PDFs included; 2 rows omitted.')).toBeVisible();
  await expect(page.getByText('Row #3: Failed: Sample generation failure')).toBeVisible();
  const missingResult = page.getByText(/Row #4.*missing.pdf.*missing or could not be read/);
  await missingResult.scrollIntoViewIfNeeded();
  await expect(missingResult).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Close panel', exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('batch-results-zip.png'), fullPage: true });
});

test('an oversized batch ZIP is refused while its original PDF remains individually downloadable', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Batch', exact: true })).toBeEnabled();
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('Fictional retained PDF after ZIP budget refusal.');
  const original = Array.from(await pdf.save());
  await page.evaluate(async prefix => {
    // PDF readers allow trailing whitespace. Retain a valid oversized PDF,
    // rather than manufacturing an invalid file that fails for another reason.
    const bytes = new Uint8Array(25 * 1024 * 1024 + 1).fill(32);
    bytes.set(prefix);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('dondocs', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('app', 'readwrite');
        transaction.objectStore('app').put({ key: 'batch:zip-budget', value: bytes });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
    localStorage.setItem('dondocs-batch-job', JSON.stringify({ version: 0, state: {
      source: null, jobId: 'zip-budget', status: 'complete', title: 'Fictional budget example',
      placeholders: [], recoveryError: '', rows: [
        { id: 'one', values: {}, status: 'success', outputId: 'zip-budget', filename: 'large.pdf' },
      ],
    } }));
  }, original);
  await page.reload();
  await page.getByRole('button', { name: 'Batch', exact: true }).click();
  const panel = page.getByRole('dialog', { name: /Batch/i }).first();
  await expect(panel.getByText(/ZIP limits: 500 PDFs/)).toBeVisible();
  const downloads: Download[] = [];
  page.on('download', download => downloads.push(download));
  await panel.getByRole('button', { name: 'Download ZIP', exact: true }).click();
  await page.getByRole('dialog', { name: 'Review ZIP download' })
    .getByRole('button', { name: 'Download ZIP without text review' }).click();
  await expect(panel.getByRole('alert')).toContainText('25 MB per-file batch ZIP limit');
  expect(downloads).toHaveLength(0);
  await panel.getByRole('button', { name: 'Download large.pdf', exact: true }).click();
  const bytes = await expectPdfExport(page, testInfo.project.name,
    () => page.getByRole('dialog').filter({ hasText: 'source text' }).getByRole('button', { name: /without text review/i }).click(),
    /^large\.pdf$/, ['Fictional retained PDF after ZIP budget refusal.']);
  const expectedSize = 25 * 1024 * 1024 + 1;
  expect(bytes.byteLength).toBe(expectedSize);
  expect([...bytes.subarray(0, original.length)]).toEqual(original);
  const expectedDigest = createHash('sha256').update(Uint8Array.from(original))
    .update(Buffer.alloc(expectedSize - original.length, 32)).digest('hex');
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(expectedDigest);
});

test('LaTeX exports contain the latest subject and paragraph with useful filenames', async ({ page }) => {
  await start(page);
  for (const name of ['Download LaTeX', 'Download Flat LaTeX (Pandoc)']) {
    const pending = page.waitForEvent('download');
    await chooseExport(page, name);
    const download = await pending;
    expect(download.suggestedFilename()).toMatch(name === 'Download LaTeX'
      ? /browser-export-verification\.tex$/ : /^correspondence-flat\.tex$/);
    const content = (await downloadBytes(download)).toString('utf8');
    expect(content).toContain(SUBJECT);
    expect(content).toContain(BODY);
    if (name.includes('Flat')) {
      expect(content).toContain('\\begin{document}');
      expect(content).toContain('\\end{document}');
    }
  }
});

test('draft export downloads parseable JSON for the active document', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export draft (.json)', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/^dondocs-draft-\d{4}-\d{2}-\d{2}\.json$/);
  const draft = JSON.parse((await downloadBytes(download)).toString('utf8'));
  expect(draft.formData.subject).toBe(SUBJECT);
  expect(JSON.stringify(draft.paragraphs)).toContain(BODY);
  expect(draft.documentCategory).toBe('correspondence');
});

test('PDF export delivers a readable file containing the latest editor content', async ({ page }, testInfo) => {
  await start(page);
  // Wait for real SwiftLaTeX output and exercise the mobile preview's download
  // control on phones/tablets, or the header's Download PDF menu on desktop.
  const exportPdf = await preparePdfExport(page);
  const bytes = await expectPdfExport(page, testInfo.project.name, exportPdf, /browser-export-verification\.pdf$/, [SUBJECT, BODY]);
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(document.getCreator()).toBe('DonDocs');
  expect(document.getProducer()).toBe('DonDocs (pdfTeX)');
  expect(document.getAuthor()).toBeUndefined();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue(SUBJECT);
});

test('I-Type PDF download resolves a table citation without opening batch generation', async ({ page }, info) => {
  const source = instructionWordSource();
  const referenceId = 'A'.repeat(32);
  source.paragraphs[0].text = `Inspect using {{PUBREF_T_${referenceId}}}.`;
  source.paragraphs[1].text = source.paragraphs[1].text.replace('office@example.mil', 'office@usmc.mil');
  source.paragraphs.push({ level: 0, referenceId, tableKey: 'majorItems', header: 'Major Items Affected', text: '' });
  source.publicationTables.majorItems = [{ values: {
    description: 'TRAINING COMPONENT', nsn: '1005-01-566-1100', tamcn: 'A02557G', id: '12345A',
  } }];
  await page.goto('/');
  await page.getByLabel('Import draft file').setInputFiles({
    name: 'instruction-with-citation.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...source, documentCategory: 'correspondence', documentMode: 'compliant',
      references: [], copyTos: [], enclosures: [] })),
  });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  const exportPdf = await preparePdfExport(page);
  await expectPdfExport(page, info.project.name, exportPdf, /\.pdf$/, ['Inspect using table 1.', 'TRAINING COMPONENT']);
  await expect(page.getByRole('dialog', { name: 'Batch generation', exact: true })).toHaveCount(0);
});

test('built-in form downloads a readable PDF and hides inapplicable Word exports', async ({ page }, testInfo) => {
  await start(page);
  await page.getByRole('button', { name: 'Forms', exact: true }).click();
  const exportPdf = await preparePdfExport(page);
  const bytes = await expectPdfExport(page, testInfo.project.name, exportPdf, /^NAVMC-10274-.*\.pdf$/);
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(document.getCreator()).toBe('DonDocs');
  expect(document.getProducer()).toBe('DonDocs (pdf-lib)');
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Download LaTeX', exact: true })).toHaveCount(0);
});

test('Word export runs Pandoc WASM and downloads a valid DOCX with editor content', async ({ page }) => {
  await start(page);
  const pending = page.waitForEvent('download');
  await chooseExport(page, 'Download Word (.docx)');
  await expectWord(await pending);
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });
});

test('additional endorsements and bottom page numbers reach both downloaded formats', async ({ page }, testInfo) => {
  await start(page);
  const section = page.getByRole('combobox', { name: 'Document section', exact: true });
  await section.selectOption('addressing');
  await page.getByRole('textbox', { name: 'From', exact: true }).fill('Training Command');
  await page.getByRole('textbox', { name: 'To', exact: true }).fill('Training Officer');
  await section.selectOption('signature');
  const enabled = page.getByRole('checkbox', { name: 'Add an acknowledgement endorsement' });
  await enabled.check();
  await page.getByRole('region', { name: 'First endorsement', exact: true })
    .getByLabel('Endorsement text').fill('First acknowledgement retained.\nFirst endorsement verified.');
  await page.getByRole('button', { name: 'Add another endorsement', exact: true }).click();
  await page.getByRole('region', { name: 'New endorsement', exact: true })
    .getByLabel('Endorsement text').fill('Second approval retained.\nSecond endorsement verified.');
  const second = page.getByRole('region', { name: 'SECOND endorsement', exact: true });
  await second.getByRole('textbox', { name: /signer last name/i }).fill('REVIEWER');

  const wordPending = page.waitForEvent('download');
  await chooseExport(page, 'Download Word (.docx)');
  const zip = await JSZip.loadAsync(await downloadBytes(await wordPending), { checkCRC32: true });
  const xml = await zip.file('word/document.xml')!.async('string');
  for (const text of ['FIRST ENDORSEMENT', 'SECOND ENDORSEMENT', 'First acknowledgement retained.', 'Second approval retained.', 'REVIEWER', 'DonDocsAckStartFIRST']) expect(xml).toContain(text);
  expect(xml).toContain('<w:keepNext/>');
  expect(await zip.file('word/footer1.xml')!.async('string')).not.toContain(' PAGE ');
  expect(await zip.file('word/footer2.xml')!.async('string')).toContain(' PAGE ');

  const downloadPdf = await preparePdfExport(page);
  let pdfBytes: Uint8Array;
  if (testInfo.project.name === 'mobile-chrome-ios') {
    const pending = page.waitForEvent('popup');
    await downloadPdf();
    const popup = await pending;
    const frame = popup.locator('iframe');
    await expect(frame).toHaveAttribute('src', /^data:application\/pdf;base64,/, { timeout: 30_000 });
    await expectPdf(Buffer.from((await frame.getAttribute('src'))!.split(',')[1], 'base64'),
      ['FIRST ENDORSEMENT', 'SECOND ENDORSEMENT', 'Second approval retained.']);
    const saving = popup.waitForEvent('download');
    await popup.getByRole('link', { name: 'Download PDF', exact: true }).click();
    pdfBytes = await downloadBytes(await saving);
    await popup.close();
  } else {
    const pending = page.waitForEvent('download');
    await downloadPdf();
    pdfBytes = await downloadBytes(await pending);
  }
  const pdf = await getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: false }).promise;
  try {
    expect(pdf.numPages).toBe(2);
    const first = await (await pdf.getPage(1)).getTextContent();
    const second = await (await pdf.getPage(2)).getTextContent();
    expect(first.items.map(item => 'str' in item ? item.str : '').join(' ')).toContain('FIRST ENDORSEMENT');
    expect(second.items.map(item => 'str' in item ? item.str : '').join(' ')).toContain('SECOND ENDORSEMENT');
    expect(second.items.some(item => 'str' in item && item.str.trim() === '2' && item.transform[5] < 60)).toBe(true);
    expect(first.items.some(item => 'str' in item && item.str.trim() === '1' && item.transform[5] < 60)).toBe(false);
  } finally {
    await pdf.destroy();
  }
});

test('PDF startup error offers Retry and recovers once the engine is ready', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The desktop preview exposes engine readiness behind the error dialog');
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/swiftlatexpdftex.wasm*', async route => {
    await held;
    await route.continue();
  });
  await start(page);
  await chooseExport(page, 'Download PDF');
  const error = page.getByRole('dialog', { name: 'Engine still starting up', exact: true });
  await expect(error).toBeVisible();
  await expect(error.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  release();
  await expect(page.locator('.workspace-preview [title="Document preview"]').first()).toBeAttached({ timeout: 60_000 });
  const pending = page.waitForEvent('download');
  await error.getByRole('button', { name: 'Retry', exact: true }).click();
  await expectPdf(await downloadBytes(await pending), [SUBJECT, BODY]);
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });
});

for (const resource of ['reference.docx', 'pandoc.wasm.manifest.json']) {
  test(`Word download failure is visible and Retry recovers after ${resource}`, async ({ page }) => {
    let unavailable = true;
    await page.route(url => url.pathname.endsWith(`/lib/pandoc/${resource}`), async route => {
      if (unavailable) await route.fulfill({ status: 503, body: 'Temporarily unavailable' });
      else await route.continue();
    });
    await start(page);
    await chooseExport(page, 'Download Word (.docx)');
    const error = page.getByRole('dialog', { name: 'DOCX download failed', exact: true });
    await expect(error).toBeVisible({ timeout: 60_000 });
    await expect(error).toContainText('503');
    unavailable = false;
    const pending = page.waitForEvent('download', { timeout: 30_000 });
    await error.getByRole('button', { name: 'Retry', exact: true }).click();
    await expectWord(await pending);
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue(SUBJECT);
  });
}

test('business letters export sender symbols and closing notations from the editor', async ({ page }, info) => {
  await page.goto('/');
  const draft = {
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'business_letter', formType: 'navmc_10274',
    formData: {
      date: 'November 18, 2026', ssic: '5630', officeCode: 'N43', serial: '081', classLevel: 'unclassified',
      unitLine1: 'SYNTHETIC TRAINING UNIT', subject: 'BUSINESS LETTER LAYOUT CHECK',
      to: 'Training recipient', sigLast: 'CLOSINGSIGNATURE', showSubjectOnContinuation: true,
    },
    paragraphs: Array.from({ length: 75 }, (_, index) => ({ id: `body-${index}`, level: 0,
      text: `BODYPROBE${index} contains a fictional training line for verification of multi-page correspondence.`,
    })),
    references: [], enclosures: [{ title: 'Training outline' }], copyTos: [{ text: 'Training coordinator' }], distributions: [],
  };
  await page.getByLabel('Import draft file').setInputFiles({
    name: 'business-letter-layout.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)),
  });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review draft', exact: true })).toBeHidden();
  const section = page.getByRole('combobox', { name: 'Document section', exact: true });
  await section.selectOption('addressing');
  await expect(page.locator('#ssic')).toHaveValue('5630');
  await expect(page.locator('#serial')).toHaveValue('081');
  await expect(page.getByLabel('Show subject line on continuation pages')).toHaveCount(0);
  await section.selectOption('enclosures');
  await page.getByLabel('Separate mailing', { exact: true }).fill('Separate course guide & agenda');

  const pending = page.waitForEvent('download');
  await chooseExport(page, 'Download Word (.docx)');
  const word = await pending;
  await word.saveAs(info.outputPath('chapter-11.docx'));
  const zip = await JSZip.loadAsync(await downloadBytes(word), { checkCRC32: true });
  const content = await zip.file('word/document.xml')!.async('string');
  expect(content).toMatch(/5630.*Ser N43\/081.*November 18, 2026.*BODYPROBE74.*CLOSINGSIGNATURE.*Enclosure:.*Training outline.*Separate Mailing:.*Separate course guide &amp; agenda.*Copy to:/s);
  const continuation = await zip.file('word/header2.xml')!.async('string');
  expect(continuation).toMatch(/5630.*Ser N43\/081.*November 18, 2026/s);
  expect(continuation).not.toContain('BUSINESS LETTER LAYOUT CHECK');
  expect(await zip.file('word/footer1.xml')!.async('string')).not.toContain(' PAGE ');
  expect(await zip.file('word/footer2.xml')!.async('string')).toContain(' PAGE ');

  const pdf = await expectPdfExport(page, info.project.name, await preparePdfExport(page), /\.pdf$/i, [
    '5630', 'Ser N43/081', 'November 18, 2026', 'Enclosure: Training outline', 'Separate Mailing: Separate course guide & agenda',
  ]);
  const parsed = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: false }).promise;
  try {
    expect(parsed.numPages).toBeGreaterThanOrEqual(3);
    const secondPage = await (await parsed.getPage(2)).getTextContent();
    const text = secondPage.items.map(item => 'str' in item ? item.str : '').join(' ');
    expect(text).toMatch(/5630.*Ser N43\/081.*November 18, 2026/);
    expect(text).not.toContain('BUSINESS LETTER LAYOUT CHECK');
  } finally {
    await parsed.destroy();
  }
});
