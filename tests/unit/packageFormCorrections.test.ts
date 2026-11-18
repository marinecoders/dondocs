import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { packageFormFixture } from '../_helpers/packageFormReviewFixture';
import { addPackageFormProposal, capturePackageFormAnchor, packageFormReviewFields } from '@/lib/packageFormReview';
import { savePackageMemberReview } from '@/lib/packageMemberReviews';
import { applyPreparedPackageFormCorrection, preparePackageFormCorrection, preparePackageFormDecisionUndo } from '@/lib/packageFormCorrections';
import { commitActionPackage, getPackageRevision, listActionPackages, newPackageId, reviseActionPackage } from '@/lib/actionPackages';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as classification from '@/config/classification';
import { idbGetAllAttachments } from '@/lib/documentsDb';
import { buildPortableActionPackage } from '@/lib/actionPackageTransfer';
import { buildPackageReviewerCopy, packageReviewTransferFile, parsePackageReviewTransfer } from '@/lib/packageReviewTransfer';
import { patchPackageBindingDraftFields } from '@/lib/packageBindingTargets';
import { readPackageMemberDraft, retainPackageAsset } from '@/lib/actionPackageAssets';
import { transitionPackageReview } from '@/lib/packageReviewRounds';
import { extractPdfText } from '@/lib/pdfText';
import { PDFDocument } from 'pdf-lib';
import { portableResourceDigest } from '@/lib/portableResources';
import { validatePackageDraft } from '@/lib/actionPackageDraft';
import { uint8ArrayToBase64 } from '@/lib/encoding';
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
beforeEach(() => { vi.restoreAllMocks(); vi.mocked(extractPdfText).mockResolvedValue(''); vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy); vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy); });
async function proposed(fieldId = 'name', value: string | boolean = '000999', templatePage?: Parameters<typeof packageFormFixture>[0]) {
  const { record, round, child, member } = await packageFormFixture(templatePage);
  const field = (await packageFormReviewFields(member)).find(field => field.target.kind === 'configured-form' && field.target.fieldId === fieldId && !field.target.row)!;
  const anchor = await capturePackageFormAnchor(member, field.target);
  const fieldReview = await addPackageFormProposal(member, undefined, anchor, 'Alex Example', value);
  const owner = await savePackageMemberReview(record, round.id, { ...child, fieldReview });
  return { owner, round, member, anchor, proposal: fieldReview.proposals![0] };
}
async function linked() {
  const data = await proposed(), current = getPackageRevision(data.owner);
  const second = { ...structuredClone(current.members[0]), id: newPackageId('member'), revisionId: newPackageId('member-revision'), label: 'Second synthetic form' };
  const revision = { ...current, id: newPackageId('revision'), parentId: current.id, createdAt: Date.now(), members: [...current.members, second], outputs: [],
    information: { version: 1 as const, participants: [], facts: [{ id: 'identifier', label: 'Shared identifier', kind: 'identifier' as const, value: '000123', source: { kind: 'entered' as const } }] },
    bindings: { version: 1 as const, items: [data.member, second].map((member, index) => ({ id: `link${index}`, memberId: member.id, factId: 'identifier', target: data.anchor.target, expectedValue: '000123', mode: 'linked' as const, format: 'field' as const })) } };
  const owner = await commitActionPackage(data.owner, { ...data.owner, sequence: data.owner.sequence + 1, currentRevisionId: revision.id, revisions: [...data.owner.revisions, revision] });
  return { ...data, owner, second };
}
it('privately prepares an exact local correction, preserves shared facts and other members, and supports reviewed Undo', async () => {
  const { owner, round, member, proposal } = await linked(), before = await idbGetAllAttachments();
  const prepared = await preparePackageFormCorrection(owner, round.id, member.id, proposal.id, 'accepted', policy);
  expect(prepared.ready).toBe(true); expect(await idbGetAllAttachments()).toEqual(before);
  expect((await listActionPackages()).find(item => item.id === owner.id)).toEqual(owner);
  await expect(applyPreparedPackageFormCorrection(prepared, policy, false)).rejects.toThrow(/review/);
  const accepted = await applyPreparedPackageFormCorrection(prepared, policy, true), revision = getPackageRevision(accepted);
  expect(revision.members[0].kind === 'native' && revision.members[0].session.genericForm!.answers.name).toBe('000999');
  expect(revision.members[1]).toEqual(getPackageRevision(owner).members[1]);
  expect(revision.information).toEqual(getPackageRevision(owner).information);
  expect(revision.bindings!.items[0].mode).toBe('override'); expect(revision.bindings!.items[1].mode).toBe('linked');
  expect(accepted.revisions.slice(0, -1)).toEqual(owner.revisions);
  const undo = await preparePackageFormDecisionUndo(accepted, accepted.fieldReviewApplications![0].id, policy);
  const restored = await applyPreparedPackageFormCorrection(undo, policy, true);
  expect(getPackageRevision(restored).members).toEqual(getPackageRevision(owner).members);
  expect(getPackageRevision(restored).bindings).toEqual(getPackageRevision(owner).bindings);
  expect(restored.fieldReviewApplications).toHaveLength(2);
});
it('requires an explicit matching package value before a reviewed shared update reaches all linked forms', async () => {
  const { owner, round, member, proposal } = await linked();
  await expect(preparePackageFormCorrection(owner, round.id, member.id, proposal.id, 'accepted', policy, { mode: 'shared' })).rejects.toThrow(/enter/);
  await expect(preparePackageFormCorrection(owner, round.id, member.id, proposal.id, 'accepted', policy, { mode: 'shared', sharedValue: 'Wrong' })).rejects.toThrow(/format/);
  const preview = await preparePackageFormCorrection(owner, round.id, member.id, proposal.id, 'accepted', policy, { mode: 'shared', sharedValue: '000999' });
  expect(preview.changes).toHaveLength(2);
  const saved = await applyPreparedPackageFormCorrection(preview, policy, true), revision = getPackageRevision(saved);
  expect(revision.information!.facts[0].value).toBe('000999');
  expect(revision.members.map(member => member.kind === 'native' && member.session.genericForm!.answers.name)).toEqual(['000999', '000999']);
  expect(revision.bindings!.items.every(binding => binding.mode === 'linked')).toBe(true);
  const portable = JSON.parse(await buildPortableActionPackage(saved)); expect(portable.package.fieldReviewApplications).toBeUndefined();
});
it('supports typed boolean proposals and rejection without changing form answers', async () => {
  const { owner, round, member, proposal } = await proposed('b', false);
  expect(proposal.anchor.context).toBeNull(); expect(proposal.value).toBe(false);
  const prepared = await preparePackageFormCorrection(owner, round.id, member.id, proposal.id, 'rejected', policy);
  const rejected = await applyPreparedPackageFormCorrection(prepared, policy, true);
  expect(getPackageRevision(rejected).members).toEqual(getPackageRevision(owner).members);
  expect(rejected.fieldReviewApplications![0].action).toBe('rejected');
  await expect(preparePackageFormCorrection(rejected, round.id, member.id, proposal.id, 'accepted', policy)).rejects.toThrow(/already/);
  const json = await packageReviewTransferFile(await buildPackageReviewerCopy(rejected, round.id, policy), policy);
  const parsed = await parsePackageReviewTransfer(json); expect(parsed.record.fieldReviewApplications).toBeUndefined();
  expect(parsed.memberReviews[0].fieldReview!.proposals![0].value).toBe(false);
});
it('prevents cancelled, stale, readonly and changed-policy decisions from writing files or saved state', async () => {
  const { owner, round, member, proposal } = await proposed(), bytes = await idbGetAllAttachments();
  const prepared = await preparePackageFormCorrection(owner, round.id, member.id, proposal.id, 'accepted', policy), cancel = new AbortController(); cancel.abort();
  await expect(applyPreparedPackageFormCorrection(prepared, policy, true, cancel.signal)).rejects.toThrow();
  await expect(applyPreparedPackageFormCorrection(prepared, policy, true, undefined, () => false)).rejects.toThrow();
  expect(await idbGetAllAttachments()).toEqual(bytes);
  const unknown = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'secret', allowedLevels: ['unclassified','secret'] }, runtime: { status: 'absent' } });
  vi.mocked(classification.getExportDeploymentPolicy).mockResolvedValueOnce(unknown);
  await expect(applyPreparedPackageFormCorrection(prepared, policy, true)).rejects.toThrow(/settings/);
  const newer = await reviseActionPackage(owner, getPackageRevision(owner).members);
  await expect(applyPreparedPackageFormCorrection(prepared, policy, true)).rejects.toThrow(/changed/);
  const closed = await transitionPackageReview(newer, round.id, 'close');
  await expect(preparePackageFormCorrection(closed, round.id, member.id, proposal.id, 'accepted', policy)).rejects.toThrow(/closed/);
});
it('refuses silent acceptance into changed fields and refuses Undo over a newer revision', async () => {
  const { owner, round, member, proposal } = await proposed();
  const saved = await applyPreparedPackageFormCorrection(await preparePackageFormCorrection(owner, round.id, member.id, proposal.id, 'accepted', policy), policy, true);
  const newer = await reviseActionPackage(saved, getPackageRevision(saved).members);
  await expect(preparePackageFormDecisionUndo(newer, saved.fieldReviewApplications![0].id, policy)).rejects.toThrow(/Newer work/);
  expect((await listActionPackages()).find(item => item.id === owner.id)).toEqual(newer);
});

it('requires deliberate resolution before a shared correction overwrites another locally edited field', async () => {
  const { owner: initial, round, member, proposal, second } = await linked();
  if (second.kind !== 'native') throw new Error('Expected synthetic native form.');
  const source = await readPackageMemberDraft(second), patched = await patchPackageBindingDraftFields(source.draft,
    [{ target: proposal.anchor.target, expected: '000123', value: '000444' }]);
  const asset = await retainPackageAsset(second.draft.name, second.draft.type, new TextEncoder().encode(JSON.stringify(patched.draft)).buffer);
  const owner = await reviseActionPackage(initial, getPackageRevision(initial).members.map(item => item.id === second.id ? { ...second, session: patched.session, draft: asset } : item));
  const conflict = await preparePackageFormCorrection(owner, round.id, member.id, proposal.id, 'accepted', policy, { mode: 'shared', sharedValue: '000999' });
  expect(conflict.ready).toBe(false); expect(conflict.issues.length).toBeGreaterThan(0);
  await expect(applyPreparedPackageFormCorrection(conflict, policy, true)).rejects.toThrow(/review/);
  const resolved = await preparePackageFormCorrection(owner, round.id, member.id, proposal.id, 'accepted', policy, { mode: 'shared', sharedValue: '000999', choices: { link1: 'keep-local' } });
  const saved = await applyPreparedPackageFormCorrection(resolved, policy, true), revision = getPackageRevision(saved);
  expect(revision.members.map(item => item.kind === 'native' && item.session.genericForm!.answers.name)).toEqual(['000999', '000444']);
  expect(revision.bindings!.items[1].mode).toBe('override');
});

it('reviews every restored downstream value before Undo under a stricter deployment policy', async () => {
  const secret = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'secret', allowedLevels: ['unclassified', 'secret'] }, runtime: { status: 'absent' } });
  const { owner: initial, round, member, proposal, second } = await linked();
  if (second.kind !== 'native') throw new Error('Expected synthetic native form.');
  const source = await readPackageMemberDraft(second), patched = await patchPackageBindingDraftFields(source.draft,
    [{ target: proposal.anchor.target, expected: '000123', value: 'Synthetic older value\n(S) Restricted synthetic example.' }]);
  const asset = await retainPackageAsset(second.draft.name, second.draft.type, new TextEncoder().encode(JSON.stringify(patched.draft)).buffer);
  const owner = await reviseActionPackage(initial, getPackageRevision(initial).members.map(item => item.id === second.id ? { ...second, session: patched.session, draft: asset } : item));
  vi.mocked(classification.getExportDeploymentPolicy).mockResolvedValue(secret); vi.mocked(classification.getExportDeploymentPolicySync).mockReturnValue(secret);
  const accepted = await applyPreparedPackageFormCorrection(await preparePackageFormCorrection(owner, round.id, member.id, proposal.id, 'accepted', secret,
    { mode: 'shared', sharedValue: '000999', choices: { link1: 'apply-package' } }), secret, true);
  const before = await idbGetAllAttachments();
  vi.mocked(classification.getExportDeploymentPolicy).mockResolvedValue(policy); vi.mocked(classification.getExportDeploymentPolicySync).mockReturnValue(policy);
  await expect(preparePackageFormDecisionUndo(accepted, accepted.fieldReviewApplications![0].id, policy)).rejects.toThrow(/marking|levels|deployment/i);
  expect((await listActionPackages()).find(item => item.id === accepted.id)).toEqual(accepted);
  expect(await idbGetAllAttachments()).toEqual(before);
});
it.each(['template', 'enclosure'])('reviews preserved native %s PDF content before Undo under a stricter deployment policy', async resource => {
  const secret = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'secret', allowedLevels: ['unclassified', 'secret'] }, runtime: { status: 'absent' } });
  const document = await PDFDocument.create(); document.addPage([612, 792]).drawText('(S) Restricted synthetic template text.');
  const bytes = await document.save(), sha256 = await portableResourceDigest(bytes.slice().buffer as ArrayBuffer);
  const data = await proposed('name', '000999', resource === 'template' ? { bytes, sha256 } : undefined);
  const { round, member, proposal } = data; let owner = data.owner;
  if (resource === 'enclosure') {
    const captured = await readPackageMemberDraft(member), draft = { ...(captured.draft as Record<string, unknown>),
      enclosures: [{ title: 'Synthetic retained enclosure', hasFile: true, file: { name: 'synthetic.pdf', size: bytes.byteLength, data: uint8ArrayToBase64(bytes) } }] };
    const validated = await validatePackageDraft(draft), asset = await retainPackageAsset(member.draft.name, member.draft.type, new TextEncoder().encode(JSON.stringify(draft)).buffer);
    owner = await reviseActionPackage(owner, [{ ...member, draft: asset, session: validated.session }]);
  }
  vi.mocked(classification.getExportDeploymentPolicy).mockResolvedValue(secret); vi.mocked(classification.getExportDeploymentPolicySync).mockReturnValue(secret);
  const accepted = await applyPreparedPackageFormCorrection(await preparePackageFormCorrection(owner, round.id, member.id, proposal.id, 'accepted', secret), secret, true);
  vi.mocked(extractPdfText).mockImplementation(async input => await portableResourceDigest((input instanceof Uint8Array ? input.slice().buffer : input.slice(0)) as ArrayBuffer) === sha256
    ? 'Synthetic original template.\n(S) Restricted synthetic template text.' : '');
  vi.mocked(classification.getExportDeploymentPolicy).mockResolvedValue(policy); vi.mocked(classification.getExportDeploymentPolicySync).mockReturnValue(policy);
  await expect(preparePackageFormDecisionUndo(accepted, accepted.fieldReviewApplications![0].id, policy)).rejects.toThrow(/marking|levels|deployment/i);
  expect(vi.mocked(extractPdfText)).toHaveBeenCalledWith(bytes.buffer);
  expect((await listActionPackages()).find(item => item.id === accepted.id)).toEqual(accepted);
});
it('reviews archived template source bytes before Undo under a stricter policy after template adoption', async () => {
  const { maintenanceFixture } = await import('../_helpers/packageTemplateMaintenance');
  const { prepareConditionalPackage, applyPreparedConditionalPackage, prepareConditionalTemplateUpgrade } = await import('@/lib/packageConditional');
  const { startPackageReview } = await import('@/lib/packageReviewRounds');
  const { preparePackageReviewMember } = await import('@/lib/packageMemberReviews');
  const secret = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'secret', allowedLevels: ['unclassified', 'secret'] }, runtime: { status: 'absent' } });
  vi.mocked(classification.getExportDeploymentPolicy).mockResolvedValue(secret); vi.mocked(classification.getExportDeploymentPolicySync).mockReturnValue(secret);
  const template = maintenanceFixture(); template.program.questions[0].label = '(S) Restricted synthetic archived question';
  const answers = { version: 1 as const, values: { subject: 'Public current value' }, groups: {} };
  let owner = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template, name: 'Public current package', answers }, secret), secret, true)).record;
  const target = structuredClone(template); target.id = 'public_upgrade'; target.program.revision = '3'; target.program.questions[0].label = 'Public current question';
  owner = (await applyPreparedConditionalPackage(await prepareConditionalTemplateUpgrade({ record: owner, template: target, answers, questionMappings: { subject: 'subject' }, memberMappings: { main: 'main' }, preserveUnmapped: true }, secret), secret, true)).record;
  const { member } = await packageFormFixture();
  owner = await reviseActionPackage(owner, [...getPackageRevision(owner).members, member]); owner = await startPackageReview(owner);
  const round = owner.reviewRounds!.at(-1)!, preparedChild = await preparePackageReviewMember(owner, round.id, member.id); owner = preparedChild.record;
  const field = (await packageFormReviewFields(member)).find(field => field.target.kind === 'configured-form' && field.target.fieldId === 'name' && !field.target.row)!;
  const fieldReview = await addPackageFormProposal(member, undefined, await capturePackageFormAnchor(member, field.target), 'Alex Example', '000999');
  owner = await savePackageMemberReview(owner, round.id, { ...preparedChild.child, fieldReview });
  const accepted = await applyPreparedPackageFormCorrection(await preparePackageFormCorrection(owner, round.id, member.id, fieldReview.proposals![0].id, 'accepted', secret), secret, true);
  expect(JSON.stringify(getPackageRevision(owner))).not.toContain('Restricted synthetic archived question');
  expect(getPackageRevision(owner).templateState!.upgrades).toHaveLength(1);
  const files = await idbGetAllAttachments();
  vi.mocked(classification.getExportDeploymentPolicy).mockResolvedValue(policy); vi.mocked(classification.getExportDeploymentPolicySync).mockReturnValue(policy);
  await expect(preparePackageFormDecisionUndo(accepted, accepted.fieldReviewApplications![0].id, policy)).rejects.toThrow(/marking|levels|deployment/i);
  expect((await listActionPackages()).find(item => item.id === accepted.id)).toEqual(accepted); expect(await idbGetAllAttachments()).toEqual(files);
});

it('rejects an Undo receipt that restores its answer but changes unrelated package metadata', async () => {
  const { validatePackageFieldReviewApplications } = await import('@/lib/packageFormDecisionValidation');
  const { owner, round, member, proposal } = await proposed();
  const accepted = await applyPreparedPackageFormCorrection(await preparePackageFormCorrection(owner, round.id, member.id, proposal.id, 'accepted', policy), policy, true);
  const restored = await applyPreparedPackageFormCorrection(await preparePackageFormDecisionUndo(accepted, accepted.fieldReviewApplications![0].id, policy), policy, true);
  await expect(validatePackageFieldReviewApplications(restored)).resolves.toBeUndefined();
  const forged = structuredClone(restored);
  forged.revisions.find(revision => revision.id === forged.currentRevisionId)!.information = { version: 1, participants: [], facts: [{ id: 'unexpected', label: 'Unreviewed change during Undo', kind: 'text', value: 'Unexpected package data', source: { kind: 'entered' } }] };
  await expect(validatePackageFieldReviewApplications(forged)).rejects.toThrow(/undo|restore|decision/i);
});

it('rejects a saved decision whose proposal differs from the retained reviewer feedback', async () => {
  const { validatePackageFieldReviewApplications } = await import('@/lib/packageFormDecisionValidation');
  const { actionPackageSchema } = await import('@/lib/actionPackages');
  const { owner, round, member, proposal } = await proposed();
  const accepted = await applyPreparedPackageFormCorrection(await preparePackageFormCorrection(owner, round.id, member.id, proposal.id, 'accepted', policy), policy, true);
  const forged = structuredClone(accepted); forged.fieldReviewApplications![0].proposal.author = 'Blair Different';
  expect(actionPackageSchema.safeParse(forged).success).toBe(true);
  await expect(validatePackageFieldReviewApplications(forged)).rejects.toThrow(/proposal|review|decision/i);
});
