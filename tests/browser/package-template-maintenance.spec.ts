import { expect, test, type Page, type Locator } from '@playwright/test';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { compileFormDefinition } from '../../src/services/forms/model';
test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(120_000);
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function template(revision = '1') {
  const pdf = await PDFDocument.create(); pdf.addPage([612, 792]).drawText(`EXACT TEMPLATE BACKGROUND ${revision}`, { x: 40, y: 740, size: 14 });
  const bytes = Buffer.from(await pdf.save()), digest = sha(bytes);
  const definition = compileFormDefinition({ schemaVersion: 2, formId: 'maintenance_browser', label: 'Synthetic maintained form', definitionRevision: revision, templateRevision: digest, directory: 'maintenance-browser',
    pages: [{ file: 'page1.pdf', width: 612, height: 792, sha256: digest }], fields: { name: { kind: 'text', label: 'Fictional name', requiredAt: 'export' } },
    placements: [{ fieldId: 'name', page: 1, appearance: 'text', box: { left: 40, top: 690, width: 450, height: 24 } }], sections: [{ id: 'identity', title: 'Identity', fields: ['name'] }], rowGroups: {} });
  const session = { documentMode: 'compliant', documentCategory: 'forms', docType: 'naval_letter', formType: definition.formId, genericForm: { definition, answers: {}, rows: {}, answerRevision: 0 },
    formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {}, timestamp: 0 };
  return { kind: 'dondocs-package-template', version: 2, id: `synthetic_maintenance_${revision}`, name: `Synthetic maintained form ${revision}`, createdAt: 0,
    program: { revision, questions: [{ id: 'name', label: 'Fictional person', kind: 'text', required: true }], participantGroups: [], requirements: [] },
    members: [{ key: 'main', kind: 'native', label: 'Synthetic person form', role: 'basic-letter', required: true, draft: { kind: 'dondocs-draft', version: 2, documentKind: 'configured-form', ...session },
      pages: { 'page1.pdf': { name: 'page1.pdf', type: 'application/pdf', data: bytes.toString('base64') } }, links: [{ questionId: 'name', target: { kind: 'configured-form', formId: definition.formId, definitionRevision: revision, templateRevision: digest, definitionSha256: sha(Buffer.from(JSON.stringify(definition))), fieldId: 'name' }, format: 'field' }] }] };
}
async function packages(page: Page) { const drawer = page.getByRole('dialog', { name: 'Documents', exact: true }); if (!await drawer.isVisible()) await page.getByRole('button', { name: 'Open workspace', exact: true }).or(page.getByRole('button', { name: /^Packages(?:\s|$)/ })).first().click(); if (await drawer.isVisible()) await drawer.getByRole('button', { name: /^Packages(?:\s|$)/ }).click(); return page.getByRole('dialog', { name: 'Action packages', exact: true }); }
async function expand(root: Locator, title: string) { const summary = root.locator('summary').filter({ hasText: new RegExp(`^${title}`) }).first(), parent = summary.locator('..'); if (await parent.getAttribute('open') === null) await summary.click(); return parent; }
async function importTemplate(dialog: Locator, value: Awaited<ReturnType<typeof template>>) {
  const library = await expand(dialog, 'Reusable package templates');
  await library.getByLabel('Import package template', { exact: true }).setInputFiles({ name: `template-${value.program.revision}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  await library.getByRole('checkbox', { name: /^I reviewed this template's retained text/ }).check(); await library.getByRole('button', { name: 'Import reviewed package template', exact: true }).click();
  const selected = library.getByLabel('Saved package templates', { exact: true }); await expect(selected.locator('option:checked')).toHaveText(value.name);
  const id = await selected.inputValue(); expect(id).toMatch(/^template_/); expect(id).not.toBe(value.id); return { ...value, id };
}
async function stored(page: Page, prefix: string) {
  return page.evaluate(async prefix => { const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); try { return await new Promise<Array<{ key: string; value: unknown }>>((resolve, reject) => { const tx = db.transaction('app', 'readonly'), request = tx.objectStore('app').getAll(IDBKeyRange.bound(prefix, `${prefix}\uffff`)); tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error); }); } finally { db.close(); } }, prefix);
}
for (const theme of ['light', 'dark', 'classic']) for (const width of [1440, 320]) {
  test(`template maintenance uses independent expectations and saves no sample person in ${theme} at ${width}px`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: 950 }); await context.addInitScript(theme => { localStorage.setItem('browser-test-visitor', 'returning'); localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme, editorLayout: 'focused' } })); }, theme);
    await page.goto('/'); const dialog = await packages(page), original = await importTemplate(dialog, await template());
    const editor = await expand(dialog, 'Maintain package templates'); await editor.getByRole('button', { name: 'Refresh maintained template sources', exact: true }).click(); await editor.getByLabel('Maintainer template source', { exact: true }).selectOption(original.id); await editor.getByRole('button', { name: 'Edit a separate template revision', exact: true }).click();
    await editor.getByLabel('Maintained template name', { exact: true }).fill('Separately maintained qualification'); await editor.getByLabel('Maintained template revision', { exact: true }).fill('3');
    const contents = await expand(editor, 'Inspect retained starter text and assets'); await contents.getByRole('button', { name: 'Inspect Synthetic person form background page1.pdf', exact: true }).click(); await expect(contents.locator('canvas').first()).toBeVisible(); await contents.getByRole('button', { name: 'Close template asset preview', exact: true }).click();
    const scenarios = await expand(editor, 'Validate intake scenarios'); await scenarios.getByLabel('Fictional person', { exact: true }).fill('TEST SCENARIO PERSON');
    await scenarios.getByRole('button', { name: 'Add this expected scenario', exact: true }).click(); await scenarios.getByRole('button', { name: 'Validate template scenarios', exact: true }).click(); await expect(editor.getByText('Template is not ready to save.', { exact: true })).toBeVisible();
    await scenarios.getByRole('button', { name: 'Remove scenario 1', exact: true }).click(); await scenarios.getByRole('checkbox', { name: 'Expected document: Synthetic person form', exact: true }).check(); await scenarios.getByRole('button', { name: 'Add this expected scenario', exact: true }).click(); await scenarios.getByRole('button', { name: 'Validate template scenarios', exact: true }).click();
    await expect(editor.getByText('Scenarios passed; template ready for review.', { exact: true })).toBeVisible(); const save = editor.getByRole('button', { name: 'Save reviewed template revision', exact: true }); await expect(save).toBeDisabled(); await editor.getByRole('checkbox', { name: /^I reviewed all declarations/ }).check(); await save.click(); await expect(editor.getByText('Separate maintained template saved. Existing actions are unchanged.', { exact: true })).toBeVisible();
    const saved = await stored(page, 'package-template:'); expect(saved).toHaveLength(2); expect(JSON.stringify(saved)).not.toContain('TEST SCENARIO PERSON'); expect(saved.map(row => (row.value as { id: string }).id)).toContain(original.id); expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true); await editor.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath(`template-maintenance-${theme}-${width}px.png`) });
  });
}
