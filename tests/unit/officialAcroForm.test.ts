import 'fake-indexeddb/auto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createOfficialFormMember } from '@/lib/packageOfficialForms';
import { buildPortableActionPackage, parsePortableActionPackage } from '@/lib/actionPackageTransfer';
import { createActionPackage, reviseActionPackage, getPackageRevision } from '@/lib/actionPackages';
import { compileFormDefinition } from '@/services/forms/model';
import { renderForm } from '@/services/forms/render';
import { resolveMaintainedRecipe } from '@/lib/maintainedPackageActions';

vi.mock('react-pdf', async () => ({ pdfjs: await import('pdfjs-dist/legacy/build/pdf.mjs') }));
vi.mock('@/components/pdf/pdfConfig', async () => {
  const { GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  GlobalWorkerOptions.workerSrc = resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
  return { HARDENED_PDF_OPTIONS: { isEvalSupported: false } };
});

it('opens the same catalog edition independently and transfers one exact three-page source', async () => {
  const directory = 'public/templates/NAVMC10132 - Unit Punishment Book';
  const definition = compileFormDefinition(JSON.parse(await readFile(directory + '/form.json', 'utf8')));
  const original = await readFile(directory + '/original.pdf');
  vi.stubGlobal('fetch', async (url: string) => {
    const file = decodeURIComponent(url).split('/').at(-1);
    if (file !== 'form.json' && file !== 'original.pdf') throw new Error('Unexpected URL');
    return new Response(new Uint8Array(await readFile(directory + '/' + file)));
  });
  try {
    const membership = { key: 'upb', formId: definition.formId, role: 'basic-letter', required: true } as const;
    const template = await resolveMaintainedRecipe({ id: 'test', createdAt: 0, version: 2, name: 'Training', kind: 'dondocs-package-template', members: [{ ...membership, kind: 'official-form', facts: { '18_accused_full_name': 'firstName' } },
        { ...membership, kind: 'official-form', key: 'second-upb', role: 'enclosure', facts: { '18_accused_full_name': 'secondName' } }],
      program: { revision: '1', questions: ['firstName', 'secondName'].map(id => ({ id, label: id, kind: 'text', required: true })), participantGroups: [], requirements: [] } });
    expect(template.members.map(member => member.links?.map(link => link.questionId))).toEqual([['firstName'], ['secondName']]);
    expect(template.members[0]).toMatchObject({ key: 'upb', kind: 'native' });
    expect(template.members[1]).toMatchObject({ key: 'second-upb', pages: {}, pagesFrom: 'upb' });
    const a = await createOfficialFormMember(membership.formId, membership.role);
    const b = await createOfficialFormMember(membership.formId, membership.role);
    expect(a.id).not.toEqual(b.id);
    expect(Object.keys(a.templates!)).toEqual(['original.pdf']);
    const record = await reviseActionPackage(await createActionPackage('Training'), [a,b]);
    const transferred = await parsePortableActionPackage(await buildPortableActionPackage(record));
    expect(getPackageRevision(transferred.record).members).toHaveLength(2);
    expect(b.session.genericForm!.answers).toEqual({});
    const output = await renderForm({ definition, answers: { '18_accused_full_name': 'TRAINING, PAT', '21_remarks': 'Second page' }, rows: {}, answerRevision: 1 }, 'export', async () => original);
    const remapped = structuredClone(definition);
    remapped.fields['18_accused_full_name'].sourceIds = ['21 REMARKS'];
    await expect(renderForm({ definition: remapped, answers: {}, rows: {}, answerRevision: 0 }, 'export', async () => original))
      .rejects.toThrow('field definitions do not match');
    expect(Buffer.compare(original, output.bytes.subarray(0,original.length))).toBe(0);
    const task = getDocument({ data: new Uint8Array(output.bytes), verbosity: 0 });
    try {
      const doc = await task.promise;
      expect(doc.numPages).toBe(3);
      const fields = await doc.getFieldObjects();
      expect(fields?.['23 ACCUSED FULL NAME'][0]).toMatchObject({ value: 'TRAINING, PAT' });
      expect(fields?.['21 REMARKS'][0]).toMatchObject({ value: 'Second page' });
      expect(Object.values(fields ?? {}).flat().filter(f => 'type' in f && f.type === 'signature')).toHaveLength(7);
    } finally { await task.destroy(); }
  } finally { vi.unstubAllGlobals(); }
}, 30000);

it.each([
  ['page11', 'navmc_118_11', 'NAVMC11811 - Administrative Remarks/2014-05'],
  ['upb', 'navmc10132', 'NAVMC10132 - Unit Punishment Book'],
])('retains the complete signed %s original through portable package transfer', async (fixture, formId, directory) => {
  const { captureOriginalPackageMember } = await import('@/lib/actionPackageAssets');
  const blank = await readFile(resolve('public/templates', directory, 'original.pdf'));
  // Each fixture contains only the incremental revision signed with the synthetic qualification certificate.
  const revision = await readFile(resolve('tests/fixtures/official-form-signing', fixture + '.increment'));
  const signed = new Uint8Array(Buffer.concat([blank, revision]));
  const member = await captureOriginalPackageMember({ name: fixture + '.pdf', data: signed.buffer }, 'basic-letter', true);
  const record = await reviseActionPackage(await createActionPackage('Signature transfer'), [member]);
  const transferred = await parsePortableActionPackage(await buildPortableActionPackage(record));
  const original = getPackageRevision(transferred.record).members[0];
  if (original.kind !== 'original') throw new Error('Expected the signed original.');
  expect(original.officialFormId).toBe(formId);
  expect(original.signedOriginal).toBe(true);
  const resource = transferred.resources.get('assets/' + original.original.id)!;
  expect(Buffer.compare(Buffer.from(resource.data), signed)).toBe(0);
}, 30000);

it('updates the remaining linked form and preserves an already signed official member through transfer', async () => {
  const { captureOriginalPackageMember, readPackageAsset } = await import('@/lib/actionPackageAssets');
  const { preparePackageUpdate, applyPreparedPackageUpdate } = await import('@/lib/packageUpdates');
  const { linkOfficialFormDetail } = await import('@/lib/officialFormFieldLinks');
  const { resolveExportDeploymentPolicy } = await import('@/lib/exportDeploymentPolicy');
  const classification = await import('@/config/classification');
  const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
  const directory = 'public/templates/NAVMC10132 - Unit Punishment Book';
  const original = await readFile(directory + '/original.pdf');
  const signed = new Uint8Array(Buffer.concat([original, await readFile('tests/fixtures/official-form-signing/upb.increment')]));
  vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy);
  vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy);
  vi.stubGlobal('fetch', async (url: string) => {
    const file = decodeURIComponent(url).split('/').at(-1);
    if (file !== 'form.json' && file !== 'original.pdf') throw new Error('Unexpected URL');
    return new Response(new Uint8Array(await readFile(directory + '/' + file)));
  });
  try {
    const a = await createOfficialFormMember('navmc10132', 'basic-letter');
    const b = await createOfficialFormMember('navmc10132', 'enclosure');
    const record = await reviseActionPackage(await createActionPackage('Signed field links'), [a, b]);
    const items = await linkOfficialFormDetail([a, b], 'name', 'name', []);
    await expect(linkOfficialFormDetail([b], 'name', 'other-person', items)).rejects.toThrow('different link');
    const facts = (value: string) => ({ version: 1 as const, participants: [],
      facts: [{ id: 'name', kind: 'text' as const, label: 'Name', value, source: { kind: 'entered' as const } }] });
    const linked = (await applyPreparedPackageUpdate(await preparePackageUpdate(record, facts('Sample, Pat'), { version: 1, items }, {}, policy), policy, true)).record;
    const current = getPackageRevision(linked);
    const signedMember = { ...await captureOriginalPackageMember({ name: 'signed.pdf', data: signed.buffer }, a.role, true), id: a.id };
    if (signedMember.kind !== 'original') throw new Error('Expected the retained signed 10132.');
    const captured = await reviseActionPackage(linked, [signedMember, current.members[1]]);
    const { packageBindingReadiness } = await import('@/lib/packageFieldBindings');
    expect(await packageBindingReadiness(getPackageRevision(captured))).toEqual([]);
    const wrongForm = getPackageRevision(captured);
    wrongForm.members[0] = { ...signedMember, officialFormId: 'navmc_118_11' };
    expect(await packageBindingReadiness(wrongForm, a.id)).toHaveLength(1);
    expect(await packageBindingReadiness(wrongForm, b.id)).toEqual([]);
    const preview = await preparePackageUpdate(captured, facts('Updated, Lee'), current.bindings, {}, policy);
    expect(preview.ready).toBe(true);
    expect(preview.changes.map(change => [change.memberId, change.state])).toEqual([[a.id, 'signed-original'], [b.id, 'update']]);
    const updated = (await applyPreparedPackageUpdate(preview, policy, true)).record;
    expect(updated.revisions.slice(0, -1)).toEqual(captured.revisions);
    const [frozen, editable] = getPackageRevision(updated).members;
    expect(frozen).toEqual(signedMember);
    expect(editable).toMatchObject({ session: { genericForm: { answers: { '18_accused_full_name': 'Updated, Lee' } } } });
    expect(Buffer.compare(Buffer.from(await readPackageAsset(signedMember.original)), signed)).toBe(0);
    const portable = await parsePortableActionPackage(await buildPortableActionPackage(updated));
    expect(getPackageRevision(portable.record).members[0]).toEqual(signedMember);
    expect(await packageBindingReadiness(getPackageRevision(portable.record))).toEqual([]);
    expect(Buffer.compare(Buffer.from(portable.resources.get('assets/' + signedMember.original.id)!.data), signed)).toBe(0);
  } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
}, 45_000);

it('reads required answers from the actual saved election rather than its package metadata', async () => {
  const { missingRequiredPdfFields } = await import('@/services/forms/readRequiredPdfFields');
  const directory = 'public/templates/jagman/a-1-d/5800.7G-CH2/1';
  const definition = compileFormDefinition(JSON.parse(await readFile(directory + '/form.json', 'utf8')));
  const original = new Uint8Array(await readFile(directory + '/fillable.pdf'));
  const required = ['marine', 'unit', 'election'];
  expect(await missingRequiredPdfFields(original.buffer, required)).toEqual(required);
  const rendered = await renderForm({ definition, answers: { marine: 'TRAINING EXAMPLE', election: 'refuse' }, rows: {}, answerRevision: 1 },
    'preview', async () => original);
  expect(await missingRequiredPdfFields(new Uint8Array(rendered.bytes).buffer, required)).toEqual(['unit']);
});


it('rejects missing and mismatched official editions when starting a recipe slot', async () => {
  const { officialFormBlueprint } = await import('@/lib/packageOfficialForms');
  const member = { key: 'rights', role: 'supporting-document' as const, required: true, formId: 'jagman_a1d' };
  await expect(officialFormBlueprint({ ...member, completion: { expectedForm: { id: member.formId, edition: 'unavailable' } } }))
    .rejects.toThrow('official form is unavailable');
  await expect(officialFormBlueprint({ ...member, completion: { expectedForm: { id: 'jagman_a1g', edition: '5800.7G-CH2.1' } } }))
    .rejects.toThrow('different official form');
});
