import { describe, expect, it } from 'vitest';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
import { wordImportFixture, wordParagraph, wordRun, WORD_NS } from '../_helpers/wordImportFixture';
import { readWordDocument } from '@/services/docx/import/readWord';
import { nativeWordComments } from '@/lib/wordComments';
import { createBlankSession } from '@/stores/documentStore';
import { describeCommentAnchor } from '@/lib/reviewCommentTargets';

installWordXmlDom();
const start = (id: number) => `<w:commentRangeStart w:id="${id}"/>`;
const end = (id: number) => `<w:commentRangeEnd w:id="${id}"/>`;
const definition = (id: number, text = 'Check this exact source.') => `<w:comment w:id="${id}" w:author="Chief Example" w:date="2026-11-16T10:30:00Z">${wordParagraph(text)}</w:comment>`;
async function imported(body: string, definitions: string) {
  const source = await wordImportFixture(body, {
    'word/comments.xml': `<w:comments xmlns:w="${WORD_NS}">${definitions}</w:comments>`,
    'word/_rels/document.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="comments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>',
  });
  const plan = await readWordDocument(source, 'review-comments.docx');
  const session = { ...createBlankSession(), paragraphs: plan.blocks.map(block => block.paragraph) };
  session.reviewComments = nativeWordComments(plan, session);
  return { plan, session, threads: session.reviewComments!.threads };
}

describe('Word discussions reuse native anchors without claiming author authentication', () => {
  it('maps UTF-16 selections across Word runs, including emoji and combining characters', async () => {
    const { session, threads } = await imported(`<w:p>${wordRun('Before 😀 ')}${start(1)}${wordRun('cafe\u0301 ')}${wordRun('words')}${end(1)}${wordRun(' after.')}</w:p>`, definition(1));
    const anchor = threads[0].anchor;
    expect(anchor.kind).toBe('range');
    if (anchor.kind !== 'range') throw new Error('Expected the exact imported selection');
    expect(anchor.start).toBe('Before 😀 '.length);
    expect(anchor.context.slice(anchor.start, anchor.end)).toBe('cafe\u0301 words');
    expect(describeCommentAnchor(session, anchor).status).toBe('current');
    expect(threads[0].messages[0].author).toBe('Chief Example (Word, unverified)');
    expect(threads[0].messages[0].text).toContain('author and date are unverified');
  });
  it('keeps bold native text and explicitly uses a paragraph discussion plus quoted Word selection', async () => {
    const { session, threads } = await imported(`<w:p>${wordRun('Purpose', '<w:b/>')}${wordRun(' before ')}${start(2)}${wordRun('selected words')}${end(2)}${wordRun(' after.')}</w:p>`, definition(2));
    expect(session.paragraphs[0].text).toBe('**Purpose** before selected words after.');
    expect(threads[0].anchor.kind).toBe('paragraph');
    expect(threads[0].messages[0].text).toContain('not an exact native text anchor');
    expect(threads[0].messages[0].text).toContain('Word selection: “selected words”');
    expect(describeCommentAnchor(session, threads[0].anchor).status).toBe('current');
  });
  it('never creates an exact range through the middle of a combining grapheme', async () => {
    const { threads } = await imported(`<w:p>${wordRun('cafe')}${start(1)}${wordRun('\u0301')}${end(1)}${wordRun(' body')}</w:p>`, definition(1));
    expect(threads[0].anchor.kind).toBe('paragraph');
    expect(threads[0].messages[0].text).toContain('not an exact native text anchor');
  });
  it('maps only the body text after a removed literal list label and retains header comments without guessing', async () => {
    const { session, threads } = await imported(`<w:p>${wordRun('Subj: ')}${start(1)}${wordRun('SOURCE SUBJECT')}${end(1)}</w:p><w:p>${wordRun('1. Before ')}${start(2)}${wordRun('selected')}${end(2)}</w:p>`, definition(1) + definition(2));
    expect(threads[0].anchor.kind).toBe('document');
    expect(threads[0].messages[0].text).toContain('Word selection: “SOURCE SUBJECT”');
    const anchor = threads[1].anchor;
    expect(anchor.kind).toBe('range');
    if (anchor.kind !== 'range') throw new Error('Expected normalized body selection');
    expect(anchor.context).toBe('Before selected');
    expect(anchor.context.slice(anchor.start, anchor.end)).toBe('selected');
    expect(session.paragraphs).toHaveLength(1);
  });
  it('retains cross-paragraph, cell and duplicate-range discussions as explicitly unresolved', async () => {
    const { plan, threads } = await imported(`<w:p>${start(1)}${wordRun('First')}</w:p><w:p>${wordRun('Second')}${end(1)}</w:p><w:tbl><w:tr><w:tc><w:p>${start(2)}${wordRun('Cell')}${end(2)}</w:p></w:tc></w:tr></w:tbl><w:p>${start(3)}${start(3)}${wordRun('Ambiguous')}${end(3)}</w:p>`, definition(1) + definition(2) + definition(3));
    expect(threads.map(thread => thread.anchor.kind)).toEqual(['document', 'document', 'document']);
    expect(plan.notices.join(' ')).toContain('spans paragraphs');
    expect(threads[1].messages[0].text).toContain('native cell-range review is not supported');
  });
  it('preserves inline line breaks, carriage returns, tabs and nonbreaking hyphens in review instructions', async () => {
    const comment = `<w:comment w:id="1" w:author="Chief Example"><w:p><w:r><w:t>Do not</w:t><w:br/><w:t>approve</w:t><w:cr/><w:t>until</w:t><w:tab/><w:t>corrected M</w:t><w:noBreakHyphen/><w:t>16.</w:t></w:r></w:p>${wordParagraph('Second paragraph.')}</w:comment>`;
    const { plan, threads } = await imported(`<w:p>${start(1)}${wordRun('Selected text')}${end(1)}</w:p>`, comment);
    const expected = 'Do not\napprove\nuntil\tcorrected M\u201116.\nSecond paragraph.';
    expect(plan.comments[0].text).toBe(expected);
    expect(threads[0].messages[0].text).toContain(expected);
    expect(threads[0].anchor).toMatchObject({ kind: 'range', start: 0, end: 13, context: 'Selected text' });
  });
  it('rejects duplicate comment definitions instead of attaching an arbitrary author/text', async () => {
    await expect(imported(`<w:p>${start(1)}${wordRun('Text')}${end(1)}</w:p>`, definition(1) + definition(1, 'Different author text'))).rejects.toThrow('unique, valid IDs');
  });
});
