import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDocumentStore } from '@/stores/documentStore';
import { captureDocumentTarget, flushDocumentWrites, openExistingDocument, useDocumentsStore } from '@/stores/documentsStore';
import { useUIStore } from '@/stores/uiStore';
import { useProfileStore } from '@/stores/profileStore';
import { useUserTemplatesStore } from '@/stores/userTemplatesStore';
import { persistAttachment } from '@/lib/attachments';
import { startReviewRound, buildReviewCopy, parseReviewCopy, openReviewCopy, prepareReviewCopyExport } from '@/lib/reviewRoundActions';
import { listReviewRounds, readReviewRound, readReviewCopyLink, reviewPayloadDigest } from '@/lib/reviewRounds';
import { buildBackup, restoreBackup } from '@/lib/backup';
import { collectLiveAttachmentIds } from '@/lib/attachmentGc';
import * as database from '@/lib/documentsDb';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { base64ToUint8Array } from '@/lib/encoding';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const pdf = new TextEncoder().encode('%PDF-1.4\nFictional attachment bytes');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  useProfileStore.setState({ profiles: {}, selectedProfile: null });
  useUserTemplatesStore.setState({ templates: {} });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useUIStore.setState({ storageHealth: 'ok', saveWarning: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'Fictional review letter');
});
afterEach(async () => { vi.restoreAllMocks();await flushDocumentWrites();vi.clearAllTimers();vi.useRealTimers(); });

async function resources() {
  const enclosure = await persistAttachment({ name: 'support.pdf', size: pdf.byteLength, type: 'application/pdf' }, new Uint8Array(pdf).buffer);
  const imageBytes = base64ToUint8Array(png);
  const figure = await persistAttachment({ name: 'diagram.png', size: imageBytes.byteLength, type: 'image/png' }, new Uint8Array(imageBytes).buffer);
  useDocumentStore.setState(state => ({
    formData: { ...state.formData, unitAddress: '  100 FICTIONAL ROAD\n  TRAINING CITY',
      signatureImage: { name: 'signature.png', size: imageBytes.byteLength, data: png } },
    enclosures: [{ title: 'Supporting document', fileRef: enclosure }],
    paragraphs: [{ id: 'review-target', text: 'Original paragraph.', level: 0, figure: { name: 'diagram.png', type: 'image/png', fileRef: figure } }],
  }));
  return { enclosure, figure };
}

it('pins existing native resources and exports the captured revision after later source edits', async () => {
  const { enclosure, figure } = await resources();
  const round = await startReviewRound('Original reviewer revision');
  useDocumentStore.getState().setField('subject', 'Newer author work');
  useDocumentStore.getState().setField('unitAddress', 'New address');
  const copy = await buildReviewCopy((await readReviewRound(round.id))!);
  const parsed = await parseReviewCopy(copy);
  expect(parsed.reviewed.session.formData.subject).toBe('Fictional review letter');
  expect(parsed.reviewed.session.formData.unitAddress).toBe('  100 FICTIONAL ROAD\n  TRAINING CITY');
  expect(new Uint8Array(parsed.reviewed.files[0]!.data)).toEqual(pdf);
  expect(parsed.reviewed.session.formData.signatureImage?.data).toBe(png);
  expect(parsed.reviewed.figures[0]?.size).toBe(base64ToUint8Array(png).byteLength);
  expect((await collectLiveAttachmentIds())?.has(enclosure.id)).toBe(true);
  expect((await collectLiveAttachmentIds())?.has(figure.id)).toBe(true);
  expect(useDocumentStore.getState().formData.subject).toBe('Newer author work');
  expect(await reviewPayloadDigest(copy.draft)).toBe(round.baselineDigest);
});

it('reuses the saved empty-comment normalization without losing the baseline checksum', async () => {
  useDocumentStore.setState({ reviewComments: { version: 2, threads: [] } });
  const round = await startReviewRound('No remaining discussion');
  expect(round.baseline.session.reviewComments).toBeUndefined();
  const copy = await buildReviewCopy(round);
  expect(await reviewPayloadDigest(copy.draft)).toBe(round.baselineDigest);
  expect((await parseReviewCopy(copy)).reviewed.session.reviewComments).toBeUndefined();
});

it('opens a foreign reviewer copy separately and never derives owner authority from its source ID', async () => {
  await resources();
  const round = await startReviewRound('Foreign source binding');
  const sourceId = useDocumentsStore.getState().currentId!;
  const envelope = await buildReviewCopy(round);
  envelope.round.id = `review_${crypto.randomUUID()}`;
  const reviewed = await parseReviewCopy(envelope);
  useDocumentStore.getState().setField('subject', 'Newer author text remains');
  // UI-visible objects cannot modify the private validated payload after inspection.
  reviewed.reviewed.session.formData.subject = 'Mutation after inspection';
  expect(await openReviewCopy(reviewed, captureDocumentTarget())).toBe('applied');
  const copyId = useDocumentsStore.getState().currentId!;
  expect(copyId).not.toBe(sourceId);
  expect(useDocumentsStore.getState().docs[sourceId].session.formData.subject).toBe('Newer author text remains');
  expect(useDocumentStore.getState().formData.subject).toBe('Fictional review letter');
  expect((await readReviewRound(envelope.round.id))?.ownerDocumentId).toBeUndefined();
  expect((await readReviewCopyLink(copyId))?.roundId).toBe(envelope.round.id);
  await flushDocumentWrites();
  expect(openExistingDocument(sourceId)).toBe('applied');
  expect(openExistingDocument(copyId)).toBe('applied');
  expect(useDocumentStore.getState().formData.unitAddress).toBe('  100 FICTIONAL ROAD\n  TRAINING CITY');
  expect(useDocumentsStore.getState().docs[copyId].meta.nativeReviewText).toBe(true);
});

it('refuses missing resources or failed pin storage without acknowledging a ready review', async () => {
  useDocumentStore.setState({ enclosures: [{ title: 'Missing', fileRef: { id: 'missing-review-file', name: 'missing.pdf', size: 2, type: 'application/pdf' } }] });
  await expect(startReviewRound('Missing resources')).rejects.toThrow(/Could not read/);
  expect((await listReviewRounds()).some(round => round.label === 'Missing resources')).toBe(false);
  useDocumentStore.setState({ enclosures: [] });
  const write = vi.spyOn(database, 'idbAddReviewRound').mockResolvedValue('failed');
  try { await expect(startReviewRound('Failed storage')).rejects.toThrow(/could not be saved/); }
  finally { write.mockRestore(); }
  expect((await listReviewRounds()).some(round => round.label === 'Failed storage')).toBe(false);
});

it('rejects a source edit during checksum work instead of binding a later revision', async () => {
  const original = crypto.subtle.digest.bind(crypto.subtle);
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, bytes) => { entered();await waiting;return original(algorithm, bytes); });
  const starting = startReviewRound('Stale request');
  await started;
  useDocumentStore.getState().setField('subject', 'Work changed during preparation');
  release();
  await expect(starting).rejects.toThrow(/document changed/);
  expect((await listReviewRounds()).some(round => round.label === 'Stale request')).toBe(false);
});

it('includes attachment names and all native text in policy and privacy review', async () => {
  const file = await persistAttachment({ name: 'contact-alex@example.com.pdf', size: pdf.byteLength, type: 'application/pdf' }, new Uint8Array(pdf).buffer);
  useDocumentStore.setState({ enclosures: [{ title: 'Support', fileRef: file }] });
  const round = await startReviewRound('Safety review');
  const envelope = await buildReviewCopy(round);
  const policy = resolveExportDeploymentPolicy({ hostname: 'example.com', environment: null, runtime: { status: 'absent' } });
  expect(prepareReviewCopyExport(envelope, policy).review.privacy.found).toBe(true);
  useDocumentStore.getState().setField('classLevel', 'secret');
  const secret = await startReviewRound('Retained restricted baseline');
  await expect(buildReviewCopy(secret).then(copy => prepareReviewCopyExport(copy, policy))).rejects.toThrow(/configured levels/);
  useDocumentStore.getState().setField('classLevel', 'unclassified');
});

it('keeps review-only attachment roots in a backup after deleting the source', async () => {
  const { enclosure, figure } = await resources();
  const round = await startReviewRound('Deleted source retained');
  await flushDocumentWrites();
  const id = useDocumentsStore.getState().currentId!;
  const source = (await database.idbGetAllDocuments())!.find(document => document.id === id)!;
  expect(await database.idbDeleteDocumentIfUnchanged(source)).toBe('deleted');
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, baseline: null });
  const backup = JSON.parse(await buildBackup());
  expect(backup.version).toBe(7);
  expect(backup.reviewRounds.some((pin: { id: string }) => pin.id === round.id)).toBe(true);
  expect(backup.attachments.map((file: { id: string }) => file.id)).toEqual(expect.arrayContaining([enclosure.id, figure.id]));
  expect((await collectLiveAttachmentIds())?.has(enclosure.id)).toBe(true);
  const restored = await restoreBackup(JSON.stringify(backup));
  expect(restored.issues).toBeUndefined();
  expect(restored.reviewRoundsRestored).toBe(backup.reviewRounds.length);
});

it('fails closed when review-pin inventory is unreadable or malformed', async () => {
  const read = vi.spyOn(database, 'idbReadReviewRounds').mockRejectedValue(new Error('Synthetic review inventory read failed'));
  try {
    expect(await collectLiveAttachmentIds()).toBeNull();
    await expect(buildBackup()).rejects.toThrow(/inventory read failed/);
    read.mockResolvedValue([{ kind: 'dondocs-review-round', version: 99 }]);
    expect(await collectLiveAttachmentIds()).toBeNull();
    await expect(buildBackup()).rejects.toThrow(/baseline is invalid/);
  } finally { read.mockRestore(); }
});
