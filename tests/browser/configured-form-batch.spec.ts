import { prepareOfflineApp } from '../_helpers/prepareOfflineApp';
import { test, expect, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { compileFormDefinition } from '../../src/services/forms/model';

async function fixture(recipientFieldId = 'name', recipientKind: 'identifier' | 'text' = 'identifier') {
  const pdf = await PDFDocument.create();
  const timestamp = new Date('2026-01-01T00:00:00Z');
  pdf.setCreationDate(timestamp);
  pdf.setModificationDate(timestamp);
  pdf.addPage([612, 792]).drawText('EXACT BATCH TEMPLATE', { x: 40, y: 760, font: await pdf.embedFont(StandardFonts.Helvetica) });
  const bytes = Buffer.from(await pdf.save());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const fields = {
    [recipientFieldId]: { kind: recipientKind, label: 'Fictional recipient', requiredAt: 'export' },
    eventDate: { kind: 'date', label: 'Event date', requiredAt: 'export' },
    amount: { kind: 'decimal', label: 'Amount' },
    decision: { kind: 'singleChoice', label: 'Decision', requiredAt: 'export', options: [{ id: 'approve', label: 'Approve' }, { id: 'return', label: 'Return' }] },
    signature: { kind: 'signature', label: 'Signature', requiredAt: 'sign' },
  };
  const definition = { schemaVersion: 2, formId: 'batch_fixture', label: 'Configured batch fixture', definitionRevision: 'original-v1', templateRevision: sha256, directory: 'batch-fixture',
    pages: [{ file: 'page1.pdf', width: 612, height: 792, sha256 }], fields,
    placements: [recipientFieldId, 'eventDate', 'amount', 'decision'].map((fieldId, index) => ({ fieldId, page: 1, appearance: 'text', overflow: 'error', box: { left: 40, top: 710 - index * 40, width: 400, height: 24 } })),
    sections: [{ id: 'identity', title: 'Identity', fields: Object.keys(fields) }], rowGroups: {} };
  return { bytes, definition, legacy: { genericForm: { definition, answers: { [recipientFieldId]: 'SOURCE PERSON', eventDate: '2026-01-01', decision: 'approve' }, rows: {}, answerRevision: 0 } } };
}
async function setup(page: Page, theme: string, portableTemplates = false, recipientFieldId = 'name', recipientKind: 'identifier' | 'text' = 'identifier') {
  const source = await fixture(recipientFieldId, recipientKind);
  await page.addInitScript(value => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'focused' } }));
  }, theme);
  await page.route('**/templates/**', route => route.request().url().endsWith('/batch-fixture/page1.pdf')
    ? route.fulfill({ status: 200, contentType: 'application/pdf', body: source.bytes })
    : route.fulfill({ status: 200, json: { templates: [] } }));
  await page.goto('/');
  let input: unknown = source.legacy;
  if (portableTemplates) {
    // Supply the exact blank through the supported portable format. Worker-owned
    // fetches can bypass page routes, so the offline scenario must not depend
    // on an unpublished fixture URL or on preview timing before worker claim.
    const definition = compileFormDefinition(source.definition);
    const path = `forms/${definition.pages[0].sha256}.pdf`;
    input = {
      kind: 'dondocs-draft', version: 3, documentKind: 'configured-form',
      documentMode: 'compliant', documentCategory: 'forms', docType: 'naval_letter',
      formType: definition.formId, formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [],
      genericForm: { ...source.legacy.genericForm, definition },
      portableFormTemplates: [{
        kind: 'dondocs-form-templates', version: 1,
        definitionSha256: createHash('sha256').update(JSON.stringify(definition)).digest('hex'),
        pages: { 'page1.pdf': path },
      }],
      portableResources: { kind: 'dondocs-resources', version: 1, entries: [{
        path, name: 'page1.pdf', mediaType: 'application/pdf', size: source.bytes.byteLength,
        sha256: definition.pages[0].sha256, data: source.bytes.toString('base64'),
      }] },
    };
  }
  await page.getByLabel('Import draft file', { exact: true }).setInputFiles({ name: 'batch-form.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(input)) });
  await page.getByRole('dialog', { name: 'Review draft', exact: true }).getByRole('button', { name: 'Open as new document', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Fictional recipient', exact: true })).toHaveValue('SOURCE PERSON');
  await page.getByRole('button', { name: 'Batch', exact: true }).click();
  return source;
}

for (const theme of ['light', 'dark', 'classic']) {
  test(`configured roster mapping uses typed fields without changing the source in ${theme}`, async ({ page }, info) => {
    await setup(page, theme);
    const batch = page.getByRole('dialog', { name: /^Batch generation \(Forms\)/ });
    await expect(batch.getByRole('region', { name: 'Configured form roster fields' })).toContainText('Signature fields stay blank');
    await expect(batch.getByRole('textbox', { name: 'Row 1: name' })).toHaveValue('');
    await batch.getByRole('textbox', { name: 'Row 1: name' }).fill('0000000123');
    await batch.getByRole('textbox', { name: 'Row 1: eventDate' }).fill('2026-02-29');
    await batch.getByRole('textbox', { name: 'Row 1: decision' }).fill('Approve');
    await expect(batch.getByRole('status', { name: 'Form row checks' })).toContainText('Enter a valid date');
    await expect(batch.getByRole('button', { name: 'Generate 1 PDF' })).toBeDisabled();
    await batch.getByRole('textbox', { name: 'Row 1: eventDate' }).fill('2026-02-28');
    await batch.getByRole('textbox', { name: 'Row 1: amount' }).fill('12.50');
    await expect(batch.getByRole('status', { name: 'Form row checks' })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`mapping-${theme}.png`), fullPage: true });
    await batch.getByRole('button', { name: 'Close panel', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Fictional recipient', exact: true })).toHaveValue('SOURCE PERSON');
  });
}

for (const fieldId of ['__skip__', 'skip']) {
  test(`configured roster manual mapping keeps the valid ${fieldId} field separate from Skip`, async ({ page }, info) => {
    await setup(page, 'light', true, fieldId);
    const { utils, write } = await import('xlsx');
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([
      ['Recipient', 'eventDate', 'decision'],
      ['0000000123', '2026-02-28', 'Approve'],
    ]), 'Roster');
    const batch = page.getByRole('dialog', { name: /^Batch generation \(Forms\)/ });
    await batch.getByLabel('Upload Excel roster (.xlsx)').setInputFiles({
      name: 'manual-field-roster.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: write(workbook, { type: 'buffer', bookType: 'xlsx' }),
    });
    await batch.getByRole('button', { name: 'Map 1 roster row', exact: true }).click();
    const mapping = batch.getByRole('combobox', { name: 'Map column 1: Recipient', exact: true });
    await mapping.click();
    await page.getByRole('option', { name: `{{${fieldId}}}`, exact: true }).click();
    await expect(mapping).toContainText(`{{${fieldId}}}`);
    await mapping.click();
    await page.getByRole('option', { name: '— Skip —', exact: true }).click();
    await expect(mapping).toContainText('— Skip —');
    await mapping.click();
    await page.getByRole('option', { name: `{{${fieldId}}}`, exact: true }).click();
    await batch.getByRole('button', { name: 'Apply Mapping', exact: true }).click();
    await expect(batch.getByRole('textbox', { name: `Row 1: ${fieldId}`, exact: true })).toHaveValue('0000000123');
    await expect(batch.getByRole('status', { name: 'Form row checks' })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`manual-mapping-${fieldId}.png`), fullPage: true });
    await batch.getByRole('button', { name: 'Close panel', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Fictional recipient', exact: true })).toHaveValue('SOURCE PERSON');
  });
}

for (const storage of ['precision', 'number', 'Excel date']) {
  test(`configured roster keeps ${storage} provenance visible until the affected value is corrected`, async ({ page }, info) => {
    await setup(page, 'light', true);
    const { utils, write } = await import('xlsx');
    const workbook = utils.book_new();
    const sheet = utils.aoa_to_sheet([
      ['name', 'eventDate', 'decision'],
      [storage === 'precision' ? 1234567890123456 : storage === 'number' ? 123 : 46000, '2026-02-28', 'Approve'],
    ]);
    if (storage === 'Excel date') sheet.A2.z = 'm/d/yy';
    utils.book_append_sheet(workbook, sheet, 'Roster');
    const warning = storage === 'precision' ? 'Excel may have rounded this number'
      : storage === 'number' ? 'Stored as a number; leading zeros' : 'Stored as an Excel date; the original identifier';
    const batch = page.getByRole('dialog', { name: /^Batch generation \(Forms\)/ });
    await batch.getByLabel('Upload Excel roster (.xlsx)').setInputFiles({
      name: 'identifier-warning-roster.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: write(workbook, { type: 'buffer', bookType: 'xlsx' }),
    });
    await batch.getByRole('button', { name: 'Map 1 roster row', exact: true }).click();
    await expect(batch.getByText(warning, { exact: false })).toBeVisible();
    await batch.getByRole('button', { name: 'Apply Mapping', exact: true }).click();
    const recipient = batch.getByRole('textbox', { name: 'Row 1: name', exact: true });
    await expect(batch.locator('#batch-roster-checks')).toContainText(warning);
    await expect(recipient).toHaveAttribute('aria-describedby', 'batch-roster-checks');
    await expect(batch.getByText(/Missing value/)).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('retained-excel-warning.png'), fullPage: true });
    await recipient.fill('0000000123');
    await expect(batch.locator('#batch-roster-checks')).toHaveCount(0);
    await expect(recipient).not.toHaveAttribute('aria-describedby');
    await batch.getByRole('button', { name: 'Close panel', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Fictional recipient', exact: true })).toHaveValue('SOURCE PERSON');
  });
}

for (const kind of ['text', 'identifier'] as const) {
  test(`configured roster preserves the ${kind} whitespace rule through a real workbook`, async ({ page }, info) => {
    await setup(page, 'light', true, 'name', kind);
    const { utils, write } = await import('xlsx');
    const workbook = utils.book_new();
    const raw = '  Recipient B  ';
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([
      ['name', 'eventDate', 'decision'],
      [raw, '2026-02-28', 'Approve'],
    ]), 'Roster');
    const batch = page.getByRole('dialog', { name: /^Batch generation \(Forms\)/ });
    await batch.getByLabel('Upload Excel roster (.xlsx)').setInputFiles({
      name: 'text-spacing-roster.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: write(workbook, { type: 'buffer', bookType: 'xlsx' }),
    });
    await batch.getByRole('button', { name: 'Map 1 roster row', exact: true }).click();
    await batch.getByRole('button', { name: 'Apply Mapping', exact: true }).click();
    await expect(batch.getByRole('textbox', { name: 'Row 1: name', exact: true })).toHaveValue(kind === 'text' ? raw : raw.trim());
    await expect(batch.getByRole('status', { name: 'Form row checks' })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`text-spacing-${kind}.png`), fullPage: true });
    await batch.getByRole('button', { name: 'Close panel', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Fictional recipient', exact: true })).toHaveValue('SOURCE PERSON');
  });
}

async function downloadedPdfText(bytes: Buffer): Promise<string> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  try {
    const content = await (await document.getPage(1)).getTextContent();
    return content.items.map(item => 'str' in item ? item.str : '').join(' ');
  } finally { await document.destroy(); }
}

async function workspaceAction(page: Page, name: string | RegExp): Promise<void> {
  const target = page.getByRole('button', { name, exact: typeof name === 'string' });
  if (!await target.isVisible()) await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await target.click();
}

test('configured batches preserve exact templates through interruption, source deletion, offline retry and ZIP delivery', async ({ page }, info) => {
  test.setTimeout(150_000);
  const { utils, write } = await import('xlsx');
  const { readFile, writeFile } = await import('node:fs/promises');
  const { default: JSZip } = await import('jszip');
  const policyRequest = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === '/classification.config.json'
      && url.searchParams.get('deployment-policy') === 'runtime';
  }).then(async request => {
    const response = await request.response();
    expect(response).not.toBeNull();
    // Retain the actual body before later setup can evict WebKit's inspector copy.
    return { request, body: await response!.text() };
  });
  const source = await setup(page, 'light', true);
  const { request: publishedPolicyRequest, body: publishedPolicyBody } = await policyRequest;
  await page.getByRole('dialog', { name: /^Batch generation \(Forms\)/ }).getByRole('button', { name: 'Close panel', exact: true }).click();
  await prepareOfflineApp(page);
  await page.getByRole('button', { name: 'Batch', exact: true }).click();
  const batch = page.getByRole('dialog', { name: /^Batch generation \(Forms\)/ });
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([
    ['name', 'eventDate', 'amount', 'decision'],
    ['0000000123', '2026-02-28', '12.50', 'Approve'],
    ['0000000456', '2026-03-01', '7.25', 'Return'],
  ]), 'Roster');
  await batch.getByLabel('Upload Excel roster (.xlsx)').setInputFiles({ name: 'configured-roster.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: write(workbook, { type: 'buffer', bookType: 'xlsx' }) });
  await batch.getByRole('button', { name: 'Map 2 roster rows', exact: true }).click();
  await batch.getByRole('button', { name: 'Apply Mapping', exact: true }).click();
  await batch.getByRole('button', { name: 'Generate 2 PDFs', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review batch row', exact: true });
  await expect(review).toContainText('0000000123.pdf');
  // Reload during a real pending row. Approval is not persisted as a reusable capability.
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Fictional recipient', exact: true })).toHaveValue('SOURCE PERSON');
  // Firefox's offline emulation rejects intercepted requests before the
  // service worker can answer them. Remove fixture routing; going offline below
  // still prevents every template request from reaching the source server.
  await page.unroute('**/templates/**');
  await workspaceAction(page, /^Actions for Configured batch fixture/);
  await page.getByRole('menuitem', { name: 'Move to Trash', exact: true }).click();
  await workspaceAction(page, 'Trash');
  const trash = page.getByRole('dialog', { name: 'Trash', exact: true });
  await trash.getByRole('button', { name: 'Delete permanently', exact: true }).click();
  await page.getByRole('alertdialog', { name: 'Permanently delete this document?', exact: true }).getByRole('button', { name: 'Delete permanently', exact: true }).click();
  await expect(trash.getByText('Trash is empty.', { exact: true })).toBeVisible();
  await trash.getByRole('button', { name: 'Close', exact: true }).click();
  // Warm the ordinary correspondence preview created after source deletion.
  // The batch supplies its own captured form pages, not application engine resources.
  await prepareOfflineApp(page);
  await page.context().setOffline(true);
  // Retry deliberately refreshes deployment policy. Verify the real worker can
  // supply that published policy offline before waiting for a row review.
  const offlinePolicy = await page.evaluate(async url => {
    const response = await fetch(url, { cache: 'no-cache' });
    return { status: response.status, body: await response.text() };
  }, publishedPolicyRequest.url());
  await writeFile(info.outputPath('offline-policy.json'), JSON.stringify({
    url: publishedPolicyRequest.url(), publishedPolicyBody, offlinePolicy,
  }, null, 2));
  expect(offlinePolicy).toEqual({ status: 200, body: publishedPolicyBody });
  await page.getByRole('button', { name: 'Batch', exact: true }).click();
  await expect(batch).toContainText('Interrupted batch');
  await expect(batch).toContainText('Check your downloads before retrying');
  const pdfs = new Map<string, Buffer>();
  for (const action of ['Resume remaining', 'Retry failed rows']) {
    const pending = info.project.name === 'mobile-chrome-ios' ? page.waitForEvent('popup') : page.waitForEvent('download');
    await batch.getByRole('button', { name: action, exact: true }).click();
    await review.getByRole('button', { name: 'Continue with this row', exact: true }).click();
    const received = await pending;
    const download = 'suggestedFilename' in received ? received : await (async () => {
      await expect(received.locator('iframe')).toHaveAttribute('src', /^data:application\/pdf;base64,/);
      const saving = received.waitForEvent('download');
      await received.getByRole('link', { name: 'Download PDF', exact: true }).click();
      const file = await saving;
      await received.close();
      return file;
    })();
    expect(await download.failure()).toBeNull();
    const bytes = await readFile((await download.path())!);
    pdfs.set(download.suggestedFilename(), bytes);
    await writeFile(info.outputPath(download.suggestedFilename()), bytes);
  }
  await expect(batch).toContainText('Batch complete · 2/2 generated');
  const first = await downloadedPdfText(pdfs.get('0000000123.pdf')!);
  const second = await downloadedPdfText(pdfs.get('0000000456.pdf')!);
  expect(first).toContain('EXACT BATCH TEMPLATE');expect(second).toContain('EXACT BATCH TEMPLATE');
  expect(first).toContain('0000000123');expect(first).toContain('2026-02-28');expect(first).toContain('12.50');expect(first).toContain('Approve');
  expect(second).toContain('0000000456');expect(second).toContain('7.25');expect(second).toContain('Return');
  expect(first).not.toContain('SOURCE PERSON');expect(first).not.toContain('0000000456');
  expect(await page.evaluate(async hash => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs');request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error); });
    try { return await new Promise<number>((resolve, reject) => { const request = db.transaction('attachments').objectStore('attachments').get(`form-template-${hash}`);request.onsuccess = () => resolve(request.result?.data?.byteLength ?? 0);request.onerror = () => reject(request.error); }); } finally { db.close(); }
  }, source.definition.pages[0].sha256)).toBe(source.bytes.byteLength);
  const zipPending = page.waitForEvent('download');
  await batch.getByRole('button', { name: 'Download ZIP', exact: true }).click();
  await page.getByRole('dialog', { name: 'Review ZIP download', exact: true }).getByRole('button', { name: 'Download reviewed ZIP', exact: true }).click();
  const zipped = await readFile((await (await zipPending).path())!);
  const archive = await JSZip.loadAsync(zipped);
  for (const [filename, bytes] of pdfs) expect(await archive.file(filename)!.async('nodebuffer')).toEqual(bytes);
  await page.screenshot({ path: info.outputPath('configured-batch-complete.png'), fullPage: true });
});

test('cancelling a configured row preserves answers for deliberate retry without delivering a PDF', async ({ page }) => {
  await setup(page, 'dark');
  const batch = page.getByRole('dialog', { name: /^Batch generation \(Forms\)/ });
  await batch.getByRole('textbox', { name: 'Row 1: name' }).fill('0000000123');
  await batch.getByRole('textbox', { name: 'Row 1: eventDate' }).fill('2026-03-02');
  await batch.getByRole('textbox', { name: 'Row 1: decision' }).fill('Approve');
  const downloads: string[] = [];
  page.on('download', download => downloads.push(download.suggestedFilename()));
  await batch.getByRole('button', { name: 'Generate 1 PDF', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review batch row', exact: true });
  await review.getByRole('button', { name: 'Cancel row and pause batch', exact: true }).click();
  await expect(batch).toContainText('Paused batch · 0/1 generated · 1 failed');
  await expect(batch.getByRole('textbox', { name: 'Row 1: name' })).toHaveValue('0000000123');
  await expect(batch.getByRole('button', { name: 'Retry failed rows', exact: true })).toBeEnabled();
  await expect(batch.getByRole('button', { name: 'Download ZIP', exact: true })).toBeDisabled();
  expect(downloads).toEqual([]);
});

test('a corrupt retained blank pauses a configured batch and allows retry after exact bytes are restored', async ({ page }, info) => {
  const { readFile, writeFile } = await import('node:fs/promises');
  const source = await setup(page, 'classic', true);
  const batch = page.getByRole('dialog', { name: /^Batch generation \(Forms\)/ });
  await batch.getByRole('textbox', { name: 'Row 1: name' }).fill('0000000123');
  await batch.getByRole('textbox', { name: 'Row 1: eventDate' }).fill('2026-03-02');
  await batch.getByRole('textbox', { name: 'Row 1: decision' }).fill('Approve');
  const attachmentId = `form-template-${source.definition.pages[0].sha256}`;
  const replaceRetainedBytes = async (bytes: number[]) => {
    await page.evaluate(async ({ id, data }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('dondocs');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction('attachments', 'readwrite');
          const store = transaction.objectStore('attachments');
          const read = store.get(id);
          read.onsuccess = () => {
            if (!read.result) {
              transaction.abort();
              return;
            }
            store.put({ ...read.result, data: new Uint8Array(data).buffer });
          };
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error ?? new Error('Missing retained template'));
        });
      } finally {
        db.close();
      }
    }, { id: attachmentId, data: bytes });
  };
  await replaceRetainedBytes([37, 80, 68, 70, 45, 0]);
  const downloads: string[] = [];
  page.on('download', download => downloads.push(download.suggestedFilename()));
  await batch.getByRole('button', { name: 'Generate 1 PDF', exact: true }).click();
  await expect(batch).toContainText('Paused batch · 0/1 generated · 1 failed');
  await expect(batch).toContainText('retained form template is corrupt');
  await expect(batch.getByRole('button', { name: 'Retry failed rows', exact: true })).toBeEnabled();
  expect(downloads).toEqual([]);
  await expect(page.getByRole('dialog', { name: 'Review batch row', exact: true })).toHaveCount(0);

  await page.reload();
  await page.getByRole('button', { name: 'Batch', exact: true }).click();
  await expect(batch).toContainText('retained form template is corrupt');
  await replaceRetainedBytes(Array.from(source.bytes));
  const pending = info.project.name === 'mobile-chrome-ios'
    ? page.waitForEvent('popup') : page.waitForEvent('download');
  await batch.getByRole('button', { name: 'Retry failed rows', exact: true }).click();
  await page.getByRole('dialog', { name: 'Review batch row', exact: true })
    .getByRole('button', { name: 'Continue with this row', exact: true }).click();
  const received = await pending;
  const downloaded = 'suggestedFilename' in received ? received : await (async () => {
    await expect(received.locator('iframe')).toHaveAttribute('src', /^data:application\/pdf;base64,/);
    const saving = received.waitForEvent('download');
    await received.getByRole('link', { name: 'Download PDF', exact: true }).click();
    const file = await saving;
    await received.close();
    return file;
  })();
  expect(await downloaded.failure()).toBeNull();
  const bytes = await readFile((await downloaded.path())!);
  await writeFile(info.outputPath('restored-retained-template.pdf'), bytes);
  const text = await downloadedPdfText(bytes);
  expect(text).toContain('EXACT BATCH TEMPLATE');
  expect(text).toContain('0000000123');
  expect(text).toContain('2026-03-02');
  expect(text).not.toContain('SOURCE PERSON');
  await expect(batch).toContainText('Batch complete · 1/1 generated');
  await expect(batch).not.toContainText('retained form template is corrupt');
});

for (const missing of ['rows', 'answers'] as const) {
  test(`a saved configured batch missing ${missing} fails closed after reload without crashing the workspace`, async ({ page }, info) => {
    await setup(page, 'light', true);
    let batch = page.getByRole('dialog', { name: /^Batch generation \(Forms\)/ });
    await batch.getByRole('textbox', { name: 'Row 1: name' }).fill('0000000123');
    await batch.getByRole('textbox', { name: 'Row 1: eventDate' }).fill('2026-03-02');
    await batch.getByRole('textbox', { name: 'Row 1: decision' }).fill('Approve');
    await batch.getByRole('button', { name: 'Generate 1 PDF', exact: true }).click();
    await page.getByRole('dialog', { name: 'Review batch row', exact: true })
      .getByRole('button', { name: 'Cancel row and pause batch', exact: true }).click();
    await expect(batch).toContainText('Paused batch · 0/1 generated · 1 failed');
    await page.evaluate(key => {
      const retained = JSON.parse(localStorage.getItem('dondocs-batch-job')!);
      delete retained.state.source.genericForm[key];
      localStorage.setItem('dondocs-batch-job', JSON.stringify(retained));
    }, missing);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.reload();
    await page.getByRole('button', { name: 'Batch', exact: true }).click();
    batch = page.getByRole('dialog', { name: /^Batch generation \(Forms\)/ });
    await expect(batch).toContainText('The selected form is incomplete or invalid');
    await expect(batch.getByRole('button', { name: 'Retry failed rows', exact: true })).toBeDisabled();
    expect(errors).toEqual([]);
    await batch.getByRole('button', { name: 'Close panel', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Fictional recipient', exact: true })).toHaveValue('SOURCE PERSON');
    await page.getByRole('button', { name: 'Batch', exact: true }).click();
    await batch.getByRole('button', { name: 'New batch', exact: true }).click();
    await page.getByRole('alertdialog', { name: 'Start a new batch?', exact: true })
      .getByRole('button', { name: 'Start new batch', exact: true }).click();
    await expect(batch.getByRole('region', { name: 'Configured form roster fields', exact: true })).toBeVisible();
    await expect(batch).not.toContainText('The selected form is incomplete or invalid');
    await expect(batch.getByRole('textbox', { name: 'Row 1: name', exact: true })).toHaveValue('');
    await page.screenshot({ path: info.outputPath(`incomplete-${missing}.png`), fullPage: true });
  });
}
