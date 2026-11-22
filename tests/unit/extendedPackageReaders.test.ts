import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useUIStore } from '@/stores/uiStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { capturePackageMember, readPackageMemberDraft } from '@/lib/actionPackageAssets';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage } from '@/lib/actionPackages';
import { buildPortableActionPackage, parsePortableActionPackage } from '@/lib/actionPackageTransfer';
import { buildPortableResources, portableResourceDigest, type PortableResourceManifest } from '@/lib/portableResources';
import { capturePackageTemplate, exportPackageTemplate, importPackageTemplate, validatePackageTemplate } from '@/lib/packageTemplateLibrary';
import { startPackageReview } from '@/lib/packageReviewRounds';
import { buildPackageReviewerCopy, buildPackageReviewReturn, packageReviewTransferFile, parsePackageReviewTransfer } from '@/lib/packageReviewTransfer';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { buildReviewCopy, parseReviewCopy } from '@/lib/reviewRoundActions';
import { parseReviewRound, reviewPayloadDigest } from '@/lib/reviewRounds';
import { validatePackageDraft } from '@/lib/actionPackageDraft';
import { jointLetterFixture } from '../_helpers/jointLetterFixture';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: async () => policy, getExportDeploymentPolicySync: () => policy }));

beforeEach(async () => {
  await listActionPackages();
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([...db.objectStoreNames], 'readwrite');
    for (const name of db.objectStoreNames) transaction.objectStore(name).clear();
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useUIStore.setState({ storageHealth: 'ok' });
});

for (const feature of ['third command', 'title-only', 'preprinted', 'small stationery']) {
  it(`retains the current native reader requirement across package, template and review transfers: ${feature}`, async () => {
    const session = createBlankSession();
    if (feature === 'third command') {
      const joint = jointLetterFixture(); Object.assign(session, joint);
      session.formData = { ...createBlankSession().formData, ...joint.formData };
    } else {
      session.docType = feature === 'small stationery' ? 'executive_correspondence' : 'naval_letter';
      Object.assign(session.formData, { docType: session.docType, letterheadMode: feature === 'title-only' ? 'title-only' : 'preprinted',
        ...(feature === 'small stationery' ? { stationerySize: '5x7' } : {}) });
    }
    Object.assign(session.formData, { subject: 'PORTABLE READER QUALIFICATION', signatureType: 'none', classLevel: 'unclassified' });
    session.paragraphs = [{ id: 'retained-paragraph', text: 'Retain every command and the selected stationery.', level: 0 }];
    const native = await capturePackageMember(captureDocumentRevision({ documentId: 'source', epoch: 0, editSequence: 1, capturedAt: 123 },
      { ...session, endItems: [], publicationTables: {} }), 'Reader-qualified letter', 'basic-letter');
    const { draft } = await readPackageMemberDraft(native);
    const draftVersion = feature === 'third command' ? 6 : 7;
    const readerMessage = new RegExp(`version ${draftVersion}`);
    expect(draft).toMatchObject({ kind: 'dondocs-draft', version: draftVersion });
    await expect(validatePackageDraft({ ...(draft as object), version: 5 })).rejects.toThrow(readerMessage);
    const nativeRound = parseReviewRound({ kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`,
      createdAt: 123, label: 'Native reader qualification', sourceDocumentId: 'source', ownerDocumentId: 'source',
      baselineDigest: await reviewPayloadDigest(draft), baseline: { ts: 123, session: native.session } });
    const reviewCopy = await buildReviewCopy(nativeRound);
    expect(reviewCopy.draft).toMatchObject({ kind: 'dondocs-draft', version: draftVersion });
    expect((await parseReviewCopy(reviewCopy)).reviewed.session).toEqual(native.session);
    await expect(parseReviewCopy({ ...reviewCopy, draft: { ...(reviewCopy.draft as object), version: 5 } }))
      .rejects.toThrow('complete readable native draft');
    const record = await reviseActionPackage(await createActionPackage('Reader qualification'), [native]);
    const packet = JSON.parse(await buildPortableActionPackage(record));
    // The outer package stays compatible: its mandatory native resource is
    // already versioned, validated and matched to the retained session.
    expect(packet.version).toBe(1);
    const parsed = await parsePortableActionPackage(JSON.stringify(packet));
    expect(getPackageRevision(parsed.record).members[0]).toEqual({ ...native, source: native.source && { ...native.source, local: false } });
    const resource = (packet.portableResources as PortableResourceManifest).entries.find(entry => entry.path === `assets/${native.draft.id}`)!;
    const retained = JSON.parse(Buffer.from(resource.data, 'base64').toString());
    expect(retained.version).toBe(draftVersion);
    // Recompute every byte/hash binding so rejection proves reader support,
    // rather than merely detecting a corrupt resource checksum.
    retained.version = 5;
    const downgraded = new TextEncoder().encode(JSON.stringify(retained)).buffer;
    const member = packet.package.revisions[0].members[0];
    member.draft.size = downgraded.byteLength;
    member.draft.sha256 = await portableResourceDigest(downgraded);
    packet.portableResources = await buildPortableResources([{ path: `assets/${member.draft.id}`, name: member.draft.name, mediaType: member.draft.type, data: downgraded }]);
    await expect(parsePortableActionPackage(JSON.stringify(packet))).rejects.toThrow(readerMessage);

    const template = await capturePackageTemplate(record, record.currentRevisionId, 'Reader-qualified starter');
    const exported = JSON.parse(await exportPackageTemplate(template));
    expect(exported.members[0].draft.version).toBe(draftVersion);
    expect((await importPackageTemplate(JSON.stringify(exported))).members).toEqual(template.members);
    exported.members[0].draft.version = 5;
    await expect(validatePackageTemplate(exported)).rejects.toThrow(readerMessage);

    const owner = await startPackageReview(record), round = owner.reviewRounds![0];
    for (const build of [buildPackageReviewerCopy, buildPackageReviewReturn]) {
      const prepared = await build(owner, round.id, policy);
      const feedback = await packageReviewTransferFile(prepared, policy);
      const review = await parsePackageReviewTransfer(feedback);
      const entry = (review.payload.portableResources as PortableResourceManifest).entries.find(entry => entry.path === `assets/${native.draft.id}`)!;
      expect(JSON.parse(Buffer.from(entry.data, 'base64').toString()).version).toBe(draftVersion);
      expect(review.record.revisions[0].members[0].kind).toBe('native');
    }
  });
}
