import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
import { wordImportFixture, wordRun } from '../_helpers/wordImportFixture';
import { parseLetterFile } from '@/lib/importLetter';
import { openWordImport } from '@/lib/importWord';
import { getSerializedSession, suspendSessionSaves } from '@/stores/documentStore';
import { flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { listReviewRounds } from '@/lib/reviewRounds';
import { loadReviewSuggestionWorkspace } from '@/lib/reviewSuggestionActions';
import { loadAttachment } from '@/lib/attachments';
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));
installWordXmlDom();
beforeEach(async () => {
  suspendSessionSaves();await flushDocumentWrites();
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null, lastKindIds: {} });
  useDocumentsStore.getState().newDocument();
});
afterEach(async () => { await flushDocumentWrites(); });
const underline = (text: string) => wordRun(text, '<w:u w:val="single"/>');
const labels = ([
  [wordRun('1. '), wordRun('2. '), 0], [wordRun('a. '), wordRun('b. '), 1],
  [wordRun('(1) '), wordRun('(2) '), 2], [wordRun('(a) '), wordRun('(b) '), 3],
  [underline('1') + wordRun('. '), underline('2') + wordRun('. '), 4],
  [underline('a') + wordRun('. '), underline('b') + wordRun('. '), 5],
  [underline('(1)') + wordRun(' '), underline('(2)') + wordRun(' '), 6],
  [underline('(a)') + wordRun(' '), underline('(b)') + wordRun(' '), 7],
  [wordRun('(') + underline('1') + wordRun(') '), wordRun('(') + underline('2') + wordRun(') '), 6],
  [wordRun('(') + underline('a') + wordRun(') '), wordRun('(') + underline('b') + wordRun(') '), 7],
] as const).map(([label, next, level], variant) => ({ label, next, level, variant }));
const whitespace = [
  { name: 'spaces', xml: wordRun('  '), raw: '  ' },
  { name: 'tab', xml: '<w:r><w:tab/></w:r>', raw: '\t' },
  { name: 'line break', xml: '<w:r><w:br/></w:r>', raw: '\n' },
];
const cases = labels.flatMap(label => whitespace.map(space => ({ ...label, space })));
async function open(body: string) {
  const source = await wordImportFixture(`<w:p>${body}</w:p>`);
  const parsed = await parseLetterFile(new File([source.buffer as ArrayBuffer], 'whitespace-tracked.docx'));
  expect(await openWordImport(parsed, 'naval_letter')).toBe('applied');
  const session = getSerializedSession(), owner = useDocumentsStore.getState().currentId!;
  expect(new Uint8Array((await loadAttachment(session.formData.wordSource!.fileRef!.id))!)).toEqual(source);
  return { session, rounds: (await listReviewRounds()).filter(round => round.ownerDocumentId === owner) };
}
describe('tracked printed labels after untracked leading whitespace', () => {
  for (const operation of ['insert', 'change', 'delete'] as const) it.each(cases)(`${operation} of level $level/$variant after $space.name remains original-only`, async ({ label, next, space }) => {
    const deleted = `<w:del w:id="1">${label.replaceAll('w:t', 'w:delText')}</w:del>`;
    const inserted = `<w:ins w:id="2">${operation === 'change' ? next : label}</w:ins>`;
    const { session, rounds } = await open(space.xml + (operation === 'insert' ? inserted : operation === 'delete' ? deleted : deleted + inserted) + wordRun('Keep body.'));
    expect(session.paragraphs[0].text).toBe((operation === 'insert' ? space.raw : '') + 'Keep body.');
    expect(rounds).toEqual([]);
    expect(session.formData.wordSource!.notices.join(' ')).toContain('changed printed numbering');
  });
  it.each(whitespace)('keeps legitimate non-designator emphasis after $name as a reviewable text proposal', async space => {
    const { session, rounds } = await open(space.xml + `<w:ins w:id="1">${underline('1')}${wordRun(' ordinary ')}</w:ins>` + wordRun('Keep body.'));
    expect(session.paragraphs[0].text).toBe(space.raw + 'Keep body.');expect(rounds).toHaveLength(1);
    const proposal = (await loadReviewSuggestionWorkspace(rounds[0].id)).state!.proposals[0];
    expect(proposal.changes[0]).toMatchObject({ expected: space.raw + 'Keep body.', proposed: space.raw + '__1__ ordinary Keep body.' });
  });
});
