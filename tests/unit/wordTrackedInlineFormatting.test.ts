import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
import { wordImportFixture, wordParagraph, wordRun } from '../_helpers/wordImportFixture';
import { parseLetterFile } from '@/lib/importLetter';
import { openWordImport } from '@/lib/importWord';
import { getSerializedSession, suspendSessionSaves } from '@/stores/documentStore';
import { flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { listReviewRounds } from '@/lib/reviewRounds';
import { decideReviewSuggestion, loadReviewSuggestionWorkspace } from '@/lib/reviewSuggestionActions';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { getExportDeploymentPolicy } from '@/config/classification';
import { lineToHtml } from '@/components/ui/variable-chip-editor-text';
import { convertRichTextToLatex } from '@/services/latex/escaper';
import { wordTrackedReviewSummary } from '@/lib/wordTrackedChanges';

installWordXmlDom();
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: vi.fn() }));
const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
beforeEach(async () => {
  vi.mocked(getExportDeploymentPolicy).mockResolvedValue(policy);
  suspendSessionSaves(); await flushDocumentWrites();
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null, lastKindIds: {} });
  useDocumentsStore.getState().newDocument();
});
afterEach(async () => { await flushDocumentWrites(); });

it('accepts a tracked italic suffix as one native styled word', async () => {
  const source = await wordImportFixture(wordParagraph('Subj: ITALIC TRACKED TEXT')
    + `<w:p>${wordRun('Develop', '<w:i/>')}<w:ins w:id="1">${wordRun('ment', '<w:i/>')}</w:ins>${wordRun('.')}</w:p>`);
  const parsed = await parseLetterFile(new File([source.buffer as ArrayBuffer], 'italic.docx'));
  const edit = parsed.word!.trackedEdits![0];
  expect(edit.before).toBe('*Develop*.');
  expect(edit.proposedPlain).toBe('Development.');
  expect(edit.proposed).toBe('*Development*.');
  expect(lineToHtml(edit.before)).toBe('<em>Develop</em>.');
  expect(wordTrackedReviewSummary(parsed.word!, { paragraphs: parsed.word!.blocks.map(block => block.paragraph) }).proposals).toBe(1);
  expect(await openWordImport(parsed, 'naval_letter')).toBe('applied');
  const round = (await listReviewRounds()).find(item => item.ownerDocumentId === useDocumentsStore.getState().currentId)!;
  const proposal = (await loadReviewSuggestionWorkspace(round.id)).state!.proposals[0];
  expect((await decideReviewSuggestion(round.id, proposal.id, 'accepted')).status).toBe('committed');
  const text = getSerializedSession().paragraphs[0].text;
  expect(text).toBe('*Development*.');
  expect(lineToHtml(text)).toBe('<em>Development</em>.');
  expect(convertRichTextToLatex(text)).toBe('\\textit{Development}.');
});
