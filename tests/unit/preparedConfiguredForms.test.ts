import { afterEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { fixtureInstance, fixturePage } from '../_helpers/formFixture';
import { captureDocumentRevision, copyCapturedDocument } from '@/lib/capturedDocument';
import { prepareExport, acknowledgePreparedExport, copyPreparedDocument, copyExportReview } from '@/lib/preparedExport';
import { captureExportFormTemplates } from '@/services/exports/formTemplates';
import { renderPreparedConfiguredForm } from '@/services/exports/configuredForms';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
function capture(instance = fixtureInstance()) {
  return captureDocumentRevision({ documentId: 'configured-a', epoch: 1, editSequence: 1, capturedAt: 1 }, {
    documentMode: 'compliant', documentCategory: 'forms', docType: 'standard_letter', formType: instance.definition.formId, genericForm: instance,
    formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {},
  });
}
afterEach(() => vi.unstubAllGlobals());
it('owns the selected definition, row answers and verified templates before privacy approval', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const instance = fixtureInstance();const page = await fixturePage();instance.definition.pages[0].sha256 = page.sha256;
  instance.answers.name = '{{IDENTIFIER}}';instance.answers.legacy = 'SSN 987-65-4321';
  instance.rows.roster = [{ id: 'row', answers: { grade: 'e2', date: '2026-01-02', legacy: 'SSN 987-65-4321' } }];
  const captured = capture(instance);
  const fetch = vi.fn(async () => new Response(new Uint8Array(page.bytes)));vi.stubGlobal('fetch', fetch);
  const formTemplates = await captureExportFormTemplates(captured);
  const result = prepareExport({ id: 'configured-a', captured, target: 'pdf', filename: 'original-form.pdf', policy, formTemplates, placeholders: { IDENTIFIER: '123-45-6789' } });
  if (result.status !== 'needs-review') throw new Error(JSON.stringify(result));
  expect(copyExportReview(result.job).privacy.findings.filter(f => f.type === 'SSN').map(f => f.value)).toEqual(['123-45-6789']);
  instance.answers.name = 'Different';instance.definition.fields.name.label = 'Different';page.bytes.fill(0);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Template changed'); }));
  const ready = acknowledgePreparedExport(result.job);const output = copyPreparedDocument(ready);
  expect(output.document.genericForm?.answers.legacy).toBeUndefined();
  expect(output.document.genericForm?.rows.roster[0].answers.legacy).toBeUndefined();
  expect(copyCapturedDocument(captured).document.genericForm?.answers.legacy).toBe('SSN 987-65-4321');
  for (let attempt = 0; attempt < 2; attempt++) {
    const artifact = await renderPreparedConfiguredForm(ready, new AbortController().signal);
    expect((await PDFDocument.load(await artifact.blob.arrayBuffer())).getPageCount()).toBe(1);
  }
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('refuses to capture unverified template revisions', async () => {
  const captured = capture();
  await expect(captureExportFormTemplates(captured)).rejects.toThrow(/checksum/);
});
