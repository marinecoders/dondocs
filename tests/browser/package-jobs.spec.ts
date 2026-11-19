import { openPackagePreparation, importPackage, packageSection, expandPackageTools, packageTool } from './_helpers/packageWorkspace';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { compileFormDefinition } from '../../src/services/forms/model';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(180_000);
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const packageId = 'package_jobs_browser', revisionId = 'revision_jobs_source', count = 40;
async function fixture() {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText('EXACT RETAINED JOB TEMPLATE', { x: 40, y: 750, font, size: 12 });
  const templateBytes = Buffer.from(await pdf.save()), template = { id: 'asset_jobs_template', name: 'page1.pdf', type: 'application/pdf', size: templateBytes.length, sha256: sha(templateBytes) };
  const definition = compileFormDefinition({ schemaVersion: 2, formId: 'job_fixture', label: 'Job qualification form', definitionRevision: 'v1', templateRevision: template.sha256, directory: 'job-fixture',
    pages: [{ file: 'page1.pdf', width: 612, height: 792, sha256: template.sha256 }], fields: { name: { kind: 'text', label: 'Fictional name', requiredAt: 'export' } },
    placements: [{ fieldId: 'name', page: 1, appearance: 'text', box: { left: 40, top: 710, width: 400, height: 24 } }], sections: [{ id: 'identity', title: 'Identity', fields: ['name'] }], rowGroups: {} });
  const resources = [{ path: `assets/${template.id}`, name: template.name, mediaType: template.type, size: template.size, sha256: template.sha256, data: templateBytes.toString('base64') }];
  const members = Array.from({ length: count }, (_, index) => {
    // Match the canonical complete draft/session projection, including default arrays.
    const session = { documentMode: 'compliant', documentCategory: 'forms', docType: 'naval_letter', formType: definition.formId,
      genericForm: { definition, answers: { name: `FICTIONAL MEMBER ${String(index + 1).padStart(2, '0')}` }, rows: {}, answerRevision: 0 },
      formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], endItems: [], publicationTables: {}, distributions: [], timestamp: 0 };
    const bytes = Buffer.from(JSON.stringify({ kind: 'dondocs-draft', version: 2, documentKind: 'configured-form', ...session }));
    const draft = { id: `asset_jobs_draft_${index}`, name: `Member ${index + 1}.json`, type: 'application/json', size: bytes.length, sha256: sha(bytes) };
    resources.push({ path: `assets/${draft.id}`, name: draft.name, mediaType: draft.type, size: draft.size, sha256: draft.sha256, data: bytes.toString('base64') });
    return { kind: 'native', id: `member_jobs_${index}`, revisionId: `member_jobs_revision_${index}`, label: `Fictional form ${index + 1}`, role: index ? 'supporting-document' : 'basic-letter', required: true,
      session, draft, templates: { 'page1.pdf': template } };
  });
  return Buffer.from(JSON.stringify({ kind: 'dondocs-action-package', version: 1, package: { kind: 'dondocs-action-package-record', version: 1, id: packageId, historyScope: 'selected-revision', name: 'Resumable training package',
    archived: false, sequence: 0, currentRevisionId: revisionId, revisions: [{ id: revisionId, createdAt: 100, members, outputs: [] }] }, portableResources: { kind: 'dondocs-resources', version: 1, entries: resources } }));
}
async function packages(page: Page) {
  return openPackagePreparation(page);
}
async function jobsPanel(dialog: Locator) {
  const panel = await packageTool(dialog, 'Resumable PDF assembly');
  if (!await panel.isVisible()) await expandPackageTools(dialog);
  await expect(panel).toBeVisible(); return panel;
}
async function jobState(page: Page) {
  return page.evaluate(async id => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      return await new Promise<Array<{ id: string; status: string; completed: number; checkpoints: Array<{ outputId: string; size: number; sha256: string }> }>>((resolve, reject) => {
        const transaction = database.transaction('app', 'readonly'), request = transaction.objectStore('app').getAll(IDBKeyRange.bound('package-job:', 'package-job:\uffff'));
        transaction.oncomplete = () => resolve(request.result.map(entry => entry.value).filter(job => job.packageId === id)); transaction.onerror = () => reject(transaction.error);
      });
    } finally { database.close(); }
  }, packageId);
}

for (const theme of ['light', 'dark', 'classic']) for (const width of [1440, 320]) test(`real configured package assembly pauses, reloads and resumes after fresh review in ${theme} at ${width}px`, async ({ page, context }, info) => {
  await page.setViewportSize({ width, height: 950 });
  await context.addInitScript(value => { localStorage.setItem('browser-test-visitor', 'returning'); localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'focused' } })); }, theme);
  await page.goto('/'); let dialog = await packages(page);
  await importPackage(dialog, { name: 'resumable-training.json', mimeType: 'application/json', buffer: await fixture() });
  await packageSection(dialog, 'Delivery', true);
  await expect(dialog.getByRole('heading', { name: 'Resumable training package', exact: true, level: 1 })).toBeVisible({ timeout: 30_000 });
  let panel = await jobsPanel(dialog);
  await panel.getByRole('button', { name: 'Review resumable assembly', exact: true }).click();
  const start = panel.getByRole('button', { name: 'Start reviewed assembly', exact: true }); await expect(start).toBeDisabled();
  await panel.getByRole('checkbox', { name: /^I reviewed every captured document/ }).check();
  // React commits real progress only after a member is copied. Observe that UI
  // and press its Pause button immediately, avoiding a timing race between the
  // browser driver and a fast local renderer. No engine/storage/clock stubs.
  await panel.evaluate(element => {
    const observer = new MutationObserver(() => {
      const progress = element.querySelector('progress');
      const pause = [...element.querySelectorAll('button')].find(button => button.textContent === 'Pause assembly');
      if (progress && Number(progress.getAttribute('value')) > 0 && pause) {
        observer.disconnect();
        pause.click();
        element.setAttribute('data-test-pause-requested', 'true');
      }
    });
    observer.observe(element, { childList: true, subtree: true, attributes: true, characterData: true });
  });
  await start.click();
  // A newly created job is initially paused, before its running lease starts.
  // Observe the actual Pause click before accepting a paused storage record.
  await expect(panel).toHaveAttribute('data-test-pause-requested', 'true', { timeout: 30_000 });
  await expect.poll(async () => (await jobState(page))[0]?.status).toBe('paused');
  const [paused] = await jobState(page); expect(paused.checkpoints.length).toBeGreaterThan(0); expect(paused.completed).toBeGreaterThan(0); expect(paused.completed).toBeLessThanOrEqual(count);
  const retained = paused.checkpoints[0];
  const retainedBytes = await page.evaluate(async id => {
    const database = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); });
    try { return await new Promise<number[]>((resolve, reject) => { const transaction = database.transaction('app', 'readonly'), request = transaction.objectStore('app').get(`batch:${id}`); transaction.oncomplete = () => resolve(Array.from(request.result.value as Uint8Array)); transaction.onerror = () => reject(transaction.error); }); }
    finally { database.close(); }
  }, retained.outputId);
  const checkpoint = Buffer.from(retainedBytes); expect(checkpoint.length).toBe(retained.size); expect(sha(checkpoint)).toBe(retained.sha256); expect((await PDFDocument.load(checkpoint)).getPageCount()).toBe(1);
  await page.reload(); dialog = await packages(page); panel = await jobsPanel(dialog);
  await panel.getByRole('button', { name: 'Review saved job', exact: true }).click();
  const resume = panel.getByRole('button', { name: 'Resume reviewed assembly', exact: true }); await expect(resume).toBeDisabled();
  await expect(panel.getByRole('checkbox', { name: /^I reviewed every captured document/ })).not.toBeChecked();
  await panel.getByRole('checkbox', { name: /^I reviewed every captured document/ }).check(); await resume.click();
  await expect.poll(async () => (await jobState(page))[0]?.status, { timeout: 90_000 }).toBe('complete');
  const [completed] = await jobState(page); expect(completed.checkpoints).toHaveLength(count); expect(completed.checkpoints[0]).toEqual(retained);
  await expect(panel.getByText(`complete · ${count} of ${count} documents`, { exact: true })).toBeVisible();
  const result = await page.evaluate(async id => {
    const database = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); });
    try {
      const record = await new Promise<{ currentRevisionId: string; revisions: Array<{ id: string; outputs: Array<{ id: string; asset: { id: string; sha256: string } }> }> }>(resolve => { const transaction = database.transaction('app', 'readonly'), request = transaction.objectStore('app').get(`action-package:${id}`); transaction.oncomplete = () => resolve(request.result.value); });
      const outputs = record.revisions.find(revision => revision.id === record.currentRevisionId)!.outputs;
      const bytes = await new Promise<number[]>(resolve => { const transaction = database.transaction('attachments', 'readonly'), request = transaction.objectStore('attachments').get(outputs[0].asset.id); transaction.oncomplete = () => resolve(Array.from(new Uint8Array(request.result.data))); });
      return { revisionId: record.currentRevisionId, outputCount: outputs.length, sha256: outputs[0].asset.sha256, bytes };
    } finally { database.close(); }
  }, packageId);
  expect(result.revisionId).toBe(revisionId); expect(result.outputCount).toBe(1);
  const output = Buffer.from(result.bytes); expect(sha(output)).toBe(result.sha256); expect((await PDFDocument.load(output)).getPageCount()).toBe(count);
  await info.attach('resumed-package.pdf', { body: output, contentType: 'application/pdf' });
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await panel.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath(`resumable-package-${theme}-${width}px.png`) });
  await page.reload(); dialog = await packages(page); panel = await jobsPanel(dialog);
  await expect(panel.getByRole('button', { name: 'Review saved job', exact: true })).toHaveCount(0);
  await expect(panel.getByText(`complete · ${count} of ${count} documents`, { exact: true })).toBeVisible();
});
