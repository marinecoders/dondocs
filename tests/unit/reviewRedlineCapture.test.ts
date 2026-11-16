import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { captureReviewDecisionSummary, loadReviewDecisionSummary, prepareReviewDecisionSummary, reviewDecisionSummaryPdfContent, validateReviewDecisionSummaryPdf, ownsReviewDecisionSummaryPdf } from '@/lib/reviewDecisionSummary';
import { startReviewRound, transitionReviewRound } from '@/lib/reviewRoundActions';
import { createReviewSuggestion, createParagraphStructureSuggestion } from '@/lib/reviewSuggestions';
import { loadReviewSuggestionWorkspace, submitReviewSuggestion } from '@/lib/reviewSuggestionActions';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { useDocumentsStore, commitCurrentDocument, flushDocumentWrites, flushPendingReviewWrites, hasPendingReviewWrites } from '@/stores/documentsStore';
import { idbReadReviewExportSnapshot, idbPutDocument } from '@/lib/documentsDb';
import * as documentsDb from '@/lib/documentsDb';
import { useDocumentStore } from '@/stores/documentStore';
const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
beforeEach(async () => {
  await flushDocumentWrites();useDocumentsStore.getState().newDocument();
  useDocumentStore.setState({ documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter', formData: { subject: 'SYNTHETIC REDLINE', from: 'Sender', to: 'Recipient', classLevel: 'unclassified' },
    paragraphs: [{ id: 'redline-one', text: 'First body.', level: 0 }, { id: 'redline-two', text: 'Second body.', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [] });
  await commitCurrentDocument();
});
afterEach(flushDocumentWrites);
async function fixture() {
  const round = await startReviewRound('Synthetic captured redline');
  const proposal = createReviewSuggestion(round, { author: 'Synthetic reviewer', label: 'Recipient', changes: [{ target: { kind: 'field', field: 'to', docType: 'naval_letter' }, proposed: 'Proposed recipient' }] });
  await submitReviewSuggestion(proposal);
  const prepared = prepareReviewDecisionSummary(await loadReviewDecisionSummary(round.id), policy);
  return { round, prepared };
}
function unavailableSuggestionStorage() {
  const put = IDBObjectStore.prototype.put;
  return vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (value && typeof value === 'object' && 'key' in value && String(value.key).startsWith('review-suggestions:')) throw new DOMException('Full', 'QuotaExceededError');
    return put.call(this, value, key);
  });
}
it('validates the same saved content despite serialization timestamps and returns isolated captured views', async () => {
  const { prepared } = await fixture();
  await validateReviewDecisionSummaryPdf(prepared, policy);
  const view = reviewDecisionSummaryPdfContent(prepared);view.items[0].changes[0].proposed = 'CALLER MUTATION';
  expect(reviewDecisionSummaryPdfContent(prepared).items[0].changes[0].proposed).toBe('Proposed recipient');
  expect(ownsReviewDecisionSummaryPdf(prepared)).toBe(true);
});
it('invalidates a late edit and preserves the original captured text', async () => {
  const { prepared } = await fixture();useDocumentStore.getState().setField('subject', 'LATER WORK');
  await expect(validateReviewDecisionSummaryPdf(prepared, policy)).rejects.toThrow('changed');
  expect(ownsReviewDecisionSummaryPdf(prepared)).toBe(false);expect(JSON.stringify(reviewDecisionSummaryPdfContent(prepared))).not.toContain('LATER WORK');
});
it('invalidates a document switch and round closure', async () => {
  const { round, prepared } = await fixture();await transitionReviewRound(round, 'close');
  await expect(validateReviewDecisionSummaryPdf(prepared, policy)).rejects.toThrow('changed');
  useDocumentsStore.getState().newDocument();await expect(validateReviewDecisionSummaryPdf(prepared, policy)).rejects.toThrow('changed');
});
it('invalidates additional feedback and current unavailable policy without mutating the capture', async () => {
  const { round, prepared } = await fixture();
  await expect(validateReviewDecisionSummaryPdf(prepared, { status: 'error', message: 'Policy unavailable' })).rejects.toThrow('Policy unavailable');
  const proposal = createReviewSuggestion(round, { author: 'Another reviewer', label: 'Sender', changes: [{ target: { kind: 'field', field: 'from', docType: 'naval_letter' }, proposed: 'New sender' }] });
  await submitReviewSuggestion(proposal);await expect(validateReviewDecisionSummaryPdf(prepared, policy)).rejects.toThrow('changed');
  expect(reviewDecisionSummaryPdfContent(prepared).items).toHaveLength(1);
});
it('exports movement as its meaningful captured source and destination description', async () => {
  const round = await startReviewRound('Movement redline');
  await submitReviewSuggestion(createParagraphStructureSuggestion(round, { author: 'Mover', operation: { kind: 'move-paragraph', paragraphId: 'redline-one', destinationId: 'redline-two', placement: 'after' } }));
  const data = reviewDecisionSummaryPdfContent(prepareReviewDecisionSummary(await loadReviewDecisionSummary(round.id), policy));
  expect(data.items[0].changes[0].kind).toBe('move-paragraph');
  expect(data.items[0].changes[0].label).toContain('First body.');expect(data.items[0].changes[0].label).toContain('Second body.');
});

it('rejects saved work changed by another tab without adopting it into the active capture', async () => {
  const { round, prepared } = await fixture();
  const saved = (await idbReadReviewExportSnapshot(round.ownerDocumentId!, round.id)).document!;
  saved.session.formData.subject = 'OTHER TAB SAVED WORK';await idbPutDocument(saved);
  await expect(validateReviewDecisionSummaryPdf(prepared, policy)).rejects.toThrow('review changed');
  expect(JSON.stringify(reviewDecisionSummaryPdfContent(prepared))).not.toContain('OTHER TAB');
});

it('invalidates a captured download while later visible feedback is waiting for storage', async () => {
  const { round, prepared } = await fixture();
  const proposal = createReviewSuggestion(round, { author: 'Pending reviewer', label: 'Sender', changes: [{ target: { kind: 'field', field: 'from', docType: 'naval_letter' }, proposed: 'Unsaved new sender' }] });
  const unavailable = unavailableSuggestionStorage();
  try {
    expect((await submitReviewSuggestion(proposal)).status).toBe('pending');
    expect(hasPendingReviewWrites(round.ownerDocumentId!)).toBe(true);
    expect(ownsReviewDecisionSummaryPdf(prepared)).toBe(true);
    await expect(validateReviewDecisionSummaryPdf(prepared, policy)).rejects.toThrow('review changed');
    expect(reviewDecisionSummaryPdfContent(prepared).items).toHaveLength(1);
  } finally { unavailable.mockRestore();await flushPendingReviewWrites(round.ownerDocumentId!); }
  await expect(validateReviewDecisionSummaryPdf(prepared, policy)).rejects.toThrow('review changed');
});

it('rechecks pending feedback after the awaited saved snapshot', async () => {
  const { round, prepared } = await fixture();
  const proposal = createReviewSuggestion(round, { author: 'Concurrent reviewer', label: 'Sender', changes: [{ target: { kind: 'field', field: 'from', docType: 'naval_letter' }, proposed: 'Concurrent unsaved sender' }] });
  const unavailable = unavailableSuggestionStorage(), read = documentsDb.idbReadReviewExportSnapshot;
  const snapshot = vi.spyOn(documentsDb, 'idbReadReviewExportSnapshot').mockImplementationOnce(async (documentId, roundId) => {
    const captured = await read(documentId, roundId);
    expect((await submitReviewSuggestion(proposal)).status).toBe('pending');
    return captured;
  });
  try {
    await expect(validateReviewDecisionSummaryPdf(prepared, policy)).rejects.toThrow('review changed');
    expect(snapshot).toHaveBeenCalledOnce();
    expect(reviewDecisionSummaryPdfContent(prepared).items).toHaveLength(1);
  } finally { snapshot.mockRestore();unavailable.mockRestore();await flushPendingReviewWrites(round.ownerDocumentId!); }
});

it('keeps pending-feedback invalidation scoped to the captured owner', async () => {
  const { round } = await fixture(), owner = round.ownerDocumentId!;
  useDocumentsStore.getState().newDocument();
  useDocumentStore.setState({ documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter', formData: { subject: 'OTHER SYNTHETIC OWNER', from: 'Other sender', classLevel: 'unclassified' }, paragraphs: [] });
  await commitCurrentDocument();
  const other = await startReviewRound('Other owner');
  const proposal = createReviewSuggestion(other, { author: 'Other reviewer', label: 'Sender', changes: [{ target: { kind: 'field', field: 'from', docType: 'naval_letter' }, proposed: 'Other unsaved sender' }] });
  const unavailable = unavailableSuggestionStorage();
  try {
    expect((await submitReviewSuggestion(proposal)).status).toBe('pending');
    useDocumentsStore.getState().switchTo(owner);
    await commitCurrentDocument();
    const capture = await captureReviewDecisionSummary(await loadReviewSuggestionWorkspace(round.id), '2026-11-15T12:00:00.000Z');
    const prepared = prepareReviewDecisionSummary(capture, policy);
    expect(hasPendingReviewWrites()).toBe(true);
    expect(hasPendingReviewWrites(owner)).toBe(false);
    await expect(validateReviewDecisionSummaryPdf(prepared, policy)).resolves.toBeUndefined();
  } finally { unavailable.mockRestore();await flushPendingReviewWrites(other.ownerDocumentId!); }
});
