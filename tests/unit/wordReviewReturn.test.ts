import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { XMLSerializer as XmlSerializer } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
import { WORD_NS, wordImportFixture, wordParagraph, wordRun } from '../_helpers/wordImportFixture';
import { getExportDeploymentPolicy } from '@/config/classification';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { useDocumentStore } from '@/stores/documentStore';
import { captureDocumentScope, changeDocumentHistory, commitCurrentDocument, flushDocumentWrites, openExistingDocument, useDocumentsStore } from '@/stores/documentsStore';
import { buildReviewCopy, openReviewCopy, parseReviewCopy, startReviewRound } from '@/lib/reviewRoundActions';
import { idbAddReviewRound, idbAppendWordHandoff, idbDeleteReviewRound, idbReadReviewSuggestions } from '@/lib/documentsDb';
import { readReviewRound } from '@/lib/reviewRounds';
import { buildBackup, restoreBackup } from '@/lib/backup';
import { buildWordReviewHandoff } from '@/lib/wordReviewBaseline';
import { readWordDocument } from '@/services/docx/import/readWord';
import { stampWordReviewIdentity } from '@/services/docx/review/identity';
import { prepareWordReviewReturn, applyWordReviewReturn } from '@/lib/wordReviewReturn';
import { decideReviewSuggestion } from '@/lib/reviewSuggestionActions';
import { reviewSuggestionRecordSchema } from '@/lib/reviewSuggestionWrites';

vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: vi.fn() }));
installWordXmlDom();
const serializer = globalThis.XMLSerializer;
beforeAll(() => { globalThis.XMLSerializer = XmlSerializer as unknown as typeof XMLSerializer; });
afterAll(() => { globalThis.XMLSerializer = serializer; });
const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
const baseline = 'Review this old text and keep suffix.';
beforeEach(() => {
  vi.mocked(getExportDeploymentPolicy).mockResolvedValue(policy);
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();useDocumentStore.getState().setField('subject', 'WORD RETURN');
  useDocumentStore.getState().updateParagraph(0, { text: baseline });
});
afterEach(async () => { await flushDocumentWrites();vi.clearAllMocks(); });
async function fixture() {
  await commitCurrentDocument();const round = await startReviewRound('Exact saved revision');
  const bytes = await wordImportFixture(wordParagraph(`1. ${baseline}`), { 'word/comments.xml': `<w:comments xmlns:w="${WORD_NS}"/>` });
  const imported = await readWordDocument(bytes, 'review.docx'), id = crypto.randomUUID();
  const { receipt, sourceIndexes } = await buildWordReviewHandoff(round, imported, { id, createdAt: Date.now(), docxSha256: imported.source.sha256 });
  const tagged = await stampWordReviewIdentity(bytes, { handoffId: id, roundId: round.id, baselineDigest: round.baselineDigest }, sourceIndexes);
  const source = await readWordDocument(tagged, 'review.docx');
  await idbAppendWordHandoff(round, { ...receipt, docxSha256: source.source.sha256 }, () => true);
  return { round, tagged };
}
async function returned(tagged: Uint8Array, options: { comments?: boolean; tracked?: boolean; metadata?: boolean } = {}) {
  const zip = await JSZip.loadAsync(tagged);
  let text = options.tracked ? wordRun('1. Review this ') + `<w:del w:id="1" w:author="Example"><w:r><w:delText>old</w:delText></w:r></w:del><w:ins w:id="2" w:author="Example">${wordRun('reviewed')}</w:ins>` + wordRun(' text and keep suffix.')
    : wordRun('1. Review this reviewed text and keep suffix.');
  if (options.comments) {
    text = wordRun('1. Review this ') + '<w:commentRangeStart w:id="4"/>' + wordRun('old') + '<w:commentRangeEnd w:id="4"/>' + wordRun(' text and keep suffix.');
    zip.file('word/comments.xml', `<w:comments xmlns:w="${WORD_NS}"><w:comment w:id="4" w:author="Example reviewer" w:date="2026-11-16T00:00:00Z">${wordParagraph('Please check this selected word.')}</w:comment></w:comments>`);
  }
  zip.file('word/document.xml', (await zip.file('word/document.xml')!.async('string')).replace(wordRun(`1. ${baseline}`), text));
  if (options.metadata) zip.file('docProps/core.xml', '<core><title>SECRET</title></core>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

describe('returned Word feedback through native review', () => {
  it.each(['owned', 'received'] as const)('recovers actual issued Word authority from a full backup beside an older %s baseline', async kind => {
    const { round, tagged } = await fixture(), saved = (await readReviewRound(round.id))!;
    const publicCopy = await parseReviewCopy(await buildReviewCopy(saved)), backup = await buildBackup();
    expect(publicCopy.envelope.round).not.toHaveProperty('wordHandoffs');
    expect(publicCopy.envelope.round).not.toHaveProperty('ownerDocumentId');
    expect(await idbDeleteReviewRound(round.id, round.baselineDigest)).toBe(true);
    if (kind === 'owned') expect(await idbAddReviewRound({ ...round, wordHandoffs: undefined })).toBe('committed');
    else {
      useDocumentsStore.getState().newDocument();expect(await openReviewCopy(publicCopy)).toBe('applied');
      expect((await readReviewRound(round.id))?.ownerDocumentId).toBeUndefined();
    }
    const result = await restoreBackup(backup);expect(result.issues ?? []).toEqual([]);expect(result.reviewRoundsRestored).toBeGreaterThan(0);
    const restored = (await readReviewRound(round.id))!;
    expect(restored.ownerDocumentId).toBe(round.ownerDocumentId);expect(restored.wordHandoffs).toEqual(saved.wordHandoffs);
    expect(['applied', 'unchanged']).toContain(openExistingDocument(round.ownerDocumentId!));
    expect((await prepareWordReviewReturn(await returned(tagged), 'recovered-return.docx')).native.proposals).toHaveLength(1);
  });
  it.each([false, true])('imports actual DOCX text as pending native range proposals and preserves newer work/Undo (tracked: %s)', async tracked => {
    const { round, tagged } = await fixture(), bytes = await returned(tagged, { tracked });
    useDocumentStore.getState().updateParagraph(0, { text: baseline.replace('suffix.', 'newer suffix.') });
    useDocumentStore.getState().setField('subject', 'NEWER SUBJECT');
    const prepared = await prepareWordReviewReturn(bytes, 'returned.docx');
    expect(prepared.native.proposals).toHaveLength(1);expect(prepared.native.proposals[0].changes[0].target.kind).toBe('range');
    expect(await applyWordReviewReturn(prepared, {})).toBe('committed');
    expect(useDocumentStore.getState().paragraphs[0].text).toBe(baseline.replace('suffix.', 'newer suffix.'));
    expect((await decideReviewSuggestion(round.id, prepared.native.proposals[0].id, 'accepted')).status).toBe('committed');
    expect(useDocumentStore.getState().paragraphs[0].text).toBe('Review this reviewed text and keep newer suffix.');
    expect(useDocumentStore.getState().formData.subject).toBe('NEWER SUBJECT');
    expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');await flushDocumentWrites();
    expect(useDocumentStore.getState().paragraphs[0].text).toBe(baseline.replace('suffix.', 'newer suffix.'));
    expect(changeDocumentHistory('redo', captureDocumentScope())).toBe('applied');await flushDocumentWrites();
    expect(useDocumentStore.getState().paragraphs[0].text).toBe('Review this reviewed text and keep newer suffix.');
    expect(reviewSuggestionRecordSchema.parse(await idbReadReviewSuggestions(round.ownerDocumentId!, round.id)).state.decisions.map(decision => decision.action)).toEqual(['accepted', 'reversed', 'restored']);
    expect((await prepareWordReviewReturn(bytes, 'renamed-return.docx')).native.alreadyImported).toBe(true);
  });
  it('represents supported Word inline emphasis as a pending native paragraph proposal', async () => {
    const { round, tagged } = await fixture(), zip = await JSZip.loadAsync(tagged);
    zip.file('word/document.xml', (await zip.file('word/document.xml')!.async('string')).replace(wordRun(`1. ${baseline}`), wordRun('1. Review this ') + wordRun('old', '<w:b/>') + wordRun(' text and keep suffix.')));
    const prepared = await prepareWordReviewReturn(await zip.generateAsync({ type: 'uint8array' }), 'emphasis.docx');
    expect(prepared.native.proposals[0].changes[0]).toMatchObject({ target: { kind: 'paragraph' }, expected: baseline, proposed: 'Review this **old** text and keep suffix.' });
    expect(useDocumentStore.getState().paragraphs[0].text).toBe(baseline);
    await applyWordReviewReturn(prepared, {});await decideReviewSuggestion(round.id, prepared.native.proposals[0].id, 'accepted');
    expect(useDocumentStore.getState().paragraphs[0].text).toBe('Review this **old** text and keep suffix.');
  });
  it('surfaces overlapping native text and requires an explicit current-range decision', async () => {
    const { round, tagged } = await fixture(), bytes = await returned(tagged);
    useDocumentStore.getState().updateParagraph(0, { text: baseline.replace('old', 'newer') });
    const prepared = await prepareWordReviewReturn(bytes, 'return.docx');await applyWordReviewReturn(prepared, {});
    const proposal = prepared.native.proposals[0];
    await expect(decideReviewSuggestion(round.id, proposal.id, 'accepted')).rejects.toThrow('target differs');
    expect(useDocumentStore.getState().paragraphs[0].text).toBe(baseline.replace('old', 'newer'));
    const context = useDocumentStore.getState().paragraphs[0].text, start = context.indexOf('newer');
    expect((await decideReviewSuggestion(round.id, proposal.id, 'accepted', [{ changeId: proposal.changes[0].id,
      expectedCurrent: 'newer', value: 'reviewed', range: { context, start, end: start + 5 } }])).status).toBe('committed');
    expect(useDocumentStore.getState().paragraphs[0].text).toBe('Review this reviewed text and keep suffix.');
  });
  it('maps actual returned Word selected comments and preserves pre-existing native discussions', async () => {
    const originalId = crypto.randomUUID();useDocumentStore.setState({ reviewComments: { version: 1, threads: [{ id: originalId, anchor: { kind: 'document' }, resolved: false,
      messages: [{ id: crypto.randomUUID(), author: 'Drafter', text: 'Keep this existing discussion.', createdAt: new Date().toISOString() }] }] } });
    const { tagged } = await fixture(), bytes = await returned(tagged, { comments: true });
    const prepared = await prepareWordReviewReturn(bytes, 'comments.docx');expect(prepared.native.comments?.threads).toHaveLength(2);
    expect(prepared.native.comments?.threads[1].anchor).toMatchObject({ kind: 'range', start: 12, end: 15, context: baseline });
    expect(await applyWordReviewReturn(prepared, {})).toBe('committed');
    expect(useDocumentStore.getState().reviewComments?.threads[0].id).toBe(originalId);
    expect(useDocumentStore.getState().reviewComments?.threads[1].messages[0].text).toContain('unverified');
    expect((await prepareWordReviewReturn(bytes, 'same.docx')).native.alreadyImported).toBe(true);
  });
  it('rejects missing identity, wrong current owner, retained markings and filename markings without partial writes', async () => {
    const { round, tagged } = await fixture(), noMarker = await wordImportFixture(wordParagraph(`1. ${baseline}`));
    await expect(prepareWordReviewReturn(noMarker, 'return.docx')).rejects.toThrow();
    await expect(prepareWordReviewReturn(await returned(tagged, { metadata: true }), 'return.docx')).rejects.toThrow('outside this deployment');
    await expect(prepareWordReviewReturn(await returned(tagged), '(S) return.docx')).rejects.toThrow('outside this deployment');
    expect(await idbReadReviewSuggestions(round.ownerDocumentId!, round.id)).toBeNull();
    useDocumentsStore.getState().newDocument();await expect(prepareWordReviewReturn(await returned(tagged), 'return.docx')).rejects.toThrow('owned by the open');
    expect(useDocumentStore.getState().paragraphs[0].text).not.toBe('Review this reviewed text and keep suffix.');
  });
  it('requires re-review after a policy or source activation changes following preview', async () => {
    const { round, tagged } = await fixture(), prepared = await prepareWordReviewReturn(await returned(tagged), 'return.docx');
    vi.mocked(getExportDeploymentPolicy).mockResolvedValueOnce(resolveExportDeploymentPolicy({ hostname: 'other.test', environment: null, runtime: { status: 'absent' } }));
    await expect(applyWordReviewReturn(prepared, {})).rejects.toThrow('policy changed');
    expect(await idbReadReviewSuggestions(round.ownerDocumentId!, round.id)).toBeNull();
    useDocumentsStore.getState().newDocument();await expect(applyWordReviewReturn(prepared, {})).rejects.toThrow('draft changed');
  });
});
