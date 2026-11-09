import { expect, it, vi } from 'vitest';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { captureFormExportTemplates, copyFormExportTemplates } from '@/lib/formExportTemplates';
import { prepareExport, copyPreparedDocument, acknowledgePreparedExport, copyExportReview } from '@/lib/preparedExport';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { useFormStore } from '@/stores/formStore';
import { renderPreparedBuiltinForm } from '@/services/exports/builtinForms';
const mocks = vi.hoisted(() => ({ render: vi.fn(async () => new Uint8Array([37, 80, 68, 70])) }));
vi.mock('@/services/pdf/navmc11811Generator', () => ({ generateNavmc11811Pdf: mocks.render }));
const source = { documentId: 'form-a', epoch: 1, editSequence: 1, capturedAt: 1 };
const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });

it('owns NAVMC data, resolved privacy findings, templates, and filename across retry', async () => {
  const forms = { includeCoverPage: false, navmc11811: { ...useFormStore.getInitialState().navmc11811, edipi: '1234567890', remarksText: '{{EDIPI}}', lastName: 'Original' } };
  const captured = captureDocumentRevision(source, { documentCategory: 'forms', documentMode: 'compliant', docType: 'standard_letter', formType: 'navmc_118_11', forms, formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {} });
  const page = new Uint8Array([1, 2, 3]);
  const templates = captureFormExportTemplates('builtin-form', 'navmc_118_11', { page1: page });
  const result = prepareExport({ id: 'form-a', captured, target: 'pdf', filename: 'original.pdf', policy, formTemplates: templates });
  if (result.status !== 'needs-review') throw new Error(JSON.stringify(result));
  expect(copyExportReview(result.job).privacy.found).toBe(true);
  const ready = acknowledgePreparedExport(result.job);
  forms.navmc11811.lastName = 'Different';page.fill(9);copyFormExportTemplates(templates).page1.fill(8);
  expect(copyPreparedDocument(ready).document.forms?.navmc11811?.remarksText).toBe('1234567890');
  await renderPreparedBuiltinForm(ready, new AbortController().signal);
  await renderPreparedBuiltinForm(ready, new AbortController().signal);
  for (const [data, template] of mocks.render.mock.calls as unknown as [typeof forms.navmc11811, ArrayBuffer][]) {
    expect(data.lastName).toBe('Original');expect([...new Uint8Array(template)]).toEqual([1, 2, 3]);
  }
});
it('does not approve built-in form export without its selected templates', () => {
  expect(() => copyFormExportTemplates({} as never)).toThrow();
  expect(() => captureFormExportTemplates('builtin-form', 'navmc_10274', {})).toThrow();
});

it.each(['page1', 'page2', 'page3'])('rejects an incomplete NAVMC 10274 bundle before issuing a capability: missing %s', missing => {
  const pages = Object.fromEntries(['page1', 'page2', 'page3'].filter(name => name !== missing).map(name => [name, new Uint8Array([1])]));
  expect(() => captureFormExportTemplates('builtin-form', 'navmc_10274', pages)).toThrow(`Form template missing: ${missing}`);
});
it('retains own template keys that also exist on Object.prototype', () => {
  const pages = Object.fromEntries([['__proto__', new Uint8Array([1, 2, 3])]]);
  const captured = captureFormExportTemplates('configured-form', 'fixture', pages, 'fixture-definition');
  expect(copyFormExportTemplates(captured).__proto__).toEqual(new Uint8Array([1, 2, 3]));
});
