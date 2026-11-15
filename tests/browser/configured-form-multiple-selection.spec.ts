import { test, expect, type Download, type Page, type TestInfo } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { compileFormDefinition } from '../../src/services/forms/model';

async function openFixture(page: Page, theme: string) {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]).drawText('MULTIPLE SELECTION TEMPLATE', { x: 40, y: 760, font: await pdf.embedFont(StandardFonts.Helvetica) });
  const bytes = Buffer.from(await pdf.save());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const definition = compileFormDefinition({
    schemaVersion: 2, formId: 'multiple_batch_fixture', label: 'Multiple selection fixture',
    definitionRevision: 'v1', templateRevision: sha256, directory: 'multiple-batch-fixture',
    pages: [{ file: 'page1.pdf', width: 612, height: 792, sha256 }],
    fields: {
      name: { kind: 'identifier', label: 'Fictional recipient', requiredAt: 'export' },
      selections: { kind: 'multipleChoice', label: 'Selections', requiredAt: 'export', options: [
        { id: 'alpha', label: 'Alpha' }, { id: 'beta', label: 'Beta' }, { id: 'gamma', label: 'Gamma' },
      ] },
      optional: { kind: 'multipleChoice', label: 'Optional selections', options: [{ id: 'source', label: 'Source-only' }] },
    },
    placements: [
      { fieldId: 'name', page: 1, appearance: 'text', overflow: 'error', box: { left: 40, top: 710, width: 400, height: 24 } },
      { fieldId: 'selections', page: 1, appearance: 'text', overflow: 'error', box: { left: 40, top: 600, width: 400, height: 24 } },
      ...['alpha', 'beta', 'gamma'].map((optionId, index) => ({ fieldId: 'selections', optionId, page: 1, appearance: 'mark', overflow: 'error', box: { left: 40 + index * 40, top: 650, width: 12, height: 12 } })),
      { fieldId: 'optional', page: 1, appearance: 'text', overflow: 'error', box: { left: 40, top: 550, width: 400, height: 24 } },
      { fieldId: 'optional', optionId: 'source', page: 1, appearance: 'mark', overflow: 'error', box: { left: 200, top: 650, width: 12, height: 12 } },
    ],
    sections: [{ id: 'answers', title: 'Answers', fields: ['name', 'selections', 'optional'] }], rowGroups: {},
  });
  const path = `forms/${sha256}.pdf`;
  const portable = {
    kind: 'dondocs-draft', version: 3, documentKind: 'configured-form',
    documentMode: 'compliant', documentCategory: 'forms', docType: 'naval_letter',
    formType: definition.formId, formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [],
    genericForm: { definition, answers: { name: 'SOURCE PERSON', selections: ['alpha', 'beta', 'gamma'], optional: ['source'] }, rows: {}, answerRevision: 0 },
    portableFormTemplates: [{ kind: 'dondocs-form-templates', version: 1,
      definitionSha256: createHash('sha256').update(JSON.stringify(definition)).digest('hex'), pages: { 'page1.pdf': path } }],
    portableResources: { kind: 'dondocs-resources', version: 1, entries: [{ path, name: 'page1.pdf', mediaType: 'application/pdf', size: bytes.byteLength, sha256, data: bytes.toString('base64') }] },
  };
  await page.addInitScript(value => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'focused' } }));
  }, theme);
  await page.goto('/');
  await page.getByLabel('Import draft file', { exact: true }).setInputFiles({ name: 'multiple-form.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(portable)) });
  await page.getByRole('dialog', { name: 'Review draft', exact: true }).getByRole('button', { name: 'Open as new document', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Fictional recipient', exact: true })).toHaveValue('SOURCE PERSON');
  await page.getByRole('button', { name: 'Batch', exact: true }).click();
  return { sha256, bytes };
}

async function receivePdf(page: Page, info: TestInfo, action: () => Promise<void>): Promise<Download> {
  const pending = info.project.name === 'mobile-chrome-ios' ? page.waitForEvent('popup') : page.waitForEvent('download');
  await action();
  const received = await pending;
  if ('suggestedFilename' in received) return received;
  await expect(received.locator('iframe')).toHaveAttribute('src', /^data:application\/pdf;base64,/);
  const saving = received.waitForEvent('download');
  await received.getByRole('link', { name: 'Download PDF', exact: true }).click();
  const download = await saving;
  await received.close();
  return download;
}

async function inspectPdf(bytes: Buffer) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  try {
    const content = await (await document.getPage(1)).getTextContent();
    const items = content.items.filter(item => 'str' in item);
    return { text: items.map(item => item.str).join(' '), checkedColumns: items.filter(item => item.str === 'X').map(item => Math.round((item.transform[4] - 40) / 40)).sort() };
  } finally { await document.destroy(); }
}

for (const theme of ['light', 'dark', 'classic']) {
  test(`multiple selections generate independent real PDFs after reload in ${theme}`, async ({ page }, info) => {
    test.setTimeout(120_000);
    const source = await openFixture(page, theme);
    const batch = page.getByRole('dialog', { name: /^Batch generation \(Forms\)/ });
    await expect(batch.getByRole('region', { name: 'Configured form roster fields' })).toContainText('JSON array');
    const { utils, write } = await import('xlsx');
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([
      ['name', 'selections', 'optional'], ['0000000123', '["alpha","BETA"]', ''], ['0000000456', '["gamma"]', '[]'],
    ]), 'Roster');
    await batch.getByLabel('Upload Excel roster (.xlsx)').setInputFiles({ name: 'multiple-roster.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: write(workbook, { type: 'buffer', bookType: 'xlsx' }) });
    await batch.getByRole('button', { name: 'Map 2 roster rows', exact: true }).click();
    await batch.getByRole('button', { name: 'Apply Mapping', exact: true }).click();
    await expect(batch.getByLabel('Row 1: selections selected options', { exact: true })).toContainText('Alpha (alpha); Beta (beta)');
    await expect(batch.getByLabel('Row 2: optional selected options', { exact: true })).toContainText('Selected: None');
    const input = batch.getByRole('textbox', { name: 'Row 1: selections', exact: true });
    for (const invalid of ['["alpha","Alpha"]', '["missing"]', 'alpha,beta']) {
      await input.fill(invalid);
      await expect(batch.getByRole('status', { name: 'Form row checks' })).toBeVisible();
      await expect(batch.getByRole('button', { name: 'Generate 2 PDFs', exact: true })).toBeDisabled();
    }
    await input.fill('["alpha","BETA"]');
    await expect(batch.getByRole('status', { name: 'Form row checks' })).toHaveCount(0);
    await batch.getByRole('button', { name: 'Generate 2 PDFs', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Review batch row', exact: true });
    await expect(review).toBeVisible();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Fictional recipient', exact: true })).toHaveValue('SOURCE PERSON');
    await page.getByRole('button', { name: 'Batch', exact: true }).click();
    await expect(batch).toContainText('Interrupted batch');
    await expect(batch.getByRole('textbox', { name: 'Row 1: selections', exact: true })).toHaveValue('["alpha","BETA"]');
    const pdfs = new Map<string, Buffer>();
    for (let row = 0; row < 2; row++) {
      const download = await receivePdf(page, info, async () => {
        await batch.getByRole('button', { name: row === 0 ? 'Resume remaining' : 'Retry failed rows', exact: true }).click();
        await review.getByRole('button', { name: 'Continue with this row', exact: true }).click();
      });
      expect(await download.failure()).toBeNull();
      const bytes = await readFile((await download.path())!);
      pdfs.set(download.suggestedFilename(), bytes);
      await writeFile(info.outputPath(download.suggestedFilename()), bytes);
    }
    await expect(batch).toContainText('Batch complete · 2/2 generated');
    const first = await inspectPdf(pdfs.get('0000000123.pdf')!);
    const second = await inspectPdf(pdfs.get('0000000456.pdf')!);
    expect(first.text).toContain('MULTIPLE SELECTION TEMPLATE');
    expect(first.text).toContain('Alpha, Beta');expect(first.text).not.toContain('Gamma');
    expect(first.checkedColumns).toEqual([0, 1]);
    expect(second.text).toContain('Gamma');expect(second.text).not.toContain('Alpha');expect(second.text).not.toContain('Beta');
    expect(second.checkedColumns).toEqual([2]);
    expect(first.text).not.toContain('SOURCE PERSON');expect(second.text).not.toContain('0000000123');
    expect(first.text).not.toContain('Source-only');expect(second.text).not.toContain('Source-only');
    const pendingZip = page.waitForEvent('download');
    await batch.getByRole('button', { name: 'Download ZIP', exact: true }).click();
    await page.getByRole('dialog', { name: 'Review ZIP download', exact: true }).getByRole('button', { name: 'Download reviewed ZIP', exact: true }).click();
    const { default: JSZip } = await import('jszip');
    const archive = await JSZip.loadAsync(await readFile((await (await pendingZip).path())!));
    for (const [filename, bytes] of pdfs) expect(await archive.file(filename)!.async('nodebuffer')).toEqual(bytes);
    const retained = await page.evaluate(async hash => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs');request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error); });
      try {
        return await new Promise<number[]>((resolve, reject) => { const request = db.transaction('attachments').objectStore('attachments').get(`form-template-${hash}`);request.onsuccess = () => resolve(Array.from(new Uint8Array(request.result.data)));request.onerror = () => reject(request.error); });
      } finally { db.close(); }
    }, source.sha256);
    expect(createHash('sha256').update(Buffer.from(retained)).digest('hex')).toBe(source.sha256);
    await writeFile(info.outputPath('multiple-selection-receipt.json'), JSON.stringify({ theme, sourceTemplateSha256: source.sha256, first, second, pdfs: [...pdfs].map(([name, bytes]) => ({ name, sha256: createHash('sha256').update(bytes).digest('hex') })) }, null, 2));
    await page.screenshot({ path: info.outputPath('multiple-selection-complete.png'), fullPage: true });
  });
}
