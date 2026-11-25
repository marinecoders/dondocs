import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fixtureInstance, fixturePage } from '../_helpers/formFixture';
import { PDFDocument } from 'pdf-lib';
import { createActionPackage, getPackageRevision, listActionPackages, packageAssets, reviseActionPackage, type ActionPackage } from '@/lib/actionPackages';
import { capturePackageMember, captureOriginalPackageMember, readPackageAsset } from '@/lib/actionPackageAssets';
import { createBlankSession } from '@/stores/documentStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { buildPortableActionPackage, importPortableActionPackage, parsePortableActionPackage } from '@/lib/actionPackageTransfer';
import { capturePackageBackup, packageRecoveryRecord } from '@/lib/actionPackageBackup';
import { startPackageReview } from '@/lib/packageReviewRounds';
import { buildPackageReviewerCopy, packageReviewTransferFile, parsePackageReviewTransfer } from '@/lib/packageReviewTransfer';
import { preparePackageAssembly, assemblePackage } from '@/lib/actionPackageAssembly';
import { packageInputFingerprint } from '@/lib/packageRenderProvenance';
import { materializePackageRequirements, packageRequirementsSchema, inspectPackageRequirements, updatePackageRequirements, type PackageRequirement, type PackageRequirements } from '@/lib/packageRequirements';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { idbDeleteAttachment, idbGetAttachment, idbPutAttachment } from '@/lib/documentsDb';
const { currentPolicy } = vi.hoisted(() => ({ currentPolicy: { value: undefined as unknown } }));
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: async () => currentPolicy.value, getExportDeploymentPolicySync: () => currentPolicy.value }));
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
beforeEach(() => { currentPolicy.value = policy; });
afterEach(() => { vi.restoreAllMocks(); });
const slot = (patch: Partial<Extract<PackageRequirement, { kind: 'document' }>> = {}): Extract<PackageRequirement, { kind: 'document' }> => ({ id: 'evidence-slot', definitionId: 'evidence', label: 'Supporting evidence', kind: 'document', operations: ['pdf'], condition: 'active', ...patch });
const confirmation = (patch: Partial<Extract<PackageRequirement, { kind: 'confirmation' }>> = {}): Extract<PackageRequirement, { kind: 'confirmation' }> => ({ id: 'declaration-slot', label: 'I checked the source', kind: 'confirmation', operations: ['review'], condition: 'active', ...patch });
const requirements = (...items: PackageRequirement[]): PackageRequirements => ({ version: 1, items });
async function fixture() {
  const session = createBlankSession(); session.formData.subject = 'SYNTHETIC REQUIREMENT EVIDENCE';
  session.paragraphs = [{ id: 'requirement-body', text: 'Synthetic supporting content.', level: 0 }];
  const native = await capturePackageMember(captureDocumentRevision({ documentId: 'requirements-source', epoch: 0, editSequence: 1, capturedAt: 100 }, { ...session, endItems: [], publicationTables: {} }), 'Synthetic native letter', 'basic-letter');
  const pdf = await PDFDocument.create(); pdf.addPage([612, 792]);
  const original = await captureOriginalPackageMember({ name: 'synthetic-evidence.pdf', data: new Uint8Array(await pdf.save()).buffer }, 'enclosure', false);
  return reviseActionPackage(await createActionPackage(`Requirement test ${crypto.randomUUID()}`), [native, original]);
}
async function attach(record: ActionPackage, value: PackageRequirements) { return updatePackageRequirements(record, value, policy); }

it('models missing evidence as bounded metadata and rejects fake satisfied flags, cross-kind fields and duplicate slot identities', () => {
  const value = packageRequirementsSchema.parse(requirements(slot(), confirmation({ confirmed: false })));
  expect(value.items[0]).not.toHaveProperty('memberId'); expect(value.items[1]).toHaveProperty('confirmed', false);
  for (const invalid of [requirements({ ...slot(), satisfied: true } as PackageRequirement), requirements({ ...slot(), confirmed: true } as PackageRequirement),
    requirements({ ...confirmation(), memberId: 'fake' } as PackageRequirement), requirements(slot(), slot()), requirements(slot(), slot({ id: 'duplicate-definition' })),
    requirements(slot({ operations: ['pdf', 'pdf'] }))]) expect(packageRequirementsSchema.safeParse(invalid).success).toBe(false);
});
it('materializes exact stable identities, preserves false/assignment while conditions change and drops status on changed ownership', () => {
  const previous = requirements(slot({ memberId: 'captured-member', participantId: 'person-a' }), confirmation({ confirmed: false }));
  const proposed = requirements(slot({ participantId: 'person-a', condition: 'unknown', operations: ['portable'] }), confirmation({ confirmed: true, condition: 'inactive' }));
  expect(materializePackageRequirements(proposed, previous).items).toEqual([{ ...proposed.items[0], memberId: 'captured-member' }, { ...proposed.items[1], confirmed: false }]);
  expect(materializePackageRequirements(requirements(slot({ participantId: 'person-b' })), previous).items[0]).not.toHaveProperty('memberId');
});
it('separates operation requirements and never passes unknown, missing people, absent members or a false declaration', async () => {
  const record = await fixture(), revision = getPackageRevision(record);
  revision.requirements = requirements(slot(), confirmation({ confirmed: false }), slot({ id: 'unknown-condition', definitionId: 'unknown', condition: 'unknown', operations: ['portable'] }));
  expect((await inspectPackageRequirements(revision, 'pdf')).ready).toBe(false);
  expect((await inspectPackageRequirements(revision, 'review')).items.find(item => item.id === 'declaration-slot')?.state).toBe('missing');
  expect((await inspectPackageRequirements(revision, 'portable')).items.find(item => item.id === 'unknown-condition')?.state).toBe('unknown');
  revision.requirements = requirements(slot({ memberId: revision.members[0].id, participantId: 'missing-person' }));
  expect((await inspectPackageRequirements(revision, 'pdf')).items[0].state).toBe('unknown');
  revision.requirements = requirements(slot({ memberId: 'deleted-document' }));
  expect((await inspectPackageRequirements(revision, 'pdf')).items[0].state).toBe('missing');
  revision.requirements = requirements(slot({ condition: 'inactive' })); expect((await inspectPackageRequirements(revision, 'pdf')).ready).toBe(true);
  await expect(inspectPackageRequirements(revision, 'unsupported' as 'pdf')).rejects.toThrow();
});
it('derives evidence only from intact native drafts and actual readable PDFs, including missing and corrupt byte checks', async () => {
  const record = await fixture(), revision = getPackageRevision(record);
  for (const member of revision.members) {
    revision.requirements = requirements(slot({ memberId: member.id }));
    expect((await inspectPackageRequirements(revision, 'pdf')).items[0].state).toBe('satisfied');
    expect((await inspectPackageRequirements(revision, 'pdf', { readAsset: async () => new Uint8Array([1, 2, 3]).buffer })).items[0].state).toBe('invalid');
  }
  const original = revision.members[1]; if (original.kind !== 'original') throw new Error('Expected original');
  const stored = await idbGetAttachment(original.original.id); if (!stored) throw new Error('Missing fixture attachment');
  await idbDeleteAttachment(original.original.id);
  revision.requirements = requirements(slot({ memberId: original.id }));
  expect((await inspectPackageRequirements(revision, 'pdf')).items[0].state).toBe('invalid');
  await idbPutAttachment(stored);
  await idbPutAttachment({ ...stored, data: new Uint8Array([1, 2, 3]).buffer });
  expect((await inspectPackageRequirements(revision, 'pdf')).items[0].state).toBe('invalid');
  await idbPutAttachment(stored);
});
it('saves incomplete slots without creating placeholder members and captures assignments/confirmations as new revisions with CAS', async () => {
  const initial = await fixture(), missing = await attach(initial, requirements(slot(), confirmation()));
  expect(getPackageRevision(missing).members).toHaveLength(2);
  const changed = requirements(slot({ memberId: getPackageRevision(missing).members[1].id }), confirmation({ confirmed: true }));
  const applied = await updatePackageRequirements(missing, changed, policy);
  expect(applied.revisions).toHaveLength(initial.revisions.length + 2);
  expect(getPackageRevision(missing).requirements?.items[0]).not.toHaveProperty('memberId');
  expect((await inspectPackageRequirements(getPackageRevision(applied), 'pdf')).ready).toBe(true);
  expect((await inspectPackageRequirements(getPackageRevision(applied), 'review')).items[1].message).toContain('not an approval');
  await expect(updatePackageRequirements(missing, changed, policy)).rejects.toThrow();
  await expect(updatePackageRequirements(applied, requirements(slot({ condition: 'inactive' }), confirmation()), policy)).rejects.toThrow('Only evidence assignments');
  await expect(updatePackageRequirements(applied, undefined, policy)).rejects.toThrow('Only evidence assignments');
});
it('rejects unavailable assignment, policy drift, stale ownership and reviewer/archived mutations without publishing', async () => {
  const initial = await attach(await fixture(), requirements(slot()));
  await expect(updatePackageRequirements(initial, requirements(slot({ memberId: 'unavailable' })), policy)).rejects.toThrow('Choose a captured');
  const next = requirements(slot({ memberId: getPackageRevision(initial).members[0].id }));
  currentPolicy.value = { status: 'error', message: 'Policy changed' };
  await expect(updatePackageRequirements(initial, next, policy)).rejects.toThrow('Deployment settings changed');
  currentPolicy.value = policy;
  await expect(updatePackageRequirements(initial, next, policy, undefined, () => false)).rejects.toThrow();
  await expect(updatePackageRequirements({ ...initial, archived: true }, next, policy)).rejects.toThrow('unarchived');
  expect((await listActionPackages()).find(record => record.id === initial.id)?.currentRevisionId).toBe(initial.currentRevisionId);
});
it('keeps PDF-only missing slots portable, blocks portable-specific criteria in the direct builder and preserves incomplete slots in backups', async () => {
  const record = await attach(await fixture(), requirements(slot()));
  const json = await buildPortableActionPackage(record), parsed = await parsePortableActionPackage(json);
  expect(getPackageRevision(parsed.record).requirements).toEqual(requirements(slot()));
  expect((await inspectPackageRequirements(getPackageRevision(parsed.record), 'pdf')).ready).toBe(false);
  expect(packageRecoveryRecord(record).revisions.at(-1)?.requirements).toEqual(requirements(slot()));
  expect((await capturePackageBackup()).find(value => value.id === record.id)?.revisions.at(-1)?.requirements).toEqual(requirements(slot()));
  const portableMissing = await attach(await fixture(), requirements(slot({ operations: ['portable'] })));
  await expect(buildPortableActionPackage(portableMissing)).rejects.toThrow('Supporting evidence');
  expect((await capturePackageBackup()).find(value => value.id === portableMissing.id)?.revisions.at(-1)?.requirements).toEqual(requirements(slot({ operations: ['portable'] })));
});
it('authenticates fresh-reader resources once and retains requirement assignments across editable import', async () => {
  const source = await fixture(), record = await attach(source, requirements(slot({ memberId: getPackageRevision(source).members[1].id, operations: ['portable'] })));
  const captured = new Map(await Promise.all(packageAssets(record).map(async asset => [asset.id, await readPackageAsset(asset)] as const)));
  const read = vi.fn(async (asset: Parameters<typeof readPackageAsset>[0]) => captured.get(asset.id)!.slice(0));
  const json = await buildPortableActionPackage(record, record.currentRevisionId, read);
  expect(read).toHaveBeenCalledTimes(new Set(packageAssets({ ...record, revisions: [getPackageRevision(record)] })).size);
  for (const asset of packageAssets({ ...record, revisions: [getPackageRevision(record)] })) await idbDeleteAttachment(asset.id);
  const firstMember = getPackageRevision(record).members[0];
  expect(await idbGetAttachment(firstMember.kind === 'native' ? firstMember.draft.id : '')).toBeNull();
  const parsed = await parsePortableActionPackage(json);
  expect((await inspectPackageRequirements(getPackageRevision(parsed.record), 'portable', { readAsset: async asset => parsed.resources.get(`assets/${asset.id}`)!.data })).ready).toBe(true);
  const imported = await importPortableActionPackage(json); expect(getPackageRevision(imported).requirements).toEqual(getPackageRevision(record).requirements);
});
it('enforces review-only requirements before creating a round, preserves its exact metadata and returns reviewer files with it', async () => {
  const initial = await attach(await fixture(), requirements(confirmation()));
  await expect(startPackageReview(initial)).rejects.toThrow('confirmation');
  const confirmed = await updatePackageRequirements(initial, requirements(confirmation({ confirmed: true })), policy);
  const reviewed = await startPackageReview(confirmed), round = reviewed.reviewRounds![0];
  expect(round.baseline.requirements).toEqual(getPackageRevision(confirmed).requirements);
  const copy = await buildPackageReviewerCopy(reviewed, round.id, policy);
  const parsed = await parsePackageReviewTransfer(await packageReviewTransferFile(copy, policy));
  expect(parsed.round.baseline.requirements).toEqual(round.baseline.requirements);
  await expect(updatePackageRequirements(parsed.record, requirements(confirmation({ confirmed: false })), policy)).rejects.toThrow('owning package');
  const changed = await updatePackageRequirements(reviewed, requirements(confirmation({ confirmed: false })), policy);
  expect(changed.reviewRounds![0].baseline.requirements).toEqual(round.baseline.requirements);
});
it('permits incomplete editable preparation but blocks PDF assembly and refuses reusing a portable preparation as PDF authority', async () => {
  const empty = await attach(await createActionPackage(`Empty incomplete ${crypto.randomUUID()}`), requirements(slot()));
  const portable = await preparePackageAssembly(empty, empty.currentRevisionId, policy, { includeRetainedDraftText: true });
  expect(portable.purpose).toBe('portable'); expect(portable.readiness.state).toBe('ready');
  expect(portable.readiness.findings.some(finding => finding.severity === 'error')).toBe(false);
  const pdf = await preparePackageAssembly(empty, empty.currentRevisionId, policy);
  expect(['draft', 'incomplete']).toContain(pdf.readiness.state);
  await expect(assemblePackage(portable, { compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true })).rejects.toThrow('PDF assembly');
  await expect(buildPortableActionPackage(empty)).resolves.toContain('Supporting evidence');
});
it('preserves requirements during member revisions and includes their exact declaration in render fingerprints', async () => {
  const initial = await attach(await fixture(), requirements(slot()));
  const revision = getPackageRevision(initial), revised = await reviseActionPackage(initial, revision.members);
  expect(getPackageRevision(revised).requirements).toEqual(revision.requirements);
  const before = await packageInputFingerprint(revision), changed = structuredClone(revision); changed.requirements!.items[0].condition = 'unknown';
  expect(await packageInputFingerprint(changed)).not.toBe(before);
});


it('owns requirement declarations before asynchronous portable reads, preventing caller changes from bypassing a missing slot', async () => {
  const record = await attach(await fixture(), requirements(slot({ operations: ['portable'] })));
  let first = true;
  const read = async (asset: Parameters<typeof readPackageAsset>[0]) => {
    if (first) { first = false; record.revisions.find(revision => revision.id === record.currentRevisionId)!.requirements!.items[0].condition = 'inactive'; }
    return readPackageAsset(asset);
  };
  await expect(buildPortableActionPackage(record, record.currentRevisionId, read)).rejects.toThrow('Supporting evidence');
});


it('checks shared captured evidence once even when many distinct requirements use the same member', async () => {
  const record = await fixture(), revision = getPackageRevision(record), original = revision.members[1];
  revision.requirements = requirements(...Array.from({ length: 500 }, (_, index) => slot({ id: `slot-${index}`, definitionId: undefined, memberId: original.id })));
  const read = vi.fn(readPackageAsset);
  expect((await inspectPackageRequirements(revision, 'pdf', { readAsset: read })).ready).toBe(true);
  expect(read).toHaveBeenCalledTimes(1);
});

it('reviews each raw requirement label before publishing a declaration under a stricter deployment policy', async () => {
  const initial = await fixture();
  await expect(updatePackageRequirements(initial, requirements(confirmation({ label: '(S) SYNTHETIC RESTRICTED REQUIREMENT' })), policy)).rejects.toThrow('configured levels');
  expect((await listActionPackages()).find(record => record.id === initial.id)).toEqual(initial);
});

it('allows a marked draft of a blank evidence form without creating a final output', async () => {
  const { renderPackageDraft } = await import('@/lib/actionPackageAssembly');
  const prior = await fixture();
  const original = getPackageRevision(prior).members[1];
  if (original.kind !== 'original') throw new Error('Expected original');
  const record = await reviseActionPackage(await createActionPackage('Blank evidence'), [{ ...original, role: 'basic-letter' }]);
  const action = await attach(record, requirements(slot({ memberId: original.id,
    completion: { blankSha256: original.original.sha256, signatureFields: ['Acknowledgement'] } })));
  const inspect = (draftPdf: boolean) => preparePackageAssembly(action, action.currentRevisionId, policy,
    { draftPdf, reviewOriginal: async () => ({ notices: [], sensitiveFields: [] }) as never });
  const final = await inspect(false);
  expect(final.readiness.state).toBe('incomplete');
  expect(final.readiness.findings.some(item => item.message.includes('Acknowledgement'))).toBe(true);
  const draft = await inspect(true);
  const ports = { compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true };
  await expect(assemblePackage(draft, ports)).rejects.toThrow('final PDF');
  const bytes = await renderPackageDraft(draft, ports, new AbortController().signal);
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  expect(getPackageRevision((await listActionPackages(action.id))[0]).outputs).toHaveLength(0);
});

it('prints a draft of a configured form with a missing required answer and blocks final assembly', async () => {
  const { renderPackageDraft } = await import('@/lib/actionPackageAssembly');
  const template = await fixturePage();
  const instance = fixtureInstance();
  instance.definition.pages[0].sha256 = template.sha256;
  delete instance.answers.name;
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(new Uint8Array(template.bytes)));
  const session = { ...createBlankSession(), documentCategory: 'forms' as const, formType: instance.definition.formId, genericForm: instance };
  const captured = captureDocumentRevision({ documentId: 'partial-form', epoch: 0, editSequence: 1, capturedAt: 1 },
    { ...session, endItems: [], publicationTables: {} });
  const member = await capturePackageMember(captured, 'Partial form', 'basic-letter');
  fetch.mockRestore();
  const record = await reviseActionPackage(await createActionPackage('Draft package'), [member]);
  const final = await preparePackageAssembly(record, record.currentRevisionId, policy);
  expect(final.readiness.state).toBe('incomplete');
  const draft = await preparePackageAssembly(record, record.currentRevisionId, policy, { draftPdf: true });
  const ports = { compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true };
  const bytes = await renderPackageDraft(draft, ports, new AbortController().signal);
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  await expect(assemblePackage(draft, ports)).rejects.toThrow('final PDF');
});

it('rejects a different PDF even if the uploader labels it as the signed official edition', async () => {
  const revision = getPackageRevision(await fixture());
  const original = revision.members[1];
  if (original.kind !== 'original') throw new Error('Expected original');
  original.officialFormId = 'package_correspondence';
  original.signedOriginal = true;
  revision.requirements = requirements(slot({ memberId: original.id, completion: {
    expectedForm: { id: 'package_correspondence', edition: '1' }, signatureFields: ['Signing_authority'],
  } }));
  const result = await inspectPackageRequirements(revision, 'pdf');
  expect(result.ready).toBe(false);
  expect(result.items[0].message).toMatch(/Signing authority/);
  expect(result.items[0].message).toMatch(/maintained form and edition/);
  expect((await inspectPackageRequirements(revision, 'portable')).ready).toBe(true);
});

it('tracks manual scan review by exact PDF bytes independently of certificate trust', async () => {
  const revision = getPackageRevision(await fixture());
  const original = revision.members[1];
  if (original.kind !== 'original') throw new Error('Expected original');
  revision.requirements = requirements(slot({ memberId: original.id, completion: { reviewedScan: true } }));
  expect((await inspectPackageRequirements(revision, 'pdf')).ready).toBe(false);
  original.signatureReviewSha256 = original.original.sha256;
  const checked = await inspectPackageRequirements(revision, 'pdf');
  expect(checked.ready).toBe(true);
  expect(checked.items[0].message).toContain('reviewed manually');
  original.signatureReviewSha256 = '0'.repeat(64);
  expect((await inspectPackageRequirements(revision, 'pdf')).ready).toBe(false);
});

it('assigns an older exact PDF to a manual evidence slot across portable transfer without replacing the current member', async () => {
  const first = await fixture(), revision = getPackageRevision(first), original = revision.members[1];
  if (original.kind !== 'original') throw new Error('Expected an original');
  const other = await PDFDocument.create(); other.addPage([300, 300]);
  const replacement = await captureOriginalPackageMember({ name: 'revised.pdf', data: new Uint8Array(await other.save()).buffer }, 'enclosure', false);
  const changed = await reviseActionPackage(first, [revision.members[0], { ...replacement, id: original.id }]);
  const assigned = await attach(changed, requirements(slot({ memberId: original.id, memberRevisionId: original.revisionId })));
  const transferred = await parsePortableActionPackage(await buildPortableActionPackage(assigned));
  const saved = getPackageRevision(transferred.record);
  expect(saved.members[1]).toMatchObject({ id: original.id, revisionId: replacement.revisionId });
  expect(saved.members[2]).toMatchObject({ kind: 'original', original: original.original });
  expect(saved.requirements!.items[0]).toMatchObject({ memberId: saved.members[2].id, memberRevisionId: saved.members[2].revisionId });
  expect((await inspectPackageRequirements(saved, 'pdf')).ready).toBe(true);
  saved.members[2] = { ...replacement, id: saved.members[2].id };
  expect((await inspectPackageRequirements(saved, 'pdf')).ready).toBe(false);
});
