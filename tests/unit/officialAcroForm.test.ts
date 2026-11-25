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
    const template = await resolveMaintainedRecipe({ id: 'test', createdAt: 0, version: 2, name: 'Training', kind: 'dondocs-package-template', members: [{ ...membership, kind: 'official-form' },
        { ...membership, kind: 'official-form', key: 'second-upb', role: 'enclosure' }],
      program: { revision: '1', questions: [], participantGroups: [], requirements: [] } });
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
