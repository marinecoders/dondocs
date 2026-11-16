import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createBlankSession } from '@/stores/documentStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { capturePackageMember, captureOriginalPackageMember, readPackageAsset, readPackageMemberDraft, retainPackageAsset } from '@/lib/actionPackageAssets';
import { createActionPackage, listActionPackages, reviseActionPackage, packageAssets, validPackageTransition, packageNativeReviewRoundSchema } from '@/lib/actionPackages';
import { startPackageReview, transitionPackageReview, openPackageReview } from '@/lib/packageReviewRounds';
import { createPackageMemberReview, preparePackageReviewMember, savePackageMemberReview } from '@/lib/packageMemberReviews';
import { createReviewSuggestion, appendReviewSuggestions } from '@/lib/reviewSuggestions';
import { mutateReviewComments } from '@/lib/reviewCommentActions';
import { buildPackageReviewerCopy, buildPackageReviewReturn, packageReviewTransferFile, preparePackageReviewerImport, importPackageReviewerCopy,
  parsePackageReviewTransfer, parsePackageReviewReturn, type PackageReviewReturn, type PreparedPackageReviewTransfer } from '@/lib/packageReviewTransfer';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { idbGetAllAttachments, idbGetAttachment, idbCompareActionPackage, sameReviewStoredValue } from '@/lib/documentsDb';
import { buildBackup, restoreBackup } from '@/lib/backup';
import { collectLiveAttachmentIds } from '@/lib/attachmentGc';
import { useDocumentsStore } from '@/stores/documentsStore';
import type { PortableResourceEntry } from '@/lib/portableResources';
import { persistAttachment } from '@/lib/attachments';
import { reviewRoundSchema } from '@/lib/reviewRounds';
import sharp from 'sharp';
import { buildPortableActionPackage } from '@/lib/actionPackageTransfer';
import { reviewPackageNative } from '@/lib/actionPackageDisclosure';
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: async () => 'Synthetic retained PDF' }));
type Envelope = PackageReviewReturn & { portableResources: { entries: PortableResourceEntry[] } };
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
async function clear() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await new Promise<void>((resolve, reject) => { const tx = db.transaction([...db.objectStoreNames], 'readwrite'); for (const name of db.objectStoreNames) tx.objectStore(name).clear(); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
}
async function fixture() {
  const session = createBlankSession(); session.timestamp = 123;
  session.formData.subject = 'SYNTHETIC PACKAGE';
  session.paragraphs = [{ id: 'synthetic-paragraph', text: 'Captured package text.', level: 0 }];
  const native = await capturePackageMember(captureDocumentRevision({ documentId: 'synthetic-source', capturedAt: 123, editSequence: 1, epoch: 0 }, { ...session, endItems: [], publicationTables: {} }), 'Synthetic native', 'basic-letter');
  const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = new Uint8Array(await pdf.save()).buffer;
  const original = await captureOriginalPackageMember({ name: 'synthetic-signed.pdf', data: bytes }, 'enclosure', true);
  if (original.kind !== 'original') throw new Error('Expected an original PDF fixture.');
  const owner = await startPackageReview(await reviseActionPackage(await createActionPackage('Synthetic package'), [native, original]));
  return { owner, native, original, bytes, round: owner.reviewRounds![0] };
}
beforeEach(async () => { vi.restoreAllMocks(); await createActionPackage('Initialize'); await clear(); useDocumentsStore.setState({ docs: {}, currentId: null, hydrated: true, baseline: null }); });
it('refuses an over-complex reviewer copy without changing the captured package or resources', async () => {
  const session = createBlankSession(); session.timestamp = 123;
  session.paragraphs = Array.from({ length: 9000 }, (_, index) => ({ id: `large-paragraph-${index}`, level: 0, text: 'Synthetic paragraph.' }));
  const native = await capturePackageMember(captureDocumentRevision({ documentId: 'large-source', capturedAt: 123, editSequence: 1, epoch: 0 }, { ...session, endItems: [], publicationTables: {} }), 'Synthetic large member', 'basic-letter');
  const owner = await startPackageReview(await reviseActionPackage(await createActionPackage('Synthetic large review'), [native]));
  const assets = await idbGetAllAttachments();
  await expect(buildPackageReviewerCopy(owner, owner.reviewRounds![0].id, policy)).rejects.toThrow('too complex');
  expect((await listActionPackages()).find(value => value.id === owner.id)).toEqual(owner);
  expect(await idbGetAllAttachments()).toEqual(assets);
});
it.each([buildPackageReviewerCopy, buildPackageReviewReturn])('blocks markings in retained native draft values omitted from the parsed session (%#)', async build => {
  const { native } = await fixture();
  const { draft } = await readPackageMemberDraft(native);
  Object.assign(draft as object, { legacyRetainedText: '(S) Synthetic retained draft note' });
  const data = new TextEncoder().encode(JSON.stringify(draft)).buffer;
  const asset = await retainPackageAsset(native.draft.name, native.draft.type, data);
  const owner = await startPackageReview(await reviseActionPackage(await createActionPackage('Synthetic retained draft review'), [{ ...native, draft: asset }]));
  const attachments = await idbGetAllAttachments();
  await expect(build(owner, owner.reviewRounds![0].id, policy)).rejects.toThrow(/markings|levels/);
  expect((await listActionPackages()).find(value => value.id === owner.id)).toEqual(owner);
  expect(await idbGetAllAttachments()).toEqual(attachments);
});
it('exposes allowed higher markings in retained transfer text without changing the native draft marking', async () => {
  const { native } = await fixture();
  const { draft } = await readPackageMemberDraft(native);
  Object.assign(draft as object, { legacyRetainedText: '(S) Synthetic allowed retained note' });
  const permitted = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'secret', allowedLevels: ['unclassified', 'secret'] }, runtime: { status: 'absent' } });
  const before = structuredClone({ session: native.session, draft });
  const review = reviewPackageNative(native.session, native.label, permitted, draft as typeof native.session);
  expect(review.markingReview).toBe(true);
  expect(review.notices.some(notice => notice.includes('Retained transfer text marking: SECRET'))).toBe(true);
  expect({ session: native.session, draft }).toEqual(before);
});
it('discloses retained native draft privacy findings for downloads and imports without rewriting bytes', async () => {
  const { native } = await fixture();
  const { draft } = await readPackageMemberDraft(native);
  const email = 'synthetic-reviewer@example.test';
  Object.assign(draft as object, { legacyRetainedText: `Contact ${email}` });
  const data = new TextEncoder().encode(JSON.stringify(draft)).buffer;
  const asset = await retainPackageAsset(native.draft.name, native.draft.type, data);
  const owner = await startPackageReview(await reviseActionPackage(await createActionPackage('Synthetic retained privacy review'), [{ ...native, draft: asset }]));
  const prepared = await buildPackageReviewerCopy(owner, owner.reviewRounds![0].id, policy);
  const findings = (value: PreparedPackageReviewTransfer) => value.reviews.flatMap(review => review.privacy.findings);
  expect(findings(prepared).some(finding => finding.value === email)).toBe(true);
  const json = await packageReviewTransferFile(prepared, policy);
  const parsed = await parsePackageReviewTransfer(json);
  expect(parsed.resources.get(`assets/${asset.id}`)!.data).toEqual(data);
  expect((await listActionPackages()).find(value => value.id === owner.id)).toEqual(owner);
  await clear();
  const imported = await preparePackageReviewerImport(json, policy);
  expect(findings(imported).some(finding => finding.value === email)).toBe(true);
  expect(await listActionPackages()).toEqual([]);
  expect(await idbGetAllAttachments()).toEqual([]);
});
it('persists exact detached native and original child reviews, native proposals, comments, reload, backup and GC without library writes', async () => {
  const { owner, round, native, original, bytes } = await fixture();
  const initial = await preparePackageReviewMember(owner, round.id, native.id); const child = initial.child;
  expect(child.nativeRound!.ownerDocumentId).toBeUndefined(); expect(child.nativeRound!.baseline.session).toEqual(native.session);
  expect(child.nativeRound!.createdAt).toBe(native.session.timestamp);
  expect(await createPackageMemberReview(round, native.id)).toEqual(child);
  const comments = mutateReviewComments(child.comments, { kind: 'add', author: 'Synthetic reviewer', text: 'Review question' }, () => ({ kind: 'document' }))!;
  const suggestion = createReviewSuggestion(child.nativeRound!, { author: 'Synthetic reviewer', label: 'Change paragraph', changes: [{ target: { kind: 'paragraph', paragraphId: 'synthetic-paragraph', docType: native.session.docType }, proposed: 'Proposed package text.' }] });
  const saved = await savePackageMemberReview(initial.record, round.id, { ...child, comments, suggestions: appendReviewSuggestions(child.nativeRound!, child.suggestions!, [suggestion]) });
  const originalPrepared = await preparePackageReviewMember(saved, round.id, original.id);
  const originalSaved = await savePackageMemberReview(originalPrepared.record, round.id, { ...originalPrepared.child, comments });
  const loaded = (await listActionPackages())[0]; expect(loaded).toEqual(originalSaved);
  expect((await openPackageReview(loaded, round.id)).memberReviews).toHaveLength(2);
  expect(await readPackageAsset(original.original)).toEqual(bytes);
  const roots = await collectLiveAttachmentIds(); for (const asset of packageAssets(loaded)) expect(roots?.has(asset.id)).toBe(true);
  const backup = await buildBackup(); await clear(); await restoreBackup(backup);
  const restored = (await listActionPackages())[0];
  expect(sameReviewStoredValue(restored.reviewRounds, loaded.reviewRounds)).toBe(true);
  expect(restored.revisions.every(revision => revision.members.every(member => member.kind !== "native" || !member.source?.local))).toBe(true);
  expect(useDocumentsStore.getState().docs).toEqual({});
  const clean = JSON.parse(await buildPortableActionPackage(loaded)); expect(clean.package.reviewRounds).toBeUndefined();
});
it('round trips an ownerless exact reviewer copy in a separate inventory and returns bound comments/proposals without source authority', async () => {
  const { owner, round, native } = await fixture();
  const prepared = await buildPackageReviewerCopy(owner, round.id, policy); const json = await packageReviewTransferFile(prepared, policy);
  const ownerCopy = await parsePackageReviewTransfer(json);
  expect(ownerCopy.round.ownerPackageId).toBeUndefined(); expect(ownerCopy.record.id).toBe(owner.id);
  await expect(preparePackageReviewerImport(json, policy)).rejects.toThrow(/already exists/);
  await clear();
  const imported = await importPackageReviewerCopy(await preparePackageReviewerImport(json, policy), policy);
  const child = imported.reviewRounds![0].memberReviews!.find(child => child.binding.memberId === native.id)!;
  const comments = mutateReviewComments(child.comments, { kind: 'add', author: 'Synthetic reviewer', text: 'Returned question' }, () => ({ kind: 'document' }))!;
  const saved = await savePackageMemberReview(imported, round.id, { ...child, comments });
  expect(saved.reviewRounds![0].ownerPackageId).toBeUndefined(); expect(saved.revisions).toEqual(imported.revisions);
  const returned = await packageReviewTransferFile(await buildPackageReviewReturn(saved, round.id, policy), policy);
  const parsed = await parsePackageReviewReturn(returned, owner, round.id);
  expect(parsed.memberReviews.find(child => child.binding.memberId === native.id)!.comments).toEqual(comments);
  expect(parsed.round.memberReviews![0].nativeRound!.id).toBe((await createPackageMemberReview(round, native.id)).nativeRound!.id);
  expect(useDocumentsStore.getState().docs).toEqual({});
});
it('rejects wrong owner/round/digests/child authority and portable author decisions without writing', async () => {
  const { owner, round } = await fixture();
  const json = await packageReviewTransferFile(await buildPackageReviewReturn(owner, round.id, policy), policy);
  for (const change of [
    (value: Envelope) => { value.package.reviewRounds![0].ownerPackageId = owner.id; },
    (value: Envelope) => { value.package.id = 'foreign-package'; },
    (value: Envelope) => { value.package.reviewRounds![0].baselineDigest = 'f'.repeat(64); },
    (value: Envelope) => { value.package.reviewRounds![0].memberReviews![0].binding.assetDigest = 'f'.repeat(64); },
    (value: Envelope) => { Object.assign(value.package.reviewRounds![0].memberReviews![0].nativeRound!, { ownerDocumentId: 'source' }); },
    (value: Envelope) => { Object.assign(value.package.reviewRounds![0].memberReviews![0].nativeRound!, { checkpoints: [] }); },
    (value: Envelope) => { value.package.reviewRounds![0].memberReviews![0].nativeRound!.baselineDigest = 'f'.repeat(64); },
    (value: Envelope) => { value.package.reviewRounds![0].memberReviews![0].nativeRound!.createdAt++; },
    (value: Envelope) => { value.package.reviewRounds![0].memberReviews![0].nativeRound!.id = `review_${crypto.randomUUID()}`; },
    (value: Envelope) => { value.package.reviewRounds![0].memberReviews!.push(value.package.reviewRounds![0].memberReviews![0]); },
    (value: Envelope) => { value.package.reviewRounds![0].memberReviews![0].suggestions!.decisions.push({} as never); },
    (value: Envelope) => { value.portableResources.entries.push(value.portableResources.entries[0]); },
    (value: Envelope) => { value.portableResources.entries[0].data = 'AAAA'; },
  ]) { const value = JSON.parse(json); change(value); await expect(parsePackageReviewReturn(JSON.stringify(value), owner, round.id)).rejects.toThrow(); }
  await expect(parsePackageReviewReturn(json, { ...owner, id: 'foreign-owner' }, round.id)).rejects.toThrow();
  await expect(parsePackageReviewReturn(json, owner, 'foreign-round')).rejects.toThrow();
  expect((await listActionPackages())[0]).toEqual(owner);
});
it('rejects stale and closed parent writes, owner promotion and immutable child rewrite', async () => {
  const { owner, round, native } = await fixture(); const prepared = await preparePackageReviewMember(owner, round.id, native.id);
  await expect(savePackageMemberReview(owner, round.id, prepared.child)).rejects.toThrow(/changed|saved/);
  const bad = structuredClone(prepared.record); bad.sequence++; bad.reviewRounds![0].memberReviews![0].nativeRound!.id = `review_${crypto.randomUUID()}`;
  expect(await idbCompareActionPackage(prepared.record, bad)).toBe(false);
  const closed = await transitionPackageReview(prepared.record, round.id, 'close');
  await expect(savePackageMemberReview(closed, round.id, prepared.child)).rejects.toThrow(/closed/);
  const copy = await parsePackageReviewTransfer(await packageReviewTransferFile(await buildPackageReviewerCopy(await transitionPackageReview(closed, round.id, 'reopen'), round.id, policy), policy));
  const promoted = structuredClone(copy.record); promoted.sequence++; promoted.reviewRounds![0].ownerPackageId = promoted.id;
  expect(validPackageTransition(copy.record, promoted)).toBe(false);
});
it('preserves all stores atomically on cancelled, quota-aborted and invalidated reviewer imports', async () => {
  const { owner, round } = await fixture(); const json = await packageReviewTransferFile(await buildPackageReviewerCopy(owner, round.id, policy), policy);
  await clear();
  const prepared = await preparePackageReviewerImport(json, policy);
  await expect(importPackageReviewerCopy(prepared, policy, AbortSignal.abort())).rejects.toThrow();
  await expect(importPackageReviewerCopy(prepared, policy, undefined, () => false)).rejects.toThrow();
  expect(await listActionPackages()).toEqual([]); expect(await idbGetAllAttachments()).toEqual([]);
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, ...args) { const result = put.apply(this, args); if (this.name === 'app') this.transaction.abort(); return result; });
  await expect(importPackageReviewerCopy(prepared, policy)).rejects.toThrow(/saved/); vi.restoreAllMocks();
  expect(await listActionPackages()).toEqual([]); expect(await idbGetAllAttachments()).toEqual([]);
  let live = true; const get = IDBObjectStore.prototype.get;
  vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function(this: IDBObjectStore, ...args) { const result = get.apply(this, args); if (this.name === 'app') queueMicrotask(() => { live = false; }); return result; });
  await expect(importPackageReviewerCopy(prepared, policy, undefined, () => live)).rejects.toThrow(/changed|saved/); vi.restoreAllMocks();
  expect(await listActionPackages()).toEqual([]); expect(await idbGetAllAttachments()).toEqual([]);
  const imported = await importPackageReviewerCopy(prepared, policy); expect(imported.id).toBe(owner.id);
  for (const asset of packageAssets(imported)) expect(await idbGetAttachment(asset.id)).toBeTruthy();
});
it('blocks retained baseline and returned metadata marking leaks and policy changes, cancellation has no writes', async () => {
  const { owner, round, native } = await fixture();
  const { record, child } = await preparePackageReviewMember(owner, round.id, native.id);
  const comments = mutateReviewComments(child.comments, { kind: 'add', author: 'Synthetic reviewer', text: '(S) Sensitive synthetic return' }, () => ({ kind: 'document' }))!;
  const saved = await savePackageMemberReview(record, round.id, { ...child, comments });
  await expect(buildPackageReviewReturn(saved, round.id, policy)).rejects.toThrow(/markings|levels/);
  expect((await listActionPackages())[0]).toEqual(saved);
});

it.each(['embedded-pdf', 'pdf-figure', 'png-figure'] as const)('reviews exact captured native %s resources without manufacturing local native file handles', async kind => {
  const pdf = await PDFDocument.create(); pdf.addPage();
  const pdfBytes = new Uint8Array(await pdf.save()).buffer;
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer();
  const resource = kind === 'png-figure' ? new Uint8Array(png).buffer : pdfBytes;
  const mediaType = kind === 'png-figure' ? 'image/png' : 'application/pdf';
  const name = kind === 'png-figure' ? 'synthetic-diagram.png' : 'synthetic-content.pdf';
  const fileRef = await persistAttachment({ name, type: mediaType, size: resource.byteLength }, resource);
  const session = createBlankSession(); session.timestamp = 456;
  session.formData.subject = 'SYNTHETIC CAPTURED ATTACHMENTS';
  const snapshot = { ...session, endItems: [], publicationTables: {},
    enclosures: kind === 'embedded-pdf' ? [{ title: 'Synthetic enclosure', file: { name, size: resource.byteLength, data: resource } }] : [],
    paragraphs: [{ id: 'supported-text', level: 0, text: 'Synthetic reviewable paragraph.' },
      ...(kind === 'embedded-pdf' ? [] : [{ id: 'captured-figure', level: 0, text: 'Synthetic captured figure', figure: { fileRef, name, type: mediaType } }])],
  };
  const native = await capturePackageMember(captureDocumentRevision({ documentId: 'synthetic-resource-source', epoch: 0, editSequence: 1, capturedAt: 456 }, snapshot), 'Synthetic resource member', 'basic-letter');
  const captured = (await readPackageMemberDraft(native)).reviewed;
  expect(kind === 'embedded-pdf' ? captured.files[0]?.data : captured.figures[1]?.data).toEqual(resource);
  expect(native.session.enclosures.every(enclosure => !enclosure.fileRef)).toBe(true);
  expect(native.session.paragraphs.every(paragraph => !paragraph.figure?.fileRef)).toBe(true);
  const owner = await startPackageReview(await reviseActionPackage(await createActionPackage('Synthetic resource package'), [native]));
  const round = owner.reviewRounds![0];
  const { record, child } = await preparePackageReviewMember(owner, round.id, native.id);
  expect(child.nativeRound!.baseline).toEqual({ ts: native.session.timestamp, session: native.session });
  expect(child.nativeRound!.ownerDocumentId).toBeUndefined();
  expect(packageNativeReviewRoundSchema.safeParse(child.nativeRound).success).toBe(true);
  // Generic document round acceptance is unchanged; figures still require local handles there.
  expect(reviewRoundSchema.safeParse(child.nativeRound).success).toBe(kind === 'embedded-pdf');
  for (const mutate of [
    (value: NonNullable<typeof child.nativeRound>) => { value.createdAt++; },
    (value: NonNullable<typeof child.nativeRound>) => { value.baseline.ts++; },
    (value: NonNullable<typeof child.nativeRound>) => { value.baseline.session.timestamp++; },
    (value: NonNullable<typeof child.nativeRound>) => { value.baseline.session.formData.basicLetterFileRef = fileRef; },
  ]) {
    const invalid = structuredClone(child.nativeRound!); mutate(invalid);
    expect(packageNativeReviewRoundSchema.safeParse(invalid).success).toBe(false);
  }
  const proposal = createReviewSuggestion(child.nativeRound!, { author: 'Synthetic reviewer', label: 'Review retained paragraph',
    changes: [{ target: { kind: 'paragraph', paragraphId: 'supported-text', docType: native.session.docType }, proposed: 'Proposed retained paragraph.' }] });
  const saved = await savePackageMemberReview(record, round.id, { ...child,
    suggestions: appendReviewSuggestions(child.nativeRound!, child.suggestions!, [proposal]) });
  const copy = await packageReviewTransferFile(await buildPackageReviewerCopy(saved, round.id, policy), policy);
  const parsedCopy = await parsePackageReviewTransfer(copy);
  expect(parsedCopy.memberReviews[0].nativeRound!.baseline).toEqual(child.nativeRound!.baseline);
  await clear();
  const reviewer = await importPackageReviewerCopy(await preparePackageReviewerImport(copy, policy), policy);
  const retainedMember = reviewer.reviewRounds![0].baseline.members[0];
  if (retainedMember.kind !== 'native') throw new Error('Expected retained native resource member.');
  const retained = (await readPackageMemberDraft(retainedMember)).reviewed;
  expect(kind === 'embedded-pdf' ? retained.files[0]?.data : retained.figures[1]?.data).toEqual(resource);
  const returned = await packageReviewTransferFile(await buildPackageReviewReturn(reviewer, round.id, policy), policy);
  const parsed = await parsePackageReviewReturn(returned, owner, round.id);
  expect(parsed.memberReviews[0].nativeRound!.baseline).toEqual(child.nativeRound!.baseline);
  expect(parsed.memberReviews[0].suggestions!.proposals).toEqual([proposal]);
  expect(parsed.payload.portableResources).toEqual(parsedCopy.payload.portableResources);
  expect(useDocumentsStore.getState().docs).toEqual({});
});


it('refuses a changed pending proposal identity before the first application and preserves the saved owner and resources', async () => {
  const { owner: initial, round, native } = await fixture();
  const child = await createPackageMemberReview(round, native.id);
  const proposal = createReviewSuggestion(child.nativeRound!, { author: 'Original reviewer', label: 'Known pending proposal', changes: [{ target: { kind: 'paragraph', paragraphId: 'synthetic-paragraph', docType: native.session.docType }, proposed: 'Original pending wording.' }] });
  const owner = await savePackageMemberReview(initial, round.id, { ...child, suggestions: appendReviewSuggestions(child.nativeRound!, child.suggestions!, [proposal]) });
  const json = await packageReviewTransferFile(await buildPackageReviewReturn(owner, round.id, policy), policy), assets = await idbGetAllAttachments();
  for (const mutate of [
    (value: Envelope) => { value.package.reviewRounds![0].memberReviews![0].suggestions!.proposals[0].changes[0].proposed = 'Different wording under the known identity.'; },
    (value: Envelope) => { value.package.reviewRounds![0].memberReviews![0].suggestions!.proposals[0].author = 'Changed reviewer attribution'; },
    (value: Envelope) => { value.package.reviewRounds![0].memberReviews![0].suggestions!.proposals[0].changes[0].id = crypto.randomUUID(); },
  ]) {
    const value: Envelope = JSON.parse(json); mutate(value);
    await expect(parsePackageReviewReturn(JSON.stringify(value), owner, round.id)).rejects.toThrow(/existing identity/);
  }
  expect((await listActionPackages())[0]).toEqual(owner);
  expect(await idbGetAllAttachments()).toEqual(assets);
});

it('accepts an identical known proposal with independent new feedback without modifying the retained owner', async () => {
  const { owner: initial, round, native } = await fixture();
  const child = await createPackageMemberReview(round, native.id);
  const known = createReviewSuggestion(child.nativeRound!, { author: 'First reviewer', label: 'Known subject proposal', changes: [{ target: { kind: 'field', field: 'subject', docType: native.session.docType }, proposed: 'RETURNED SUBJECT' }] });
  const owner = await savePackageMemberReview(initial, round.id, { ...child, suggestions: appendReviewSuggestions(child.nativeRound!, child.suggestions!, [known]) });
  const json = await packageReviewTransferFile(await buildPackageReviewReturn(owner, round.id, policy), policy), value: Envelope = JSON.parse(json);
  const independent = createReviewSuggestion(child.nativeRound!, { author: 'Independent reviewer', label: 'New paragraph proposal', changes: [{ target: { kind: 'paragraph', paragraphId: 'synthetic-paragraph', docType: native.session.docType }, proposed: 'Independent returned wording.' }] });
  value.package.reviewRounds![0].memberReviews![0].suggestions!.proposals.push(independent);
  const parsed = await parsePackageReviewReturn(JSON.stringify(value), owner, round.id);
  expect(parsed.memberReviews[0].suggestions!.proposals).toEqual([known, independent]);
  expect((await listActionPackages())[0]).toEqual(owner);
  expect(owner.reviewRounds![0].memberReviews![0].suggestions!.proposals).toEqual([known]);
});
