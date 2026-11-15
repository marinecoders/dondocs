import { test, expect, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createHash } from 'node:crypto';

async function fixture() {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]).drawText('EXACT BATCH TEMPLATE', { x: 40, y: 760, font: await pdf.embedFont(StandardFonts.Helvetica) });
  const bytes = Buffer.from(await pdf.save());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const fields = {
    name: { kind: 'identifier', label: 'Fictional recipient', requiredAt: 'export' },
    eventDate: { kind: 'date', label: 'Event date', requiredAt: 'export' },
    amount: { kind: 'decimal', label: 'Amount' },
    decision: { kind: 'singleChoice', label: 'Decision', requiredAt: 'export', options: [{ id: 'approve', label: 'Approve' }, { id: 'return', label: 'Return' }] },
    signature: { kind: 'signature', label: 'Signature', requiredAt: 'sign' },
  };
  const definition = { schemaVersion: 2, formId: 'batch_fixture', label: 'Configured batch fixture', definitionRevision: 'original-v1', templateRevision: sha256, directory: 'batch-fixture',
    pages: [{ file: 'page1.pdf', width: 612, height: 792, sha256 }], fields,
    placements: ['name', 'eventDate', 'amount', 'decision'].map((fieldId, index) => ({ fieldId, page: 1, appearance: 'text', overflow: 'error', box: { left: 40, top: 710 - index * 40, width: 400, height: 24 } })),
    sections: [{ id: 'identity', title: 'Identity', fields: Object.keys(fields) }], rowGroups: {} };
  return { bytes, definition, legacy: { genericForm: { definition, answers: { name: 'SOURCE PERSON', eventDate: '2026-01-01', decision: 'approve' }, rows: {}, answerRevision: 0 } } };
}
async function setup(page: Page, theme: string) {
  const source = await fixture();
  await page.addInitScript(value => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'focused' } }));
  }, theme);
  await page.route('**/templates/**', route => route.request().url().endsWith('/batch-fixture/page1.pdf')
    ? route.fulfill({ status: 200, contentType: 'application/pdf', body: source.bytes })
    : route.fulfill({ status: 200, json: { templates: [] } }));
  await page.goto('/');
  await page.getByLabel('Import draft file', { exact: true }).setInputFiles({ name: 'batch-form.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source.legacy)) });
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
