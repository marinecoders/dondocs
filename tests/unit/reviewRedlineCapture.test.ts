import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { loadReviewDecisionSummary, prepareReviewDecisionSummary, reviewDecisionSummaryPdfContent, validateReviewDecisionSummaryPdf, ownsReviewDecisionSummaryPdf } from '@/lib/reviewDecisionSummary';
import { startReviewRound, transitionReviewRound } from '@/lib/reviewRoundActions';
import { createReviewSuggestion, createParagraphStructureSuggestion } from '@/lib/reviewSuggestions';
import { submitReviewSuggestion } from '@/lib/reviewSuggestionActions';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { useDocumentsStore, commitCurrentDocument, flushDocumentWrites } from '@/stores/documentsStore';
import { idbReadReviewExportSnapshot, idbPutDocument } from '@/lib/documentsDb';
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
