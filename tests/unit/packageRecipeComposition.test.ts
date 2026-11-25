import 'fake-indexeddb/auto';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { getPackageRevision, listActionPackages } from '@/lib/actionPackages';
import { applyPreparedConditionalPackage, prepareConditionalPackage, readConditionalPackageTemplate, startConditionalPackage } from '@/lib/packageConditional';
import { buildPortableActionPackage, parsePortableActionPackage } from '@/lib/actionPackageTransfer';
import { packageFormValues, savePackageFormValues } from '@/lib/packageFormEditing';
import { inspectPackageRequirements } from '@/lib/packageRequirements';
import { resolveMaintainedRecipe } from '@/lib/maintainedPackageActions';
import { correspondenceMember, equals, program, question } from '@/lib/packageRecipeMembers';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as classification from '@/config/classification';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('runs a forms-led training recipe with independent edits, conditional correspondence and one signer', async () => {
  const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
  vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy);
  vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy);
  const directory = 'public/templates/NAVMC10132 - Unit Punishment Book/';
  vi.stubGlobal('fetch', async (url: string) => {
    const file = decodeURIComponent(url).split('/').at(-1);
    if (file !== 'form.json' && file !== 'original.pdf') throw new Error('Unexpected catalog request');
    return new Response(new Uint8Array(await readFile(directory + file)));
  });

  const form = { kind: 'official-form', formId: 'navmc10132', required: true, facts: { '18_accused_full_name': 'name' } } as const;
  const signature = '9 NJP AUTHORITY SIGNATURE';
  const source = await resolveMaintainedRecipe({ kind: 'dondocs-package-template', version: 2, id: 'training-records',
    createdAt: 0, name: 'Training records', primaryMemberKey: 'first',
    program: program([question('name', 'Name'), question('forward', 'Forward for review?', 'boolean')]),
    members: [
      { ...form, key: 'first', role: 'supporting-document', completion: { signatureFields: [signature] } },
      { ...form, key: 'second', role: 'enclosure' },
      await correspondenceMember({ key: 'forwarding', label: 'Forwarding endorsement', role: 'endorsement',
        docType: 'new_page_endorsement', when: equals('forward', true) }),
    ] });
  const signal = new AbortController().signal;
  let record = await startConditionalPackage(source, policy, signal, () => true);
  const answers = { version: 1 as const, groups: {}, values: { name: 'Training Example', forward: false } };
  async function apply() {
    const plan = await prepareConditionalPackage({ template: source, record, answers }, policy);
    record = (await applyPreparedConditionalPackage(plan, policy, true)).record;
  }
  await apply();
  const forms = getPackageRevision(record).members;
  expect(forms).toHaveLength(2);
  for (const [index, member] of forms.entries()) {
    if (member.kind !== 'native') throw new Error('Expected an editable form');
    const values = packageFormValues(member);
    if (values.kind !== 'configured') throw new Error('Expected catalog answers');
    expect(values.answers['18_accused_full_name']).toBe('Training Example');
    record = await savePackageFormValues(record, member,
      { ...values, answers: { ...values.answers, '21_remarks': 'Copy ' + (index + 1) } }, signal);
  }
  answers.values.forward = true;
  await apply();
  [record] = await listActionPackages(record.id);
  const revision = getPackageRevision(record);
  expect(revision.members.map(member => member.role)).toEqual(['supporting-document', 'enclosure', 'endorsement']);
  expect(revision.members.slice(0, 2).map(member => member.kind === 'native' && member.session.genericForm?.answers['21_remarks'])).toEqual(['Copy 1', 'Copy 2']);
  const readiness = await inspectPackageRequirements(revision, 'pdf');
  expect(readiness.items.filter(item => item.message.includes(signature)).map(item => item.memberId)).toEqual([forms[0].id]);
  const transferred = await parsePortableActionPackage(await buildPortableActionPackage(record));
  expect(getPackageRevision(transferred.record).members).toEqual(revision.members);
  expect((await readConditionalPackageTemplate(record)).primaryMemberKey).toBe('first');
}, 60_000);

it('binds a declared endorsement on creation and after applying an intake change', async () => {
  const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
  vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy);
  vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy);
  const letter = await correspondenceMember({ key: 'request', label: 'Request letter', role: 'basic-letter',
    docType: 'standard_letter', facts: { from: 'office' } });
  const endorsement = await correspondenceMember({ key: 'forward', label: 'Endorsement', role: 'endorsement',
    docType: 'new_page_endorsement', endorses: 'request' });
  const template = await resolveMaintainedRecipe({ kind: 'dondocs-package-template', version: 2, id: 'training-request',
    createdAt: 0, name: 'Training request', primaryMemberKey: 'request', program: program([question('office', 'Originating office')]),
    members: [letter, endorsement] });
  let record = await startConditionalPackage(template, policy, undefined, () => true);
  const [original, end] = getPackageRevision(record).members;
  expect(end.endorsementLink).toMatchObject({ basicMemberId: original.id, ordinal: 'FIRST' });
  const answers = { version: 1 as const, groups: {}, values: { office: 'TRAINING OFFICE' } };
  const prepared = await prepareConditionalPackage({ template, record, answers }, policy);
  record = (await applyPreparedConditionalPackage(prepared, policy, true)).record;
  const [updated, linked] = getPackageRevision(record).members;
  expect(linked.endorsementLink).toMatchObject({ basicMemberId: original.id, basicRevisionId: updated.revisionId });
  if (linked.kind !== 'native') throw new Error('Expected native endorsement');
  expect(linked.session.formData.basicLetterId).toContain('TRAINING OFFICE');
});
