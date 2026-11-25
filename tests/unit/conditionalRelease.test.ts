import 'fake-indexeddb/auto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { maintainedPackageAction } from '@/lib/maintainedPackageActions';
import { listConditionalPackageInstances } from '@/lib/packageConditional';
import { compileFormDefinition, validateAnswers } from '@/services/forms/model';
import { renderForm } from '@/services/forms/render';

vi.mock('react-pdf', async () => ({ pdfjs: await import('pdfjs-dist/legacy/build/pdf.mjs') }));
vi.mock('@/components/pdf/pdfConfig', async () => {
  const { GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  GlobalWorkerOptions.workerSrc = resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
  return { HARDENED_PDF_OPTIONS: { isEvalSupported: false } };
});
afterEach(() => vi.unstubAllGlobals());
const directory = 'public/templates/dd/0368/2024-11-26';

it('fills the official two-page PDF and reopens the same named answers and four signature boxes', async () => {
  const original = await readFile(directory + '/original.pdf');
  const definition = compileFormDefinition(JSON.parse(await readFile(directory + '/form.json', 'utf8')));
  const answers = { member_name: 'RIVERA, EXAMPLE', member_street: '123 Training Lane', approved: true,
    valid_until: '2027-03-01', remarks: 'Training only' };
  expect(validateAnswers(definition, { ...answers, disapproved: true }, {})).toContainEqual(
    expect.objectContaining({ code: 'conflicting-decision' }));
  const output = await renderForm({ definition, answers, answerRevision: 1, rows: {} }, 'export', async () => original);
  expect(original.equals(output.bytes.subarray(0, original.length))).toBe(true);
  const pdf = await getDocument({ data: output.bytes, isEvalSupported: false }).promise;
  try {
    const widgets = await pdf.getFieldObjects();
    expect(pdf.numPages).toBe(2);
    for (const [key, value] of Object.entries(answers)) {
      const field = definition.fields[key].sourceIds![0];
      const widget = widgets?.[field]?.[0];
      expect(widget && 'value' in widget && widget.value).toBe(value === true ? '1' : value);
    }
    expect(Object.values(widgets!).flat().filter(widget => 'type' in widget && widget.type === 'signature')).toHaveLength(4);
  } finally { await pdf.destroy(); }
});

it('selects the request, returned decision, and final records independently by stage', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(new Uint8Array(await readFile('public' + new URL(url, 'https://test.invalid').pathname))));
  const template = await maintainedPackageAction('conditional-release');
  const request = ['request-letter', 'endorsement', 'request'];
  for (const [stage, expected] of Object.entries({ request, approved: [...request, 'decision-form'],
    disapproved: [...request, 'decision-form'], completed: [...request, 'decision-form', 'notification', 'oath', 'orders'] })) {
    const instances = listConditionalPackageInstances(template, { version: 1, groups: {}, values: { stage } });
    expect(instances.filter(item => item.condition === true).map(item => item.memberKey)).toEqual(expected);
  }
  expect(template.members.find(m => m.key === 'request')).toMatchObject({ kind: 'native', draft: { genericForm: { definition: { formId: 'dd0368' } } } });
});

it('preserves the received DD 368 exactly through transfer and blocks conflicting decision marks', async () => {
  const { captureOriginalPackageMember } = await import('@/lib/actionPackageAssets');
  const { createActionPackage, getPackageRevision, reviseActionPackage } = await import('@/lib/actionPackages');
  const { buildPortableActionPackage, parsePortableActionPackage } = await import('@/lib/actionPackageTransfer');
  const { inspectPackageRequirements } = await import('@/lib/packageRequirements');
  const original = await readFile(directory + '/original.pdf');
  const definition = compileFormDefinition(JSON.parse(await readFile(directory + '/form.json', 'utf8')));
  const filled = await renderForm({ definition, answers: { member_name: 'RIVERA, EXAMPLE', approved: true },
    answerRevision: 1, rows: {} }, 'export', async () => original);
  const file = { name: 'returned.pdf', data: new Uint8Array(filled.bytes).buffer };
  const member = await captureOriginalPackageMember(file, 'supporting-document', true);
  if (member.kind !== 'original') throw new Error('Expected a preserved official original');
  expect(member.officialFormId).toBe('dd0368');
  const record = await reviseActionPackage(await createActionPackage('Return test'), [member]);
  const { record: restored, resources } = await parsePortableActionPackage(await buildPortableActionPackage(record));
  expect(new Uint8Array(resources.get('assets/' + member.original.id)!.data)).toEqual(new Uint8Array(file.data));

  const revision = getPackageRevision(restored);
  const approval = definition.fields.approved.sourceIds![0], disapproval = definition.fields.disapproved.sourceIds![0];
  const rule = { requiredPdfFields: [approval], uncheckedPdfFields: [disapproval] };
  revision.requirements = { version: 1, items: [{ id: 'decision', kind: 'document', label: 'Decision',
    operations: ['pdf'], memberId: member.id, condition: 'active', completion: rule }] };
  expect((await inspectPackageRequirements(revision, 'pdf')).ready).toBe(true);
  // An external producer can save both independent widgets even though DonDocs rejects this edit.
  const pdf = await getDocument({ data: new Uint8Array(file.data.slice(0)) }).promise;
  let ambiguous: Uint8Array;
  try {
    const widget = (await pdf.getFieldObjects())?.[disapproval]?.[0];
    if (!widget || !('id' in widget) || typeof widget.id !== 'string') throw new Error('Missing checkbox');
    pdf.annotationStorage.setValue(widget.id, { value: true });
    ambiguous = await pdf.saveDocument();
  } finally { await pdf.destroy(); }
  const replacement = await captureOriginalPackageMember({ name: 'ambiguous.pdf', data: new Uint8Array(ambiguous).buffer }, 'supporting-document', true);
  revision.members = [replacement];
  const decision = revision.requirements.items[0];
  if (decision.kind !== 'document') throw new Error('Expected a document requirement');
  decision.memberId = replacement.id;
  const inspected = await inspectPackageRequirements(revision, 'pdf');
  expect(inspected.ready).toBe(false);
  expect(inspected.items[0].message).toContain('conflicting selection');
});
