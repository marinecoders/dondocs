import { afterAll, beforeAll, expect, it } from 'vitest';
import JSZip from 'jszip';
import { XMLSerializer as XmlSerializer } from '@xmldom/xmldom';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
import { WORD_NS, wordImportFixture, wordParagraph, wordRun } from '../_helpers/wordImportFixture';
import { addWordProofreadComments, issuedProofreadCommentDigest, planWordProofreadComments } from '@/services/docx/review/proofreadComments';
import { readWordDocument } from '@/services/docx/import/readWord';

installWordXmlDom();
const serializer = globalThis.XMLSerializer;
beforeAll(() => { globalThis.XMLSerializer = XmlSerializer as unknown as typeof XMLSerializer; });
afterAll(() => { globalThis.XMLSerializer = serializer; });
const sensitive = 'testing-address@example.test';
const text = `Contact ${sensitive} about ZQK.`;
const mark = '<w:bookmarkStart w:id="230000" w:name="DonDocsProofread0"/><w:bookmarkEnd w:id="230000"/>';
const humanStart = '<w:commentRangeStart w:id="0"/>';
const humanEnd = '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>';
const comments = `<w:comments xmlns:w="${WORD_NS}"><w:comment w:id="0" w:author="A. Reviewer">${wordParagraph('Human feedback')}</w:comment></w:comments>`;
function plan() {
  return planWordProofreadComments({
    documentCategory: 'correspondence', documentMode: 'custom', docType: 'naval_letter',
    formData: { classLevel: 'unclassified' },
    paragraphs: [{ id: 'lead', text: 'Synthetic lead sentence.', level: 0 }, { id: 'affected', text, level: 1 }],
    references: [], enclosures: [], copyTos: [], distributions: [],
  });
}

it('coalesces paragraph findings without including the matched sensitive text or abbreviation', () => {
  const { notes, bookmarks } = plan();
  expect([...bookmarks]).toEqual([['affected', 0]]);
  expect([...notes[0]].join(' ')).toMatch(/numbering.*abbreviation.*sensitive information/);
  expect([...notes[0]].join(' ')).not.toMatch(/testing-address|ZQK/);
});

it('anchors to the marked occurrence, preserves a reviewer’s existing comment, and strips the temporary bookmark', async () => {
  const bytes = await wordImportFixture(wordParagraph(text) + `<w:p>${mark}${humanStart}${wordRun(text)}${humanEnd}</w:p>`,
    { 'word/comments.xml': comments });
  const original = new Blob([new Uint8Array(bytes)]);
  const signal = new AbortController().signal;
  const result = await addWordProofreadComments(original, plan().notes, signal);
  const output = new Uint8Array(await result.arrayBuffer());
  const parsed = await readWordDocument(output, 'annotated.docx');
  expect(parsed.comments.map(comment => [comment.wordId, comment.author, comment.selection?.sourceIndex])).toEqual([
    ['0', 'A. Reviewer', 1], ['1', 'DonDocs Proofread', 1],
  ]);
  expect(parsed.comments[0].text).toBe('Human feedback');
  expect(parsed.comments[1].text).not.toContain(sensitive);
  const digest = await issuedProofreadCommentDigest(parsed.comments[1]);
  expect(digest).toMatch(/^[a-f0-9]{64}$/);
  const generated = parsed.comments[1], selection = generated.selection!;
  const longerContext = selection.context + ' A reviewer edited the paragraph.';
  const longer = { ...selection, context: longerContext, end: longerContext.length };
  expect(await issuedProofreadCommentDigest({ ...generated, selection: longer })).toBe(digest);
  expect(issuedProofreadCommentDigest({ ...generated, selection: { ...longer, start: 1 } })).toBeUndefined();
  expect(await issuedProofreadCommentDigest(generated, 'legacy')).not.toBe(digest);
  expect(issuedProofreadCommentDigest({ ...parsed.comments[1], text: 'Reviewer revised the note' })).toBeUndefined();
  expect(issuedProofreadCommentDigest(parsed.comments[0])).toBeUndefined();
  const zip = await JSZip.loadAsync(output);
  expect(await zip.file('word/document.xml')!.async('string')).not.toContain('DonDocsProofread0');
  expect(new Uint8Array(await original.arrayBuffer())).toEqual(bytes);
});

it('rejects duplicate placement markers and leaves a comment-free file unchanged when there is no plan', async () => {
  const signal = new AbortController().signal;
  const bytes = await wordImportFixture(`<w:p>${mark}${wordRun(text)}</w:p><w:p>${mark}${wordRun(text)}</w:p>`);
  const original = new Blob([new Uint8Array(bytes)]);
  await expect(addWordProofreadComments(original, plan().notes, signal)).rejects.toThrow('ambiguous Proofread placement');
  await expect(addWordProofreadComments(original, [], signal)).resolves.toBe(original);
});
