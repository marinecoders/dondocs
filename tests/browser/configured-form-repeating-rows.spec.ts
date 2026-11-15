import { test, expect, type Download, type Page, type TestInfo } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { compileFormDefinition } from '../../src/services/forms/model';

async function openFixture(page: Page, theme: string) {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]).drawText('REPEATING ROW TEMPLATE', { x: 40, y: 760, font: await pdf.embedFont(StandardFonts.Helvetica) });
  const bytes = Buffer.from(await pdf.save());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const definition = compileFormDefinition({
    schemaVersion: 2, formId: 'repeating_batch_fixture', label: 'Repeating rows fixture',
    definitionRevision: 'v1', templateRevision: sha256, directory: 'repeating-batch-fixture',
    pages: [{ file: 'page1.pdf', width: 612, height: 792, sha256 }],
    fields: { name: { kind: 'identifier', label: 'Fictional recipient', requiredAt: 'export' } },
    placements: [{ fieldId: 'name', page: 1, appearance: 'text', overflow: 'error', box: { left: 40, top: 710, width: 400, height: 24 } }],
    sections: [{ id: 'answers', title: 'Answers', fields: ['name'] }],
    rowGroups: { entries: { title: 'Repeated entries', columns: {
      child: { kind: 'text', label: 'Child', requiredAt: 'export' },
      grade: { kind: 'singleChoice', label: 'Grade', options: [{ id: 'e1', label: 'E-1' }, { id: 'e2', label: 'E-2' }] },
      tags: { kind: 'multipleChoice', label: 'Tags', options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }] },
      verified: { kind: 'boolean', label: 'Verified' },
      signature: { kind: 'signature', label: 'Signature', requiredAt: 'sign' },
    }, rows: [630, 570, 510].map(top => [
      { fieldId: 'child', page: 1, appearance: 'text', overflow: 'error', box: { left: 40, top, width: 170, height: 24 } },
      { fieldId: 'grade', page: 1, appearance: 'text', overflow: 'error', box: { left: 220, top, width: 60, height: 24 } },
      { fieldId: 'tags', page: 1, appearance: 'text', overflow: 'error', box: { left: 290, top, width: 140, height: 24 } },
      { fieldId: 'verified', page: 1, appearance: 'mark', overflow: 'error', box: { left: 480, top, width: 12, height: 12 } },
    ]) } },
  });
  const path = `forms/${sha256}.pdf`;
  const portable = {
    kind: 'dondocs-draft', version: 3, documentKind: 'configured-form',
    documentMode: 'compliant', documentCategory: 'forms', docType: 'naval_letter',
    formType: definition.formId, formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [],
    genericForm: { definition, answers: { name: 'SOURCE PERSON' }, rows: { entries: [{ id: 'source-child', answers: { child: 'SOURCE CHILD', grade: 'e1', tags: ['a'], verified: true } }] }, answerRevision: 0 },
    portableFormTemplates: [{ kind: 'dondocs-form-templates', version: 1,
      definitionSha256: createHash('sha256').update(JSON.stringify(definition)).digest('hex'), pages: { 'page1.pdf': path } }],
    portableResources: { kind: 'dondocs-resources', version: 1, entries: [{ path, name: 'page1.pdf', mediaType: 'application/pdf', size: bytes.byteLength, sha256, data: bytes.toString('base64') }] },
  };
  await page.addInitScript(value => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'focused' } }));
  }, theme);
  await page.goto('/');
  await page.getByLabel('Import draft file', { exact: true }).setInputFiles({ name: 'repeating-form.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(portable)) });
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
    return { text: items.map(item => item.str).join(' '), marks: items.filter(item => item.str === 'X').map(item => ({ x: Math.round(item.transform[4]), y: Math.round(item.transform[5]) })) };
  } finally { await document.destroy(); }
}

for (const theme of ['light', 'dark', 'classic']) {
  test(`repeating rows generate independent real PDFs after reload in ${theme}`, async ({ page }, info) => {
    test.setTimeout(120_000);
    const source = await openFixture(page, theme);
    const batch = page.getByRole('dialog', { name: /^Batch generation \(Forms\)/ });
    await expect(batch.getByRole('region', { name: 'Configured form roster fields' })).toContainText('JSON array');
    const { utils, write } = await import('xlsx');
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([
      ['name', 'entries'],
      ['0000000123', JSON.stringify([{ child: 'Child Birch', grade: 'E-2', tags: ['Alpha', 'b'], verified: true }, { child: 'Child Cedar', grade: 'e1', verified: false }])],
      ['0000000456', JSON.stringify([{ child: 'Child Maple', grade: 'e1', tags: ['b'], verified: false }])],
    ]), 'Roster');
    await batch.getByLabel('Upload Excel roster (.xlsx)').setInputFiles({ name: 'multiple-roster.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: write(workbook, { type: 'buffer', bookType: 'xlsx' }) });
    await batch.getByRole('button', { name: 'Map 2 roster rows', exact: true }).click();
    await batch.getByRole('button', { name: 'Apply Mapping', exact: true }).click();
    await expect(batch.getByLabel('Row 1: entries reviewed rows', { exact: true })).toContainText('Grade: E-2 (e2)');
    await expect(batch.getByLabel('Row 1: entries reviewed rows', { exact: true })).toContainText('Tags: Alpha (a); Beta (b)');
    const input = batch.getByRole('textbox', { name: 'Row 1: entries', exact: true });
    const correct = await input.inputValue();
    for (const invalid of [JSON.stringify(Array(4).fill({ child: 'Overflow' })), '[{"child":"A","other":"unknown"}]', '[{"child":"A","signature":"Someone"}]']) {
      await input.fill(invalid);
      await expect(batch.getByRole('status', { name: 'Form row checks' })).toBeVisible();
      await expect(batch.getByRole('button', { name: 'Generate 2 PDFs', exact: true })).toBeDisabled();
    }
    await input.fill(correct);
    await expect(batch.getByRole('status', { name: 'Form row checks' })).toHaveCount(0);
    await batch.getByRole('button', { name: 'Generate 2 PDFs', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Review batch row', exact: true });
    await expect(review).toBeVisible();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Fictional recipient', exact: true })).toHaveValue('SOURCE PERSON');
    await page.getByRole('button', { name: 'Batch', exact: true }).click();
    await expect(batch).toContainText('Interrupted batch');
    await expect(batch.getByRole('textbox', { name: 'Row 1: entries', exact: true })).toHaveValue(correct);
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
    expect(first.text).toContain('REPEATING ROW TEMPLATE');
    expect(first.text).toContain('Child Birch');expect(first.text).toContain('Child Cedar');
    expect(first.text).toContain('Alpha, Beta');expect(first.text).toContain('E-2');
    expect(first.marks).toHaveLength(1);expect(first.marks[0].x).toBeGreaterThan(475);
    expect(second.text).toContain('Child Maple');expect(second.text).toContain('Beta');
    expect(second.text).not.toContain('Child Birch');expect(second.text).not.toContain('Child Cedar');
    expect(second.marks).toEqual([]);
    for (const inspected of [first, second]) { expect(inspected.text).not.toContain('SOURCE PERSON');expect(inspected.text).not.toContain('SOURCE CHILD');expect(inspected.text).not.toContain('Someone'); }
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
    await writeFile(info.outputPath('repeating-row-receipt.json'), JSON.stringify({ theme, sourceTemplateSha256: source.sha256, first, second, pdfs: [...pdfs].map(([name, bytes]) => ({ name, sha256: createHash('sha256').update(bytes).digest('hex') })) }, null, 2));
    await page.screenshot({ path: info.outputPath('repeating-row-complete.png'), fullPage: true });
  });
}
