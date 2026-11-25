import { expect, test, type Locator, type Page } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createHash } from 'node:crypto';

test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { editorLayout: 'scroll', previewVisible: false } }));
    // Exercise the real print popup and PDF bytes without launching the browser's native PDF viewer.
    const open = window.open;
    window.open = (...args: Parameters<typeof open>) => {
      const popup = open.apply(window, args);
      if (popup && !args[0]) {
        const policy = popup.document.createElement('meta');
        policy.httpEquiv = 'Content-Security-Policy';
        policy.content = "frame-src 'none'";
        popup.document.head.append(policy);
      }
      return popup;
    };
  });
  await page.goto('/');
});

async function openDraft(page: Page, draft: unknown) {
  await page.getByLabel('Import draft file').setInputFiles({
    name: 'print-draft.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)),
  });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
}

async function print(page: Page, field: Locator) {
  const opening = page.waitForEvent('popup');
  await field.press('Control+p');
  return opening;
}

async function printedText(popup: Page) {
  const frame = popup.getByTitle('PDF to print');
  await expect(frame).toHaveAttribute('src', /^blob:/, { timeout: 45_000 });
  const bytes = await popup.evaluate(async url => Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())), (await frame.getAttribute('src'))!);
  expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe('%PDF-');
  const pdf = await getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false }).promise;
  try {
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const text = await (await pdf.getPage(i)).getTextContent();
      pages.push(text.items.map(item => 'str' in item ? item.str : '').join(' '));
    }
    return pages.join(' ').replace(/\s+/g, ' ');
  } finally { await pdf.destroy(); }
}

test('prints the edited letter immediately and withholds the earlier PDF on render failure', async ({ page }) => {
  const subject = page.getByRole('textbox', { name: 'Subject', exact: true });
  await subject.fill('PREVIOUS PRINT SUBJECT');

  // Wait for the earlier live preview to exist so the shortcut has stale bytes
  // available when the next edit starts its debounce.
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('[data-pdf-layer="active"] canvas').last()).toBeVisible({ timeout: 60_000 });
  const closePreview = page.getByRole('button', { name: 'Close preview', exact: true });
  if (await closePreview.isVisible()) await closePreview.click();
  else await page.getByRole('button', { name: 'Preview', exact: true }).click();

  await subject.fill('IMMEDIATE PRINT SUBJECT');
  const popup = await print(page, subject);
  const text = await printedText(popup);
  expect(text).toContain('IMMEDIATE PRINT SUBJECT');
  expect(text).not.toContain('PREVIOUS PRINT SUBJECT');
  await popup.close();

  await subject.fill('Synthetic long field '.repeat(1_001));
  const failed = await print(page, subject);
  await expect(failed.getByRole('status')).toContainText('Could not prepare this revision for print.', { timeout: 45_000 });
  await expect(failed.getByTitle('PDF to print')).toHaveCount(0);
});

test('blocks an invalid window-envelope print and prints the corrected letter', async ({ page }) => {
  await openDraft(page, {
    docType: 'naval_letter', documentMode: 'compliant', documentCategory: 'correspondence',
    formData: {
      subject: 'WINDOW PRINT CHECK', to: 'TRAINING OFFICE', unitLine1: 'TRAINING COMMAND',
      via: 'ROUTING OFFICE', windowEnvelope: 'standard', classLevel: 'unclassified',
    },
    paragraphs: [{ level: 0, text: 'Synthetic print fixture.' }], references: [], enclosures: [], copyTos: [], distributions: [],
  });
  const subject = page.getByRole('textbox', { name: 'Subject', exact: true });
  await expect(subject).toHaveValue('WINDOW PRINT CHECK');
  const rejected = await print(page, subject);
  await expect(rejected.getByRole('status')).toContainText('Remove Via routing');
  await expect(rejected.getByTitle('PDF to print')).toHaveCount(0);
  await rejected.close();

  await page.getByRole('textbox', { name: 'Via addressee 1', exact: true }).fill('');
  const corrected = await print(page, subject);
  expect(await printedText(corrected)).toContain('WINDOW PRINT CHECK');
  await corrected.close();
});

test('holds an in-flight form print for its revision and prints the latest form after a further edit', async ({ page }) => {
  await openDraft(page, {
    kind: 'dondocs-draft', version: 2, documentKind: 'builtin-form', documentCategory: 'forms', documentMode: 'compliant',
    docType: 'naval_letter', formType: 'navmc_118_11', formData: {}, paragraphs: [], references: [], enclosures: [],
    forms: { includeCoverPage: false, navmc11811: { lastName: 'BEFOREPRINT' } },
  });

  const lastName = page.getByRole('textbox', { name: 'Last Name', exact: true });
  await expect(lastName).toHaveValue('BEFOREPRINT');
  const first = await print(page, lastName);
  expect(await printedText(first)).toContain('BEFOREPRINT');
  await first.close();

  let release!: () => void;
  const paused = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/templates\/NAVMC11811[^/]+\/page1\.pdf$/, async route => {
    await paused;
    await route.continue();
  });
  const request = page.waitForRequest(/\/templates\/NAVMC11811[^/]+\/page1\.pdf$/);
  await lastName.fill('WAITINGPRINT');
  const waiting = await print(page, lastName);
  try {
    await request;
    await expect(waiting.getByRole('status')).toContainText('Preparing the current document for print');
    await expect(waiting.getByTitle('PDF to print')).toHaveCount(0);
    await lastName.fill('AFTERPRINT');
    await expect(waiting.getByRole('status')).toContainText('The draft changed');
    await expect(waiting.getByTitle('PDF to print')).toHaveCount(0);
    const abandoned = await print(page, lastName);
    await expect(abandoned.getByRole('status')).toContainText('Preparing the current document for print');
    await abandoned.close();
  } finally { release(); }

  const latest = await print(page, lastName);
  const text = await printedText(latest);
  expect(text).toContain('AFTERPRINT');
  expect(text).not.toContain('WAITINGPRINT');
  await expect(waiting.getByTitle('PDF to print')).toHaveCount(0);
});

test('prints the new NAVMC 10274 originator', async ({ page }) => {
  await openDraft(page, {
    kind: 'dondocs-draft', version: 2, documentKind: 'builtin-form', documentCategory: 'forms', documentMode: 'compliant',
    docType: 'naval_letter', formType: 'navmc_10274', formData: {}, paragraphs: [], references: [], enclosures: [],
    forms: { includeCoverPage: true, navmc10274: { from: 'PREVIOUS ORIGINATOR' } },
  });
  const originator = page.locator('#from');
  await expect(originator).toHaveValue('PREVIOUS ORIGINATOR');
  await originator.fill('CURRENT ORIGINATOR');
  const popup = await print(page, originator);
  const text = await printedText(popup);
  expect(text).toContain('CURRENT ORIGINATOR');
  expect(text).not.toContain('PREVIOUS ORIGINATOR');
});

test('prints the current answers on a configured form that is still a draft', async ({ page }) => {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]).drawText('CONFIGURED PRINT BLANK', { x: 40, y: 760, font: await pdf.embedFont(StandardFonts.Helvetica), size: 12 });
  const bytes = Buffer.from(await pdf.save());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const definition = {
    schemaVersion: 2, formId: 'print_fixture', label: 'Configured print fixture', definitionRevision: 'fixture-v1', templateRevision: sha256,
    directory: 'print-fixture', pages: [{ file: 'page1.pdf', width: 612, height: 792, sha256 }],
    fields: { name: { kind: 'text', label: 'Fictional name' }, authority: { kind: 'text', label: 'Authority', requiredAt: 'export' } },
    placements: [
      { fieldId: 'name', page: 1, appearance: 'text', overflow: 'error', box: { left: 40, top: 80, width: 400, height: 24 } },
      { fieldId: 'authority', page: 1, appearance: 'text', overflow: 'error', box: { left: 40, top: 120, width: 400, height: 24 } },
    ],
    sections: [{ id: 'identity', title: 'Identity', fields: ['name', 'authority'] }], rowGroups: {},
  };
  await page.route('**/templates/print-fixture/page1.pdf', route => route.fulfill({ status: 200, contentType: 'application/pdf', body: bytes }));
  await openDraft(page, { genericForm: { definition, answers: { name: 'Former draft answer' }, rows: {}, answerRevision: 0 } });
  const name = page.getByRole('textbox', { name: 'Fictional name', exact: true });
  await expect(name).toHaveValue('Former draft answer');
  await expect(page.getByRole('textbox', { name: 'Authority', exact: true })).toHaveValue('');
  await name.fill('Current draft answer');
  const popup = await print(page, name);
  const text = await printedText(popup);
  expect(text).toContain('CONFIGURED PRINT BLANK');
  expect(text).toContain('Current draft answer');
  expect(text).not.toContain('Former draft answer');
});
