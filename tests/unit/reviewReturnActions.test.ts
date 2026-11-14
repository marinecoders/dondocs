import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getExportDeploymentPolicy } from '@/config/classification';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { CLASSIFICATION_LEVELS } from '@/lib/overallClassification';
import { triggerDownload } from '@/lib/encoding';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore, captureDocumentScope, changeDocumentHistory, commitCurrentDocument, flushDocumentWrites } from '@/stores/documentsStore';
import { applyCommentMutation, reviewCommentMutation } from '@/lib/reviewCommentActions';
import { idbAddReviewRound, idbInstallReviewCopy } from '@/lib/documentsDb';
import { type ReviewRound } from '@/lib/reviewRounds';
import { parseReviewReturn, type ReviewReturn } from '@/lib/reviewReturns';
import { applyReviewReturn, downloadReviewReturn, prepareReviewReturnExport, prepareReviewReturnImport } from '@/lib/reviewReturnActions';
import { createReviewSuggestion } from '@/lib/reviewSuggestions';
import { submitReviewSuggestion, decideReviewSuggestion } from '@/lib/reviewSuggestionActions';
import { idbReadReviewSuggestions } from '@/lib/documentsDb';
import { reviewSuggestionRecordSchema } from '@/lib/reviewSuggestionWrites';
import type { ReviewComments } from '@/lib/reviewComments';

vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: vi.fn() }));
vi.mock('@/lib/encoding', async original => ({ ...await original<typeof import('@/lib/encoding')>(), triggerDownload: vi.fn() }));
const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
const allLevels = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: { maxLevel: 'top_secret_sci', allowedLevels: CLASSIFICATION_LEVELS }, runtime: { status: 'absent' } });
const note = (text = 'Returned comment'): ReviewComments => ({ version: 1, threads: [{ id: crypto.randomUUID(), anchor: { kind: 'document' }, resolved: false,
  messages: [{ id: crypto.randomUUID(), author: 'Example reviewer', text, createdAt: '2026-11-13T00:00:00Z' }] }] });

beforeEach(() => {
  vi.clearAllMocks();vi.mocked(getExportDeploymentPolicy).mockResolvedValue(policy);
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
});
afterEach(async () => { await flushDocumentWrites(); });
async function fixture(options: { comments?: ReviewComments; subject?: string; paragraphId?: string; secret?: boolean; custom?: string; portion?: 'S' } = {}) {
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', options.subject ?? 'Author draft');
  if (options.paragraphId) useDocumentStore.setState({ paragraphs: [{ ...useDocumentStore.getState().paragraphs[0], id: options.paragraphId, text: 'Reviewed plain paragraph.' }] });
  if (options.secret) useDocumentStore.getState().setField('classLevel', 'secret');
  if (options.portion) useDocumentStore.getState().updateParagraph(0, { text: 'Reviewed baseline paragraph.', portionMarking: options.portion });
  if (options.custom) { useDocumentStore.getState().setField('classLevel', 'custom');useDocumentStore.getState().setField('customClassification', options.custom); }
  if (options.comments) useDocumentStore.setState({ reviewComments: options.comments });
  await commitCurrentDocument();
  const owner = useDocumentsStore.getState().currentId!, source = useDocumentsStore.getState().docs[owner];
  const session = structuredClone(source.session), round: ReviewRound = { kind: 'dondocs-review-round', version: 1,
    id: `review_${crypto.randomUUID()}`, createdAt: session.timestamp, label: 'Example review', sourceDocumentId: owner,
    ownerDocumentId: owner, baselineDigest: 'a'.repeat(64), baseline: { ts: session.timestamp, session } };
  await idbAddReviewRound(round);
  const copyId = crypto.randomUUID(), record = { id: copyId, meta: { ...source.meta, id: copyId }, session: structuredClone(session) };
  expect(await idbInstallReviewCopy(record, round, { documentId: copyId, roundId: round.id, baselineDigest: round.baselineDigest })).toBe(true);
  useDocumentsStore.setState(state => ({ docs: { ...state.docs, [copyId]: { meta: record.meta, session: record.session } } }));
  useDocumentsStore.getState().switchTo(copyId);
  return { owner, copyId, round };
}
async function exported(): Promise<ReviewReturn> {
  downloadReviewReturn(await prepareReviewReturnExport());
  return parseReviewReturn(JSON.parse(new TextDecoder().decode(vi.mocked(triggerDownload).mock.calls.at(-1)![0] as Uint8Array)));
}

describe('captured review-return actions', () => {
  it('returns explicit replacements as pending metadata, preserves newer source work, then accepts with recorded Undo/Redo', async () => {
    const { owner, round } = await fixture({ subject: 'Reviewed subject' });
    const proposal = createReviewSuggestion(round, { author: 'Reviewer', label: 'Replace subject', changes: [{ target: { kind: 'field', field: 'subject', docType: 'naval_letter' }, proposed: 'Suggested subject' }] });
    expect((await submitReviewSuggestion(proposal)).status).toBe('committed');
    const payload = await exported();expect(payload.version).toBe(2);
    useDocumentsStore.getState().switchTo(owner);useDocumentStore.getState().updateParagraph(0, { text: 'Newer author paragraph' });
    const prepared = await prepareReviewReturnImport(payload);expect(prepared.proposals).toEqual([proposal]);
    expect(await applyReviewReturn(prepared, {})).toBe('committed');
    expect(useDocumentStore.getState().formData.subject).toBe('Reviewed subject');
    expect(useDocumentStore.getState().paragraphs[0].text).toBe('Newer author paragraph');
    expect((await decideReviewSuggestion(round.id, proposal.id, 'accepted')).status).toBe('committed');
    expect(useDocumentStore.getState().formData.subject).toBe('Suggested subject');
    expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');await flushDocumentWrites();
    expect(useDocumentStore.getState().formData.subject).toBe('Reviewed subject');
    expect(changeDocumentHistory('redo', captureDocumentScope())).toBe('applied');await flushDocumentWrites();
    expect(useDocumentStore.getState().formData.subject).toBe('Suggested subject');
    const stored = reviewSuggestionRecordSchema.parse(await idbReadReviewSuggestions(owner, round.id));
    expect(stored.state.decisions.map(decision => decision.action)).toEqual(['accepted', 'reversed', 'restored']);
    const repeated = await prepareReviewReturnImport(payload);expect(repeated.alreadyImported).toBe(true);
    expect(await applyReviewReturn(repeated, {})).toBe('already-imported');
  });
  it('keeps the recognized baseline floor when an unranked custom marking is retained', async () => {
    vi.mocked(getExportDeploymentPolicy).mockResolvedValue(allLevels);
    const { round, owner } = await fixture({ custom: 'INTERNAL HANDLING', portion: 'S' });
    const proposal = createReviewSuggestion(round, { author: 'Reviewer', label: 'Subject', changes: [{ target: { kind: 'field', field: 'subject', docType: 'naval_letter' }, proposed: 'Reviewed subject' }] });
    await submitReviewSuggestion(proposal);const payload = await exported();expect(payload.handling.marking).toContain('SECRET');
    useDocumentsStore.getState().switchTo(owner);
    useDocumentStore.getState().updateParagraph(0, { text: 'Lower marked current paragraph.', portionMarking: undefined });
    expect(await applyReviewReturn(await prepareReviewReturnImport(payload), {})).toBe('committed');
    await expect(decideReviewSuggestion(round.id, proposal.id, 'accepted')).rejects.toThrow(/marked below/);
    expect(useDocumentStore.getState().formData.subject).toBe('Author draft');
    useDocumentStore.getState().updateParagraph(0, { portionMarking: 'S' });
    expect((await decideReviewSuggestion(round.id, proposal.id, 'accepted')).status).toBe('committed');
    expect(useDocumentStore.getState().formData.customClassification).toBe('INTERNAL HANDLING');
    expect(useDocumentStore.getState().formData.subject).toBe('Reviewed subject');
  });
  it.each([
    { baseline: 'SECRET', proposed: 'UNCLASSIFIED', error: /marked below/ },
    { baseline: 'INTERNAL HANDLING', proposed: 'UNCLASSIFIED', error: /unranked or incomplete/ },
  ])('rejects a custom marking replacement that drops the retained $baseline handling', async ({ baseline, proposed, error }) => {
    vi.mocked(getExportDeploymentPolicy).mockResolvedValue(allLevels);
    const { round, owner } = await fixture({ custom: baseline });
    const proposal = createReviewSuggestion(round, { author: 'Reviewer', label: 'Custom marking',
      changes: [{ target: { kind: 'field', field: 'customClassification', docType: 'naval_letter' }, proposed }] });
    expect((await submitReviewSuggestion(proposal)).status).toBe('committed');
    const payload = await exported();useDocumentsStore.getState().switchTo(owner);
    expect(await applyReviewReturn(await prepareReviewReturnImport(payload), {})).toBe('committed');
    await expect(decideReviewSuggestion(round.id, proposal.id, 'accepted')).rejects.toThrow(error);
    expect(useDocumentStore.getState().formData.customClassification).toBe(baseline);
    expect(reviewSuggestionRecordSchema.parse(await idbReadReviewSuggestions(owner, round.id)).state.decisions).toEqual([]);
  });
  it('accepts a custom marking replacement whose resulting document meets the raised floor', async () => {
    vi.mocked(getExportDeploymentPolicy).mockResolvedValue(allLevels);
    const { round, owner } = await fixture({ custom: 'CUI' });
    const proposal = createReviewSuggestion(round, { author: 'Reviewer', label: 'Custom marking',
      changes: [{ target: { kind: 'field', field: 'customClassification', docType: 'naval_letter' }, proposed: 'SECRET' }] });
    expect((await submitReviewSuggestion(proposal)).status).toBe('committed');
    const payload = await exported();useDocumentsStore.getState().switchTo(owner);
    expect(await applyReviewReturn(await prepareReviewReturnImport(payload), {})).toBe('committed');
    expect((await decideReviewSuggestion(round.id, proposal.id, 'accepted')).status).toBe('committed');
    expect(useDocumentStore.getState().formData.customClassification).toBe('SECRET');
    expect(reviewSuggestionRecordSchema.parse(await idbReadReviewSuggestions(owner, round.id)).state.decisions.map(item => item.action)).toEqual(['accepted']);
  });
  it('scans an emitted paragraph target identifier without adding unrelated native text to the return', async () => {
    const { round } = await fixture({ subject: 'Unemitted native subject', paragraphId: '123-45-6789' });
    const proposal = createReviewSuggestion(round, { author: 'Reviewer', label: 'Plain paragraph', changes: [{ target: { kind: 'paragraph', paragraphId: '123-45-6789', docType: 'naval_letter' }, proposed: 'Proposed plain paragraph.' }] });
    await submitReviewSuggestion(proposal);
    const prepared = await prepareReviewReturnExport();expect(prepared.privacy.findings.some(finding => finding.value === '123-45-6789')).toBe(true);
    const payload = await exported();expect(payload.version).toBe(2);expect(JSON.stringify(payload)).not.toContain('Unemitted native subject');
    expect(proposal.changes[0].expected).not.toContain('123-45-6789');expect(proposal.changes[0].proposed).not.toContain('123-45-6789');
  });
  it('scans emitted replacement before/after text and rejects changed proposal IDs without overwriting newer text', async () => {
    const { owner, round } = await fixture({ subject: 'Prior SSN 123-45-6789' });
    const proposal = createReviewSuggestion(round, { author: 'Reviewer', label: 'Subject', changes: [{ target: { kind: 'field', field: 'subject', docType: 'naval_letter' }, proposed: 'Removed sensitive value' }] });
    await submitReviewSuggestion(proposal);const preview = await prepareReviewReturnExport();expect(preview.privacy.found).toBe(true);
    const payload = await exported();useDocumentsStore.getState().switchTo(owner);
    expect(await applyReviewReturn(await prepareReviewReturnImport(payload), {})).toBe('committed');
    const changed = structuredClone(payload);if (changed.version !== 2) throw new Error('Expected proposal return');
    changed.id = `return_${crypto.randomUUID()}`;changed.proposals[0].changes[0].proposed = 'Changed immutable identity';
    await expect(prepareReviewReturnImport(changed)).rejects.toThrow();
    useDocumentStore.getState().setField('subject', 'Newer overlapping author edit');
    await expect(decideReviewSuggestion(round.id, proposal.id, 'accepted')).rejects.toThrow(/target differs/);
    expect(useDocumentStore.getState().formData.subject).toBe('Newer overlapping author edit');
    expect((await decideReviewSuggestion(round.id, proposal.id, 'rejected')).status).toBe('committed');
  });
  it('exports only discussions and handling metadata, without unrelated baseline body PII', async () => {
    await fixture({ subject: 'Baseline SSN 123-45-6789' });const comments = note();useDocumentStore.setState({ reviewComments: comments });
    const prepared = await prepareReviewReturnExport();expect(prepared.privacy.found).toBe(false);
    downloadReviewReturn(prepared);
    const payload = parseReviewReturn(JSON.parse(new TextDecoder().decode(vi.mocked(triggerDownload).mock.calls[0][0] as Uint8Array)));
    expect(payload.comments).toEqual(comments);expect(payload.handling.marking).toContain('UNCLASSIFIED');
    const text = JSON.stringify(payload);expect(text).not.toContain('123-45-6789');expect(text).not.toContain('formData');expect(text).not.toContain('ownerDocumentId');
  });
  it('includes and scans retained custom source labels actually emitted in the return', async () => {
    await fixture({ custom: 'Internal SSN 123-45-6789 handling' });useDocumentStore.setState({ reviewComments: note() });
    const prepared = await prepareReviewReturnExport();expect(prepared.marking).toContain('MARKING REVIEW REQUIRED');
    expect(prepared.customMarkings).toContain('Internal SSN 123-45-6789 handling');expect(prepared.privacy.found).toBe(true);
  });
  it('scans returned authors, messages and detached context and retains its marking floor', async () => {
    vi.mocked(getExportDeploymentPolicy).mockResolvedValue(allLevels);
    await fixture();const comments = note('SSN 987-65-4321');comments.version = 2;
    comments.threads[0].anchor = { kind: 'paragraph', paragraphId: 'deleted-target', context: '(U) Detached context\nFigure marking: (TS)', docType: 'naval_letter' };
    useDocumentStore.setState({ reviewComments: comments });
    const prepared = await prepareReviewReturnExport();expect(prepared.privacy.findings.some(finding => finding.value === '987-65-4321')).toBe(true);
    expect(prepared.marking).toContain('TOP SECRET');
  });
  it('blocks disallowed retained baseline markings before downloading', async () => {
    await fixture({ secret: true });await expect(prepareReviewReturnExport()).rejects.toThrow();expect(triggerDownload).not.toHaveBeenCalled();
  });
  it('requires a linked reviewer copy instead of inferring it from matching document text', async () => {
    const { owner } = await fixture();useDocumentsStore.getState().switchTo(owner);
    await expect(prepareReviewReturnExport()).rejects.toThrow(/not a linked reviewer copy/);
  });
  it('invalidates preparation when the document changes during an asynchronous policy read', async () => {
    await fixture();let finish!: (value: typeof policy) => void;
    vi.mocked(getExportDeploymentPolicy).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const preparing = prepareReviewReturnExport();await vi.waitFor(() => expect(getExportDeploymentPolicy).toHaveBeenCalledOnce());
    useDocumentsStore.getState().newDocument();finish(policy);
    await expect(preparing).rejects.toThrow(/draft changed/);expect(triggerDownload).not.toHaveBeenCalled();
  });
  it('does not allow mutation of a displayed preview to change the downloaded captured return', async () => {
    await fixture();useDocumentStore.setState({ reviewComments: note('Captured text') });
    const prepared = await prepareReviewReturnExport();prepared.comments!.threads[0].messages[0].text = 'Changed preview object';
    downloadReviewReturn(prepared);const payload = parseReviewReturn(JSON.parse(new TextDecoder().decode(vi.mocked(triggerDownload).mock.calls[0][0] as Uint8Array)));
    expect(payload.comments!.threads[0].messages[0].text).toBe('Captured text');
  });
  it('imports only feedback while preserving newer draft text and local discussions', async () => {
    const { owner } = await fixture();const returned = note();useDocumentStore.setState({ reviewComments: returned });const payload = await exported();
    useDocumentsStore.getState().switchTo(owner);useDocumentStore.getState().updateParagraph(0, { text: 'Newer author body' });
    expect(applyCommentMutation(reviewCommentMutation({ kind: 'add', author: 'Drafter', text: 'Local discussion' }))).toBe('applied');
    const prepared = await prepareReviewReturnImport(payload);expect(prepared.plan.addedThreads).toBe(1);
    expect(await applyReviewReturn(prepared, {})).toBe('committed');
    expect(useDocumentStore.getState().paragraphs[0].text).toBe('Newer author body');
    expect(useDocumentStore.getState().reviewComments?.threads.map(thread => thread.messages[0].text)).toEqual(['Local discussion', 'Returned comment']);
  });
  it('rejects return routing to a reviewer copy or an unrelated draft', async () => {
    const { owner } = await fixture();const payload = await exported();
    await expect(prepareReviewReturnImport(payload)).rejects.toThrow(/original draft/);
    useDocumentsStore.getState().newDocument();useDocumentStore.getState().setField('subject', 'Unrelated');
    await expect(prepareReviewReturnImport(payload)).rejects.toThrow(/original draft/);
    useDocumentsStore.getState().switchTo(owner);
    await expect(prepareReviewReturnImport({ ...payload, baselineDigest: 'b'.repeat(64) })).rejects.toThrow(/different baseline/);
  });
  it('requires conflict choices for competing message edits instead of overwriting local feedback', async () => {
    const original = note(), { owner } = await fixture({ comments: original });
    expect(applyCommentMutation(reviewCommentMutation({ kind: 'edit', threadId: original.threads[0].id, messageId: original.threads[0].messages[0].id, text: 'Reviewer edit' }))).toBe('applied');
    const payload = await exported();useDocumentsStore.getState().switchTo(owner);
    expect(applyCommentMutation(reviewCommentMutation({ kind: 'edit', threadId: original.threads[0].id, messageId: original.threads[0].messages[0].id, text: 'Author edit' }))).toBe('applied');
    const prepared = await prepareReviewReturnImport(payload);expect(prepared.plan.status).toBe('conflict');
    await expect(applyReviewReturn(prepared, {})).rejects.toThrow(/every conflicting discussion/);
    expect(useDocumentStore.getState().reviewComments?.threads[0].messages[0].text).toBe('Author edit');
    expect(await applyReviewReturn(prepared, { [prepared.plan.conflicts[0].id]: 'returned' })).toBe('committed');
    expect(useDocumentStore.getState().reviewComments?.threads[0].messages[0].text).toBe('Reviewer edit');
  });
  it('recognizes a received file after Undo and rejects changed feedback under the same return ID', async () => {
    const { owner } = await fixture();useDocumentStore.setState({ reviewComments: note() });const payload = await exported();
    useDocumentsStore.getState().switchTo(owner);expect(await applyReviewReturn(await prepareReviewReturnImport(payload), {})).toBe('committed');
    expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');
    const again = await prepareReviewReturnImport(payload);expect(again.alreadyImported).toBe(true);expect(await applyReviewReturn(again, {})).toBe('already-imported');
    expect(useDocumentStore.getState().reviewComments).toBeUndefined();
    const changed = structuredClone(payload);changed.comments!.threads[0].messages[0].text = 'Changed under same identity';
    await expect(prepareReviewReturnImport(changed)).rejects.toThrow(/already imported return identity/);
  });
  it('rederives trusted handling rather than accepting an incoming lower classification label', async () => {
    vi.mocked(getExportDeploymentPolicy).mockResolvedValue(allLevels);
    const { owner } = await fixture({ secret: true });const payload = await exported();expect(payload.handling.marking).toContain('SECRET');
    useDocumentsStore.getState().switchTo(owner);
    await expect(prepareReviewReturnImport({ ...payload, handling: { marking: 'UNCLASSIFIED', customMarkings: [] } })).rejects.toThrow(/handling markings/);
  });
});
