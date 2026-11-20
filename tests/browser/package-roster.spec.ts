import { openPackageWorkspace, showPackageLibrary, importPackage, packageSection, expandPackageTools, preparePackageExport, packageTool, downloadPackageExport } from './_helpers/packageWorkspace';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { projectBrowserContextOptions } from '../_helpers/projectBrowserContext';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { utils, write } from 'xlsx';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { compileFormDefinition } from '../../src/services/forms/model';
import type { ActionPackage } from '../../src/lib/actionPackages';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(180_000);
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function pdf(text: string) { const document = await PDFDocument.create(), font = await document.embedFont(StandardFonts.Helvetica); document.addPage([612, 792]).drawText(text, { x: 54, y: 700, size: 12, font }); return Buffer.from(await document.save()); }
async function inputTemplate() {
  const bytes = await pdf('COMMON PUBLIC FORM BACKGROUND'), hash = sha(bytes);
  const definition = compileFormDefinition({ schemaVersion: 2, formId: 'roster_ui_fixture', label: 'Roster form', definitionRevision: 'v1', templateRevision: hash, directory: 'roster-ui-fixture',
    pages: [{ file: 'page1.pdf', width: 612, height: 792, sha256: hash }], fields: { name: { kind: 'text', label: 'Recipient', requiredAt: 'export' } },
    placements: [{ fieldId: 'name', page: 1, appearance: 'text', box: { left: 40, top: 630, width: 400, height: 24 } }], sections: [{ id: 'identity', title: 'Identity', fields: ['name'] }], rowGroups: {} });
  return { kind: 'dondocs-package-template', version: 2, id: 'roster_browser_template', name: 'Roster qualification template', createdAt: 0,
    program: { revision: '1', questions: [{ id: 'recipient', label: 'Fictional recipient', kind: 'text', required: true }], participantGroups: [], requirements: [] },
    members: [{ key: 'main', label: 'Independent recipient form', kind: 'native', role: 'basic-letter', required: true,
      draft: { kind: 'dondocs-draft', version: 2, documentKind: 'configured-form', documentMode: 'compliant', documentCategory: 'forms', docType: 'naval_letter', formType: definition.formId,
        genericForm: { definition, answers: {}, rows: {}, answerRevision: 0 }, formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], endItems: [], publicationTables: {}, distributions: [], timestamp: 0 },
      pages: { 'page1.pdf': { name: 'page1.pdf', type: 'application/pdf', data: bytes.toString('base64') } },
      links: [{ questionId: 'recipient', target: { kind: 'configured-form', formId: definition.formId, definitionRevision: definition.definitionRevision, templateRevision: definition.templateRevision, definitionSha256: sha(Buffer.from(JSON.stringify(definition))), fieldId: 'name' }, format: 'field' }] },
    { kind: 'attachment', key: 'support', label: 'Fresh evidence', role: 'supporting-document', required: true }] };
}
async function packages(page: Page) {
  const dialog = await openPackageWorkspace(page);
  await showPackageLibrary(dialog);
  await expandPackageTools(dialog);
  return dialog;
}
async function panel(dialog: Locator, name: string) {
  const region = await packageTool(dialog, name);
  if (!await region.isVisible()) await expandPackageTools(dialog);
  await expect(region).toBeVisible(); return region;
}
async function records(page: Page): Promise<ActionPackage[]> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { return await new Promise<ActionPackage[]>((resolve, reject) => { const transaction = database.transaction('app', 'readonly'), request = transaction.objectStore('app').getAll(IDBKeyRange.bound('action-package:', 'action-package:\uffff')); transaction.oncomplete = () => resolve(request.result.map(entry => entry.value)); transaction.onerror = () => reject(transaction.error); }); }
    finally { database.close(); }
  });
}
async function journalRows(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); });
    try { return await new Promise<Array<{ id: string; name: string; status: string; packageId: string }>>(resolve => { const transaction = database.transaction('app', 'readonly'), request = transaction.objectStore('app').getAll(IDBKeyRange.bound('package-roster:', 'package-roster:\uffff')); transaction.oncomplete = () => resolve(request.result[0]?.value.rows ?? []); }); }
    finally { database.close(); }
  });
}
async function downloaded(page: Page, click: () => Promise<void>) { const pending = page.waitForEvent('download', { timeout: 90_000 }); await click(); const file = await pending; expect(await file.failure()).toBeNull(); return readFile((await file.path())!); }
async function readText(bytes: Uint8Array) { const document = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise; try { const pages: string[] = []; for (let number = 1; number <= document.numPages; number++) pages.push((await (await document.getPage(number)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ')); return pages.join('\n'); } finally { await document.destroy(); } }

for (const width of [1440, 320]) test(`independent roster actions keep reviewed per-person files through reload and portable transfer at ${width}px`, async ({ page, context, browser, baseURL }, info) => {
  await page.setViewportSize({ width, height: 950 }); await context.addInitScript(value => { localStorage.setItem('browser-test-visitor', 'returning'); localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'focused' } })); }, width === 320 ? 'dark' : 'light');
  await page.goto('/'); let dialog = await packages(page);
  const templates = await panel(dialog, 'Reusable package templates');
  await templates.getByLabel('Import package template', { exact: true }).setInputFiles({ name: 'roster-template.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(await inputTemplate())) });
  await templates.getByRole('checkbox', { name: /^I reviewed this template's retained text/ }).check(); await templates.getByRole('button', { name: 'Import reviewed package template', exact: true }).click();
  await expect(templates.getByText('Package template imported.', { exact: true })).toBeVisible();
  let roster = await panel(dialog, 'Packages from a roster');
  await roster.getByRole('button', { name: 'Refresh roster templates', exact: true }).click(); const importedTemplateId = await roster.getByLabel('Roster template', { exact: true }).locator('option').filter({ hasText: 'Roster qualification template' }).getAttribute('value'); await roster.getByLabel('Roster template', { exact: true }).selectOption(importedTemplateId!); await roster.getByRole('button', { name: 'Load roster template', exact: true }).click();
  await roster.getByRole('button', { name: 'Add fresh action row', exact: true }).click(); await roster.getByRole('button', { name: 'Add fresh action row', exact: true }).click();
  const alphaFile = await pdf('ALPHA ONLY SUPPORTING EVIDENCE'), bravoFile = await pdf('BRAVO ONLY SUPPORTING EVIDENCE');
  const alpha = roster.getByRole('region', { name: 'Action row 1', exact: true }), bravo = roster.getByRole('region', { name: 'Action row 2', exact: true });
  await alpha.getByLabel('Action name for row 1', { exact: true }).fill('Fictional Alpha action'); await alpha.getByLabel('Fictional recipient', { exact: true }).fill('ALPHA ONLY PERSON'); await alpha.getByLabel('PDF for row 1: Fresh evidence', { exact: true }).setInputFiles({ name: 'Alpha evidence.pdf', mimeType: 'application/pdf', buffer: alphaFile });
  await bravo.getByLabel('Action name for row 2', { exact: true }).fill('Fictional Bravo action'); await bravo.getByLabel('PDF for row 2: Fresh evidence', { exact: true }).setInputFiles({ name: 'Bravo evidence.pdf', mimeType: 'application/pdf', buffer: bravoFile });
  await roster.getByRole('button', { name: 'Preview roster actions', exact: true }).click(); await expect(roster.getByRole('button', { name: 'Save reviewed roster inputs', exact: true })).toBeDisabled(); expect(await records(page)).toEqual([]);
  await bravo.getByLabel('Fictional recipient', { exact: true }).fill('BRAVO ONLY PERSON'); await bravo.getByLabel('PDF for row 2: Fresh evidence', { exact: true }).setInputFiles({ name: 'Bravo evidence.pdf', mimeType: 'application/pdf', buffer: bravoFile }); await roster.getByRole('button', { name: 'Preview roster actions', exact: true }).click();
  await roster.getByRole('checkbox', { name: /^I reviewed the template, all roster rows/ }).check(); await roster.getByRole('button', { name: 'Save reviewed roster inputs', exact: true }).click();
  await expect.poll(async () => (await journalRows(page)).map(row => row.status)).toEqual(['pending', 'pending']);
  const first = roster.getByRole('button', { name: 'Create independent package', exact: true }); await expect(first).toBeDisabled();
  await roster.getByRole('button', { name: 'Inspect row 1: Alpha evidence.pdf', exact: true }).click();
  await expect(roster.getByLabel('Exact row 1 supporting PDF', { exact: true }).locator('canvas').first()).toBeVisible();
  await roster.getByRole('checkbox', { name: /^I reviewed the intake, document changes/ }).check(); await first.click();
  await expect.poll(async () => (await journalRows(page)).map(row => row.status)).toEqual(['created', 'pending']); expect(await records(page)).toHaveLength(1);
  await page.reload(); dialog = await packages(page); roster = await panel(dialog, 'Packages from a roster');
  await roster.getByRole('button', { name: 'Refresh saved rosters', exact: true }).click(); await roster.getByLabel('Saved package roster', { exact: true }).selectOption({ index: 1 }); await roster.getByRole('button', { name: 'Resume saved roster review', exact: true }).click();
  const selection = roster.getByLabel('Saved roster action', { exact: true }); const secondId = await selection.locator('option').filter({ hasText: 'Fictional Bravo action' }).getAttribute('value'); await selection.selectOption(secondId!);
  await expect(roster.getByRole('checkbox', { name: /^I reviewed the intake, document changes/ })).not.toBeChecked(); await expect(roster.getByRole('button', { name: 'Create independent package', exact: true })).toBeDisabled();
  const wholeReview = roster.getByRole('checkbox', { name: /^I reviewed the template, all roster rows/ }); if (await wholeReview.isVisible()) await wholeReview.check();
  await roster.getByRole('button', { name: 'Inspect row 2: Bravo evidence.pdf', exact: true }).click();
  await expect(roster.getByLabel('Exact row 2 supporting PDF', { exact: true }).locator('canvas').first()).toBeVisible(); await roster.getByRole('checkbox', { name: /^I reviewed the intake, document changes/ }).check(); await roster.getByRole('button', { name: 'Create independent package', exact: true }).click();
  await expect.poll(async () => (await journalRows(page)).map(row => row.status)).toEqual(['created', 'created']);
  const saved = await records(page); expect(saved).toHaveLength(2); const alphaRecord = saved.find(record => record.name === 'Fictional Alpha action')!, bravoRecord = saved.find(record => record.name === 'Fictional Bravo action')!;
  expect(alphaRecord.id).not.toBe(bravoRecord.id); expect(JSON.stringify(alphaRecord)).not.toContain('BRAVO'); expect(JSON.stringify(bravoRecord)).not.toContain('ALPHA');
  const alphaRevision = alphaRecord.revisions.find(revision => revision.id === alphaRecord.currentRevisionId)!, bravoRevision = bravoRecord.revisions.find(revision => revision.id === bravoRecord.currentRevisionId)!;
  expect(alphaRevision.members[0].id).not.toBe(bravoRevision.members[0].id); expect(alphaRevision.information!.facts[0].id).not.toBe(bravoRevision.information!.facts[0].id); expect(alphaRecord.reviewRounds).toBeUndefined(); expect(alphaRecord.workingCopies).toBeUndefined(); expect(alphaRevision.signing).toBeUndefined();
  const firstId = await roster.getByLabel('Saved roster action', { exact: true }).locator('option').filter({ hasText: 'Fictional Alpha action' }).getAttribute('value'); await roster.getByLabel('Saved roster action', { exact: true }).selectOption(firstId!);
  await roster.getByRole('button', { name: 'Open created action row 1', exact: true }).click(); await expect(dialog.getByRole('heading', { name: 'Fictional Alpha action', exact: true, level: 1 })).toBeVisible();
  await downloadPackageExport(page, dialog, 'Check readiness and assemble', 'Download PDF');
  await preparePackageExport(dialog, 'editable');
  if (await dialog.getByRole('checkbox', { name: /^I reviewed every included member/ }).isVisible()) await dialog.getByRole('checkbox', { name: /^I reviewed every included member/ }).check(); const portableBytes = await downloaded(page, () => dialog.getByRole('button', { name: 'Download editable package', exact: true }).click()), portable = JSON.parse(portableBytes.toString()), revision = portable.package.revisions[0];
  expect(portable.package.id).toBe(alphaRecord.id); expect(JSON.stringify(portable.package)).not.toContain('BRAVO');
  const original = revision.members.find((member: { kind: string }) => member.kind === 'original'), originalEntry = portable.portableResources.entries.find((entry: { path: string }) => entry.path === `assets/${original.original.id}`);
  expect(Buffer.from(originalEntry.data, 'base64')).toEqual(alphaFile);
  const output = revision.outputs[0], outputEntry = portable.portableResources.entries.find((entry: { path: string }) => entry.path === `assets/${output.asset.id}`), outputBytes = Buffer.from(outputEntry.data, 'base64');
  expect(sha(outputBytes)).toBe(output.asset.sha256); expect((await PDFDocument.load(outputBytes)).getPageCount()).toBe(2); const outputText = await readText(outputBytes); expect(outputText).toContain('ALPHA ONLY PERSON'); expect(outputText).toContain('ALPHA ONLY SUPPORTING EVIDENCE'); expect(outputText).not.toContain('BRAVO');
  await info.attach('independent-alpha-package.pdf', { body: outputBytes, contentType: 'application/pdf' });
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true); await page.screenshot({ path: info.outputPath(`roster-${width}px.png`) });
  const fresh = await browser.newContext({ ...projectBrowserContextOptions(info), baseURL, serviceWorkers: 'block', viewport: { width, height: 950 } });
  try { await fresh.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning')); const recipient = await fresh.newPage(); await recipient.goto('/'); expect(await recipient.evaluate(() => navigator.userAgent)).toBe(await page.evaluate(() => navigator.userAgent)); expect(await recipient.evaluate(() => navigator.maxTouchPoints)).toBe(await page.evaluate(() => navigator.maxTouchPoints)); const imported = await packages(recipient); await importPackage(imported, { name: 'alpha-portable.json', mimeType: 'application/json', buffer: portableBytes });
  await packageSection(imported, 'Overview', true); await expect(imported.getByRole('heading', { name: 'Fictional Alpha action', exact: true, level: 1 })).toBeVisible(); const recovered = await records(recipient); expect(recovered).toHaveLength(1); expect(recovered[0].id).toBe(alphaRecord.id); expect(JSON.stringify(recovered)).not.toContain('BRAVO'); } finally { await fresh.close(); }
});


test('maps an actual Excel worksheet, corrects a numeric identifier and creates only the reviewed action', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    // Valid metadata identities can contain an unselected row's numeric answer.
    const randomUUID = crypto.randomUUID.bind(crypto);
    Object.defineProperty(crypto, 'randomUUID', { value: () => `0013${randomUUID().slice(4)}` });
  });
  await page.goto('/'); const dialog = await packages(page), templates = await panel(dialog, 'Reusable package templates');
  const source = await inputTemplate(); source.members = source.members.filter(member => member.kind === 'native'); source.program.questions[0].kind = 'identifier';
  await templates.getByLabel('Import package template', { exact: true }).setInputFiles({ name: 'excel-roster-template.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await templates.getByRole('checkbox', { name: /^I reviewed this template's retained text/ }).check(); await templates.getByRole('button', { name: 'Import reviewed package template', exact: true }).click();
  await expect(templates.getByText('Package template imported.', { exact: true })).toBeVisible();
  const roster = await panel(dialog, 'Packages from a roster'); await roster.getByRole('button', { name: 'Refresh roster templates', exact: true }).click();
  const importedTemplateId = await roster.getByLabel('Roster template', { exact: true }).locator('option').filter({ hasText: 'Roster qualification template' }).getAttribute('value'); await roster.getByLabel('Roster template', { exact: true }).selectOption(importedTemplateId!); await roster.getByRole('button', { name: 'Load roster template', exact: true }).click();
  const workbook = utils.book_new(); utils.book_append_sheet(workbook, utils.aoa_to_sheet([
    ['Synthetic roster qualification'], [], ['Action', 'Recipient'], ['Worksheet Alpha', 12], ['Worksheet Bravo', '0013'],
  ]), 'Actions'); utils.book_append_sheet(workbook, utils.aoa_to_sheet([['Ignored worksheet person']]), 'Ignored');
  await roster.getByLabel('Excel roster for packages', { exact: true }).setInputFiles({ name: 'actions.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: write(workbook, { type: 'buffer', bookType: 'xlsx' }) });
  await roster.getByLabel('Package roster header row', { exact: true }).selectOption('3');
  await roster.getByLabel('Roster column for name', { exact: true }).selectOption('0'); await roster.getByLabel('Roster column for question:recipient', { exact: true }).selectOption('1');
  await roster.getByRole('button', { name: 'Map worksheet to separate actions', exact: true }).click();
  await roster.getByRole('region', { name: 'Action row 4', exact: true }).getByRole('button', { name: 'Show answered questions', exact: true }).click();
  await expect(roster.getByRole('region', { name: 'Action row 4', exact: true }).getByLabel('Fictional recipient', { exact: true })).toHaveValue('12');
  await expect(roster.getByText(/leading zeros may already be missing/)).toBeVisible(); await expect(roster).not.toContainText('Ignored worksheet person');
  await expandPackageTools(roster);
  await roster.getByLabel('Worksheet row 4 column 2', { exact: true }).fill('0012'); await expect(roster.getByRole('region', { name: 'Action row 4', exact: true })).toBeHidden();
  await roster.getByRole('button', { name: 'Map worksheet to separate actions', exact: true }).click();
  await roster.getByRole('region', { name: 'Action row 4', exact: true }).getByRole('button', { name: 'Show answered questions', exact: true }).click();
  await expect(roster.getByRole('region', { name: 'Action row 4', exact: true }).getByLabel('Fictional recipient', { exact: true })).toHaveValue('0012');
  await expect(roster.getByText(/leading zeros may already be missing/)).toBeHidden();
  await roster.getByRole('button', { name: 'Preview roster actions', exact: true }).click(); await roster.getByRole('checkbox', { name: /^I reviewed the template, all roster rows/ }).check();
  await roster.getByRole('button', { name: 'Save reviewed roster inputs', exact: true }).click(); await expect.poll(async () => (await journalRows(page)).map(row => row.status)).toEqual(['pending', 'pending']);
  await roster.getByRole('checkbox', { name: /^I reviewed the intake, document changes/ }).check(); await roster.getByRole('button', { name: 'Create independent package', exact: true }).click();
  await expect.poll(async () => (await journalRows(page)).map(row => row.status)).toEqual(['created', 'pending']);
  const saved = await records(page); expect(saved).toHaveLength(1); const revision = saved[0].revisions[0], main = revision.members[0];
  expect(main.kind).toBe('native'); if (main.kind !== 'native') throw new Error('Expected native form');
  expect(saved.map(record => record.name)).toEqual(['Worksheet Alpha']);
  expect(revision.members).toHaveLength(1);
  expect(main.session.genericForm!.answers).toEqual({ name: '0012' });
  expect(revision.information!.facts.map(fact => fact.value)).toEqual(['0012']);
  expect(revision.bindings!.items.map(binding => binding.expectedValue)).toEqual(['0012']);
  const answers = { version: 1, values: { recipient: '0012' }, groups: {} };
  expect(revision.templateState!.answers).toEqual(answers);
  expect(revision.templateState!.appliedAnswers).toEqual(answers);
  expect(JSON.stringify(saved)).not.toContain('Worksheet Bravo');
  expect(JSON.stringify(saved)).not.toContain('Ignored worksheet person');
});
