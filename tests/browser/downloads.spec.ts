import { test, expect, type Page, type Download } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

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
      await expectPdf(await downloadBytes(download), expectedText);
    } finally { await popup.close(); }
  } else {
    const pending = page.waitForEvent('download');
    await exportPdf();
    const download = await pending;
    expect(download.suggestedFilename()).toMatch(filename);
    await expectPdf(await downloadBytes(download), expectedText);
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
  await expectPdfExport(page, testInfo.project.name, exportPdf, /browser-export-verification\.pdf$/, [SUBJECT, BODY]);
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue(SUBJECT);
});

test('built-in form downloads a readable PDF and hides inapplicable Word exports', async ({ page }, testInfo) => {
  await start(page);
  await page.getByRole('button', { name: 'Forms', exact: true }).click();
  const exportPdf = await preparePdfExport(page);
  await expectPdfExport(page, testInfo.project.name, exportPdf, /^NAVMC-10274-.*\.pdf$/);
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
  await page.getByRole('combobox', { name: 'Document section', exact: true }).selectOption('signature');
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
