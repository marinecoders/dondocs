import { describe, expect, it } from 'vitest';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
import { wordImportFixture, wordParagraph, wordRun } from '../_helpers/wordImportFixture';
import { copyWordImport, readWordDocument } from '@/services/docx/import/readWord';

installWordXmlDom();
const inserted = (id: string, text: string, properties = '') => `<w:ins w:id="${id}" w:author="Word Chief" w:date="2026-11-16T12:00:00Z">${wordRun(text, properties)}</w:ins>`;
const deleted = (id: string, text: string, properties = '') => `<w:del w:id="${id}" w:author="Word Chief">${wordRun(text, properties).replaceAll('w:t', 'w:delText')}</w:del>`;

describe('bounded Word tracked text', () => {
  it('captures exact before/proposed markup for actual insertion, deletion and replacement XML', async () => {
    const body = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${wordRun('Purpose')}</w:p>`
      + `<w:p>${wordRun('1. Before ')}${deleted('1', 'old', '<w:b/>')}${inserted('2', 'new', '<w:b/>')}${wordRun(' after.')}</w:p>`
      + `<w:p>${wordRun('2. Keep ')}${deleted('3', 'obsolete ')}${wordRun('text.')}</w:p>`
      + `<w:p>${wordRun('3. One ')}${inserted('4', 'added ')}${wordRun('line.')}</w:p>`;
    const result = await readWordDocument(await wordImportFixture(body), 'tracked.docx');
    expect(result.trackedChangesIncomplete).toBe(false);
    expect(result.blocks[0].paragraph.header).toBe('Purpose');
    expect(result.blocks[1].paragraph.text).toBe('Before **old** after.');
    expect(result.trackedEdits?.map(edit => [edit.sourceIndex, edit.before, edit.proposed])).toEqual([
      [1, '1. Before **old** after.', '1. Before **new** after.'],
      [2, '2. Keep obsolete text.', '2. Keep text.'],
      [3, '3. One line.', '3. One added line.'],
    ]);
    expect(result.trackedEdits![0]).toMatchObject({ beforePlain: '1. Before old after.', proposedPlain: '1. Before new after.' });
    expect(result.trackedEdits![0].revisions).toEqual([
      { kind: 'insertion', id: '2', author: 'Word Chief', date: '2026-11-16T12:00:00Z' },
      { kind: 'deletion', id: '1', author: 'Word Chief' },
    ]);
    result.trackedEdits![0].proposed = 'caller mutation';
    expect(copyWordImport(result).trackedEdits![0].proposed).toBe('1. Before **new** after.');
  });

  it('declines heading, cell, nested, paragraph-mark and cross-paragraph revisions explicitly', async () => {
    const body = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${deleted('1', 'Old heading')}${inserted('2', 'New heading')}</w:p>`
      + `<w:tbl><w:tr><w:tc><w:p>${wordRun('Cell ')}${inserted('3', 'new')}</w:p></w:tc></w:tr></w:tbl>`
      + `<w:p>${wordRun('Nested ')}<w:ins w:id="4">${inserted('5', 'nested')}</w:ins></w:p>`
      + `<w:p><w:pPr><w:rPr><w:del w:id="6"/></w:rPr></w:pPr>${wordRun('Paragraph boundary')}</w:p>`
      + `<w:p>${wordRun('First ')}${inserted('7', 'cross')}</w:p><w:p>${wordRun('Second ')}${inserted('7', 'cross')}</w:p>`;
    const result = await readWordDocument(await wordImportFixture(body), 'unsupported.docx');
    expect(result.trackedEdits).toEqual([]);
    expect(result.trackedChangesIncomplete).toBe(true);
    expect(result.blocks[0].paragraph.header).toBe('Old heading');
    expect(result.notices.join(' ')).toContain('They are not native text suggestions');
    expect(result.source.retainedText).toContain('New heading');
    expect(result.source.retainedText).toContain('Nested nested');
  });

  it('preserves a baseline when newly inserted literal native markers cannot be represented', async () => {
    const source = await wordImportFixture(`<w:p>${wordRun('Keep exact baseline. ')}${inserted('1', '**literal**')}</w:p>`);
    const result = await readWordDocument(source, 'literal-after.docx');
    expect(result.blocks[0].paragraph.text).toBe('Keep exact baseline. ');
    expect(result.trackedEdits).toEqual([]);
    expect(result.trackedChangesIncomplete).toBe(true);
    expect(result.source.bytes).toEqual(source);
    expect(result.source.retainedText).toContain('**literal**');
  });

  it('keeps formatting and move-only revisions in the original with a visible limitation', async () => {
    const body = `<w:p><w:pPr><w:pPrChange w:id="1"/></w:pPr>${wordRun('Formatting baseline')}</w:p>`
      + `<w:p><w:moveFrom w:id="2">${wordRun('Moved text')}</w:moveFrom></w:p>`
      + `<w:p><w:moveTo w:id="2">${wordRun('Moved text')}</w:moveTo></w:p>`;
    const result = await readWordDocument(await wordImportFixture(body), 'moves.docx');
    expect(result.trackedEdits).toEqual([]);
    expect(result.trackedChangesIncomplete).toBe(true);
    expect(result.notices.join(' ')).toContain('Word tracked moves are not converted');
    expect(result.notices.join(' ')).toContain('Word tracked formatting');
  });

  it('bounds a large set of revisions without changing the imported baseline', async () => {
    const result = await readWordDocument(await wordImportFixture(Array.from({ length: 101 }, (_, i) => `<w:p>${wordRun(`Baseline ${i} `)}${inserted(String(i), 'new')}</w:p>`).join('')), 'many.docx');
    expect(result.trackedEdits).toEqual([]);
    expect(result.trackedChangesIncomplete).toBe(true);
    expect(result.blocks).toHaveLength(101);
    expect(result.notices.join(' ')).toContain('No tracked edits were converted');
  });

  it('allows a text-only deletion to empty the paragraph without inventing structural deletion', async () => {
    const result = await readWordDocument(await wordImportFixture(`<w:p>${deleted('1', 'Delete this text.')}</w:p>${wordParagraph('Keep another paragraph.')}`), 'delete-text.docx');
    expect(result.trackedEdits![0]).toMatchObject({ before: 'Delete this text.', proposed: '' });
    expect(result.trackedChangesIncomplete).toBe(false);
    expect(result.blocks).toHaveLength(2);
  });
  it('keeps a typed incomplete assessment alongside supported edits, independently of notice wording', async () => {
    const body = `<w:p>${wordRun('Keep ')}${inserted('1', 'supported ')}${wordRun('text.')}</w:p>`
      + `<w:p><w:pPr><w:pPrChange w:id="2"/></w:pPr>${wordRun('Unsupported formatting change.')}</w:p>`;
    const result = await readWordDocument(await wordImportFixture(body), 'mixed-tracking.docx');
    expect(result.trackedEdits).toHaveLength(1);
    expect(result.trackedChangesIncomplete).toBe(true);
    result.trackedChangesIncomplete = false;
    result.notices = [];
    expect(copyWordImport(result).trackedChangesIncomplete).toBe(true);
  });

  it('declines tracked table-level property exceptions in an actual retained DOCX', async () => {
    const body = '<w:tbl><w:tr><w:tblPrEx><w:tblW w:w="14400" w:type="dxa"/><w:tblPrExChange w:id="0"><w:tblPrEx><w:tblW w:w="0" w:type="auto"/></w:tblPrEx></w:tblPrExChange></w:tblPrEx><w:tc>' + wordParagraph('Table cell') + '</w:tc></w:tr></w:tbl>' + wordParagraph('Keep body.');
    const bytes = await wordImportFixture(body), result = await readWordDocument(bytes, 'table-properties.docx');
    expect(result.trackedChangesIncomplete).toBe(true);
    expect(result.trackedEdits).toEqual([]);
    expect(result.notices.join(' ')).toContain('not converted');
    expect(result.source.bytes).toEqual(bytes);
  });

  it.each(['customXmlIns', 'customXmlDel', 'customXmlMoveFrom', 'customXmlMoveTo'])('declines the standard %s range pair and preserves the baseline', async kind => {
    const result = await readWordDocument(await wordImportFixture(`<w:p><w:${kind}RangeStart w:id="1"/>${wordRun('Keep baseline.')}<w:${kind}RangeEnd w:id="1"/></w:p>`), 'custom-xml.docx');
    expect(result.trackedChangesIncomplete).toBe(true); expect(result.trackedEdits).toEqual([]);
    expect(result.notices.join(' ')).toContain('not converted');
    expect(result.blocks[0].paragraph.text).toBe('Keep baseline.');
  });

  it.each(['customXmlInsRangeStart', 'customXmlInsRangeEnd', 'customXmlDelRangeStart', 'customXmlDelRangeEnd', 'customXmlMoveFromRangeStart', 'customXmlMoveFromRangeEnd', 'customXmlMoveToRangeStart', 'customXmlMoveToRangeEnd', 'moveFromRangeEnd', 'moveToRangeEnd'])('fails closed for an unmatched %s marker', async name => {
    const result = await readWordDocument(await wordImportFixture(`<w:p><w:${name} w:id="1"/>${wordRun('Baseline.')}</w:p>`), 'range-boundary.docx');
    expect(result.trackedChangesIncomplete).toBe(true);
    expect(result.notices.join(' ')).toContain('not converted');
  });

  it.each(['conflictIns', 'conflictDel', 'customXmlConflictInsRangeStart', 'customXmlConflictInsRangeEnd', 'customXmlConflictDelRangeStart', 'customXmlConflictDelRangeEnd'])('declines the Office conflict extension %s rather than certifying complete text', async name => {
    const result = await readWordDocument(await wordImportFixture(`<w:p><w14:${name} xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" w:id="1"/>${wordRun('Baseline.')}</w:p>`), 'conflict-extension.docx');
    expect(result.trackedChangesIncomplete).toBe(true);
    expect(result.notices.join(' ')).toContain('not converted');
  });

  it('does not partially convert text inside a paragraph with unsupported tracked custom markup', async () => {
    const result = await readWordDocument(await wordImportFixture(`<w:p><w:customXmlDelRangeStart w:id="1"/>${wordRun('Keep ')}${inserted('2', 'new ')}${wordRun('text.')}<w:customXmlDelRangeEnd w:id="1"/></w:p>`), 'mixed-range.docx');
    expect(result.trackedChangesIncomplete).toBe(true); expect(result.trackedEdits).toEqual([]);
  });

  it('declines tracked field instructions and revisions without a representable text change', async () => {
    for (const body of [
      `<w:p>${wordRun('Keep baseline.')}<w:del w:id="1"><w:r><w:delInstrText>AUTHOR</w:delInstrText></w:r></w:del></w:p>`,
      `<w:p>${wordRun('Keep ')}${deleted('1', 'same')}${inserted('2', 'same')}${wordRun(' text.')}</w:p>`,
    ]) {
      const result = await readWordDocument(await wordImportFixture(body), 'non-text-revision.docx');
      expect(result.trackedChangesIncomplete).toBe(true); expect(result.trackedEdits).toEqual([]);
      expect(result.notices.join(' ')).toContain('not native text suggestions');
    }
  });

});
