import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getExportDeploymentPolicy } from '@/config/classification';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { triggerDownload } from '@/lib/encoding';
import { useDocumentStore, getSerializedSession } from '@/stores/documentStore';
import { captureDocumentScope, changeDocumentHistory, commitCurrentDocument, flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { useProfileStore } from '@/stores/profileStore';
import { useUIStore } from '@/stores/uiStore';
import { buildReviewCopy, openReviewCopy, parseReviewCopy, startReviewRound } from '@/lib/reviewRoundActions';
import { createMechanicalReviewProposal, mechanicalReviewCandidates } from '@/lib/mechanicalReviewProposals';
import { decideReviewSuggestion, submitReviewSuggestion } from '@/lib/reviewSuggestionActions';
import { applyReviewReturn, downloadReviewReturn, prepareReviewReturnExport, prepareReviewReturnImport } from '@/lib/reviewReturnActions';
import { parseReviewReturn } from '@/lib/reviewReturns';
import { reviewSuggestionRecordSchema } from '@/lib/reviewSuggestionWrites';
import { idbDeleteDocument, idbDeleteReviewRound, idbGetAllDocuments, idbReadReviewSuggestions } from '@/lib/documentsDb';
import { buildBackup, restoreBackup } from '@/lib/backup';

vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: vi.fn() }));
vi.mock('@/lib/encoding', async original => ({ ...await original<typeof import('@/lib/encoding')>(), triggerDownload: vi.fn() }));
const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });

beforeEach(() => {
  vi.clearAllMocks();sessionStorage.clear();vi.mocked(getExportDeploymentPolicy).mockResolvedValue(policy);
  useProfileStore.setState({ profiles: {}, selectedProfile: null });
  useUIStore.setState({ storageHealth: 'ok' });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
});
afterEach(async () => { await flushDocumentWrites(); });

async function fixture(guardOnlyPII = false) {
  useDocumentsStore.getState().newDocument();
  useDocumentStore.setState({ formData: { ...useDocumentStore.getState().formData, subject: 'Fictional formatting source', date: '13 November 2026', sigFirst: ' A . ' },
    paragraphs: [{ id: 'formatting-body', text: 'Due 5 Nov 2026 and 06 Dec 2026.', level: 0 }, { id: 'unrelated-body', text: 'Unrelated body.', level: 0 }],
    references: [{ letter: 'a', title: 'Alpha (notal)', url: 'https://example.test/a' },
      { letter: 'b', title: guardOnlyPII ? 'Unchanged guard identifier 123-45-6789' : 'Bravo', url: guardOnlyPII ? 'https://example.test/person/987-65-4321' : 'https://example.test/b' }] });
  await commitCurrentDocument();
  const owner = useDocumentsStore.getState().currentId!, round = await startReviewRound('Fictional formatting review');
  expect(await openReviewCopy(await parseReviewCopy(await buildReviewCopy(round)))).toBe('applied');
  const copy = useDocumentsStore.getState().currentId!;
  return { owner, copy, round };
}
async function exported() {
  downloadReviewReturn(await prepareReviewReturnExport());
  const bytes = vi.mocked(triggerDownload).mock.calls.at(-1)![0] as Uint8Array;
  return { payload: parseReviewReturn(JSON.parse(new TextDecoder().decode(bytes))), text: new TextDecoder().decode(bytes) };
}

it('returns computed groups as pending v2 metadata, accepts through the shared owner, and retains Undo/Redo in a fresh backup restore', async () => {
  const { owner, copy, round } = await fixture();
  const proposal = createMechanicalReviewProposal(round, { author: 'Example reviewer 123-45-6789', bodyAudience: 'military',
    selectedIds: mechanicalReviewCandidates(round, 'military').filter(candidate => candidate.after !== undefined).map(candidate => candidate.id) });
  expect((await submitReviewSuggestion(proposal)).status).toBe('committed');
  expect((await prepareReviewReturnExport()).privacy.findings.some(finding => finding.value === '123-45-6789')).toBe(true);
  const { payload } = await exported();expect(payload.version).toBe(2);
  useDocumentsStore.getState().switchTo(owner);
  useDocumentStore.getState().setField('subject', 'Newer author subject');
  useDocumentStore.getState().updateParagraph(1, { text: 'Newer unrelated author body.' });
  const incoming = await prepareReviewReturnImport(payload);
  expect(incoming.proposals).toEqual([proposal]);expect(incoming.privacy.found).toBe(true);
  expect(await applyReviewReturn(incoming, {})).toBe('committed');
  expect(useDocumentStore.getState().formData.date).toBe('13 November 2026');
  expect(useDocumentStore.getState().references[0].title).toBe('Alpha (notal)');
  expect((await decideReviewSuggestion(round.id, proposal.id, 'accepted')).status).toBe('committed');
  expect(useDocumentStore.getState().formData).toMatchObject({ subject: 'Newer author subject', date: '13 Nov 26', sigFirst: 'A.' });
  expect(useDocumentStore.getState().paragraphs[1].text).toBe('Newer unrelated author body.');
  expect(useDocumentStore.getState().references[0].title).toBe('Alpha (NOTAL)');
  expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');await flushDocumentWrites();
  expect(useDocumentStore.getState().references[0].title).toBe('Alpha (notal)');
  expect(changeDocumentHistory('redo', captureDocumentScope())).toBe('applied');await flushDocumentWrites();
  const record = reviewSuggestionRecordSchema.parse(await idbReadReviewSuggestions(owner, round.id));
  expect(record.state.decisions.map(decision => decision.action)).toEqual(['accepted', 'reversed', 'restored']);
  const repeated = await prepareReviewReturnImport(payload);expect(repeated.alreadyImported).toBe(true);
  expect(await applyReviewReturn(repeated, {})).toBe('already-imported');
  expect(JSON.stringify(getSerializedSession())).not.toContain('123-45-6789');
  expect(JSON.stringify(getSerializedSession())).not.toContain(proposal.id);
  const backup = await buildBackup(), bundle = JSON.parse(backup);
  expect(bundle.version).toBe(9);expect(bundle.reviewSuggestions.some((value: typeof record) => value.documentId === owner && value.state.proposals[0].id === proposal.id)).toBe(true);
  expect(await idbDeleteReviewRound(round.id, round.baselineDigest)).toBe(true);
  await idbDeleteDocument(owner);await idbDeleteDocument(copy);
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, baseline: null });
  const restored = await restoreBackup(backup);expect(restored.issues).toBeUndefined();
  const restoredRecord = reviewSuggestionRecordSchema.parse(await idbReadReviewSuggestions(owner, round.id));
  expect(restoredRecord.state).toEqual(record.state);
  const restoredSource = (await idbGetAllDocuments())!.find(document => document.id === owner)!;
  expect(restoredSource.session.references[0].title).toBe('Alpha (NOTAL)');
  expect(restoredSource.session.formData.subject).toBe('Newer author subject');
});

it('keeps unchanged guard-only PII out of v2 returns instead of serializing a reference-list guard', async () => {
  const { owner, round } = await fixture(true);
  const candidate = mechanicalReviewCandidates(round, null).find(item => item.source === 'references')!;
  const proposal = createMechanicalReviewProposal(round, { author: 'Example reviewer', bodyAudience: null, selectedIds: [candidate.id] });
  expect(proposal.changes[0].target).toEqual({ kind: 'reference-title', referenceIndex: 0, docType: 'naval_letter' });
  expect((await submitReviewSuggestion(proposal)).status).toBe('committed');
  expect((await prepareReviewReturnExport()).privacy.found).toBe(false);
  const { payload, text } = await exported();expect(payload.version).toBe(2);
  expect(text).not.toContain('123-45-6789');expect(text).not.toContain('987-65-4321');expect(text).not.toContain('example.test/person');
  useDocumentsStore.getState().switchTo(owner);
  const incoming = await prepareReviewReturnImport(payload);expect(incoming.privacy.found).toBe(false);
  expect(await applyReviewReturn(incoming, {})).toBe('committed');
  useDocumentStore.getState().updateReference(1, { url: 'https://example.test/person/111-22-3333' });
  await expect(decideReviewSuggestion(round.id, proposal.id, 'accepted')).rejects.toThrow(/target differs/);
  expect(useDocumentStore.getState().references[0].title).toBe('Alpha (notal)');
});
