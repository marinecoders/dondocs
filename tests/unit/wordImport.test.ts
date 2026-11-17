import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
import { readWordDocument, copyWordImport, wordImageBytes } from '@/services/docx/import/readWord';
import { readWordArchive, wordXml } from '@/services/docx/import/archive';
import { createBlankSession } from '@/stores/documentStore';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { wordDrawing, wordImportFixture, wordParagraph, wordRun } from '../_helpers/wordImportFixture';
installWordXmlDom();

describe('bounded native Word reader', () => {
  it('rejects a real Unicode ZIP-path alias that would replace the main document', async () => {
    const control = readFileSync(resolve('tests/fixtures/word/zip-unicode-control.docx'));
    const alias = readFileSync(resolve('tests/fixtures/word/zip-unicode-alias.docx'));
    expect(new TextDecoder().decode((await readWordArchive(control)).get('word/document.xml'))).toContain('baseline');
    await expect(readWordArchive(alias)).rejects.toThrow('aliased');
  });
  it('retains ordered native text, emphasis, rectangular cells and real image bytes', async () => {
    const source = await wordImportFixture(`<w:p>${wordRun('Opening ')}${wordRun('important', '<w:b/>')}</w:p><w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc>${wordParagraph('Name')}</w:tc><w:tc>${wordParagraph('Date')}</w:tc></w:tr><w:tr><w:tc>${wordParagraph('MARINE')}</w:tc><w:tc>${wordParagraph('16 Nov 26')}</w:tc></w:tr></w:tbl><w:p>${wordDrawing}</w:p>${wordParagraph('Closing')}`);
    const result = await readWordDocument(source, 'review.docx');
    expect(result.blocks.map(block => block.paragraph.text)).toEqual(['Opening **important**', '', 'Source image', 'Closing']);
    expect(result.blocks[1].paragraph.bodyTable).toEqual({ rows: [['Name', 'Date'], ['MARINE', '16 Nov 26']], headerRows: 1 });
    expect(result.blocks[2].paragraph.figure).toMatchObject({ type: 'image/png', width: 1, height: 1, placement: 'body', altText: 'A green test square' });
    expect(wordImageBytes(result, result.blocks[2].paragraph.id!)?.slice(0, 4)).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(result.source.bytes).toEqual(source);
    result.source.bytes[0] = 0; result.blocks[0].paragraph.text = 'caller mutation';
    expect(copyWordImport(result).blocks[0].paragraph.text).toBe('Opening **important**');
    expect(copyWordImport(result).source.bytes[0]).toBe(80);
  });

  it.each(['**literal**', '*x*', '__name__', '\\textbf{literal}'])('rejects source-literal native markers before their visible text can change: %s', async literal => {
    const source = await wordImportFixture(wordParagraph(`The Word source literally contains ${literal}.`));
    await expect(readWordDocument(source, 'literal.docx')).rejects.toThrow('literal formatting markers');
  });

  it('keeps supported list nesting and names every unpreserved cell image, hyperlink and field', async () => {
    const list = (level: number, text: string) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr></w:pPr>${wordRun(text)}</w:p>`;
    const result = await readWordDocument(await wordImportFixture(`${list(0, 'Main')}${list(1, 'Nested')}<w:p><w:hyperlink w:anchor="target">${wordRun('Named link')}</w:hyperlink><w:fldSimple w:instr="DATE">${wordRun('16 Nov 26')}</w:fldSimple></w:p><w:tbl><w:tr><w:tc><w:p>${wordDrawing}</w:p></w:tc></w:tr></w:tbl>`), 'structure.docx');
    expect(result.blocks.slice(0, 2).map(block => block.paragraph.level)).toEqual([0, 1]);
    expect(result.plainText).toContain('Named link16 Nov 26');
    expect(result.notices.join('\n')).toMatch(/Images inside table cells/);
    expect(result.notices.join('\n')).toMatch(/link destinations/);
    expect(result.notices.join('\n')).toMatch(/Fields/);
  });

  it('retains a representable Heading1/2/3 hierarchy with intervening body paragraphs', async () => {
    const heading = (depth: number, text: string) => `<w:p><w:pPr><w:pStyle w:val="Heading${depth}"/></w:pPr>${wordRun(text)}</w:p>`;
    const source = await wordImportFixture(`${heading(1, 'Main heading')}${wordParagraph('Main body')}${heading(2, 'Nested heading')}${wordParagraph('Nested body')}${heading(3, 'Deep heading')}`);
    const result = await readWordDocument(source, 'outline.docx');
    expect(result.blocks.map(block => block.paragraph.level)).toEqual([0, 0, 1, 1, 2]);
    expect(result.blocks.map(block => block.paragraph.header ?? block.paragraph.text)).toEqual(['Main heading', 'Main body', 'Nested heading', 'Nested body', 'Deep heading']);
    expect(result.sourceBlocks.map(block => block.sourceIndex)).toEqual([0, 1, 2, 3, 4]);
    const skipped = await readWordDocument(await wordImportFixture(heading(3, 'Skipped heading')), 'skipped.docx');
    expect(skipped.blocks[0].paragraph.level).toBe(0);
    expect(skipped.notices.join(' ')).toContain('Skipped heading or list levels');
  });

  it('preserves rich introductory content before numbered prose and maps automatic-list headers once', async () => {
    const header = `${wordParagraph('From: Office')}${wordParagraph('To: Marine')}${wordParagraph('Subj: SOURCE TITLE')}`;
    const rich = await readWordDocument(await wordImportFixture(`${header}${wordParagraph('An important introduction.')}<w:tbl><w:tr><w:tc>${wordParagraph('KEEP PREFIX TABLE')}</w:tc></w:tr></w:tbl><w:p>${wordDrawing}</w:p>${wordParagraph('1. Take action.')}`), 'prefix.docx');
    expect(rich.headerFields).toEqual({ from: 'Office', to: 'Marine', subject: 'SOURCE TITLE' });
    expect(rich.blocks.map(block => block.paragraph.text)).toEqual(['An important introduction.', '', 'Source image', 'Take action.']);
    expect(rich.blocks[1].paragraph.bodyTable?.rows).toEqual([['KEEP PREFIX TABLE']]);
    expect(rich.notices.join(' ')).toContain('introductory content stays');
    const automatic = await readWordDocument(await wordImportFixture(`${header}<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Automatic body</w:t></w:r></w:p>`), 'automatic.docx');
    expect(automatic.blocks.map(block => block.paragraph.text)).toEqual(['Automatic body']);
    expect(automatic.sourceBlocks.length).toBe(4);
  });

  it('inventories retained Word text in a genuinely linked nested header part', async () => {
    const source = await wordImportFixture(wordParagraph('Visible body'), {
      'word/headers/header1.xml': '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>CUI</w:t></w:r></w:p><w:p><w:del><w:r><w:delText>(S) Deleted header text remains</w:delText></w:r></w:del></w:p></w:hdr>',
      'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>Visible body</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="nested-header"/></w:sectPr></w:body></w:document>',
      'word/_rels/document.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="nested-header" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="headers/header1.xml"/></Relationships>',
    });
    const result = await readWordDocument(source, 'nested-header.docx');
    expect(result.source.retainedText).toContain('CUI');
    expect(result.source.retainedText).toContain('(S) Deleted header text remains');
    expect(result.blocks.map(block => block.paragraph.text)).toEqual(['Visible body']);
  });

  it('rejects an alternate selected main document even when a benign conventional decoy exists', async () => {
    const source = await wordImportFixture(wordParagraph('Benign decoy'), {
      '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/actual.xml"/></Relationships>',
      'word/actual.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Different actual document</w:t></w:r></w:p></w:body></w:document>',
    });
    await expect(readWordDocument(source, 'alternate-main.docx')).rejects.toThrow('main-document relationship');
  });

  it('inventories a valid outside-word header and refuses external headers without fetching them', async () => {
    const relation = (target: string, external = '') => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="outside-header" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="${target}" ${external}/></Relationships>`;
    const body = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>Visible body</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="outside-header"/></w:sectPr></w:body></w:document>';
    const source = await wordImportFixture('', {
      'headers/outside.xml': '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>CUI</w:t></w:r></w:p></w:hdr>',
      'word/document.xml': body,
      'word/_rels/document.xml.rels': relation('../headers/outside.xml'),
    });
    expect((await readWordDocument(source, 'outside-header.docx')).source.retainedText).toContain('CUI');
    await expect(readWordDocument(await wordImportFixture('', { 'word/document.xml': body, 'word/_rels/document.xml.rels': relation('https://example.invalid/header.xml', 'TargetMode="External"') }), 'external-header.docx')).rejects.toThrow('External Word headers');
  });

  it('maps a real previously exported DonDocs letter without duplicating its five layout tables', async () => {
    const bytes = readFileSync(resolve('tests/fixtures/word/dondocs-naval-deep.docx'));
    const result = await readWordDocument(bytes, 'dondocs-naval-deep.docx');
    expect(result.blocks).toHaveLength(20);
    expect(result.blocks.some(block => block.paragraph.bodyTable)).toBe(false);
    expect(result.blocks.slice(0, 6).map(block => block.paragraph.level)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(result.blocks[4].paragraph.text).toMatch(/^DEPTH4 /);
    expect(result.headerFields).toMatchObject({ from: 'Commanding Officer, 1st Battalion, 6th Marines', to: 'Commanding General, II Marine Expeditionary Force', subject: 'WORD LAYOUT QUALIFICATION', ssic: '1000', serial: 'S-3/0123', date: '15 Jan 26', signature: { first: 'J', middle: 'A', last: 'DOE' }, unitLine1: '1ST BATTALION, 6TH MARINES', unitLine2: '2D MARINE DIVISION, II MEF', unitAddress: 'PSC BOX 20123, CAMP LEJEUNE, NC 28542-0123' });
    expect(result.headerFields.references).toHaveLength(12);
    expect(result.notices.join(' ')).toContain('scaffolding use native fields');
    expect(result.source.bytes).toEqual(new Uint8Array(bytes));
  });

  it.each([['DEPARTMENT OF THE NAVY', 'navy'], ['DEPARTMENT OF DEFENSE', 'dod']] as const)('maps the actual %s Word header to its supported native department token', async (label, token) => {
    const zip = await JSZip.loadAsync(readFileSync(resolve('tests/fixtures/word/dondocs-naval-deep.docx')));
    zip.file('word/document.xml', (await zip.file('word/document.xml')!.async('string')).replace('UNITED STATES MARINE CORPS', label));
    const result = await readWordDocument(await zip.generateAsync({ type: 'uint8array' }), 'department.docx');
    expect(result.headerFields.department).toBe(token);
    const session = createBlankSession();
    Object.assign(session.formData, result.headerFields);
    session.paragraphs = result.blocks.map(block => block.paragraph);
    expect(generateFlatLatex(session)).toContain(label);
    expect(generateFlatLatex(session)).not.toContain('UNITED STATES MARINE CORPS');
    expect(Object.values(generateAllLatexFiles(session).texFiles).join('\n')).toContain(`\\setDepartment{${token}}`);
  });

  it('normalizes underlined parenthesized counters without retaining duplicate printed designators', async () => {
    const source = await wordImportFixture(`<w:p>${wordRun('(1)', '<w:u w:val="single"/>')}${wordRun(' Deep numeric')}</w:p><w:p>${wordRun('(a)', '<w:u w:val="single"/>')}${wordRun(' Deep alphabetic')}</w:p>`);
    const result = await readWordDocument(source, 'deep-parentheses.docx');
    expect(result.blocks.map(block => [block.paragraph.level, block.paragraph.text])).toEqual([[6, 'Deep numeric'], [7, 'Deep alphabetic']]);
    expect(result.blocks.map(block => block.nativeTextOffset)).toEqual([4, 4]);
  });

  it('keeps a genuine prefix table and ambiguous repeated field scaffolding instead of dropping either', async () => {
    const fieldTable = '<w:tbl><w:tr><w:tc>' + wordParagraph('From:') + '</w:tc><w:tc>' + wordParagraph('Office') + '</w:tc></w:tr><w:tr><w:tc>' + wordParagraph('To:') + '</w:tc><w:tc>' + wordParagraph('Marine') + '</w:tc></w:tr><w:tr><w:tc>' + wordParagraph('Subj:') + '</w:tc><w:tc>' + wordParagraph('SOURCE') + '</w:tc></w:tr></w:tbl>';
    const actualTable = '<w:tbl><w:tr><w:tc>' + wordParagraph('Name') + '</w:tc><w:tc>' + wordParagraph('MARINE') + '</w:tc></w:tr></w:tbl>';
    const result = await readWordDocument(await wordImportFixture(fieldTable + fieldTable + wordParagraph('Important introduction') + actualTable + wordParagraph('1. Action')), 'ambiguous-fields.docx');
    expect(result.blocks.filter(block => block.paragraph.bodyTable)).toHaveLength(3);
    expect(result.blocks.some(block => block.paragraph.text === 'Important introduction')).toBe(true);
    expect(result.headerFields.from).toBeUndefined();
    expect(result.notices.join(' ')).toContain('ambiguous Word header');
  });

  it('never fetches linked images or accepts namespace-spoofed Word text', async () => {
    const linked = await wordImportFixture(`<w:p>${wordDrawing}</w:p>`, { 'word/_rels/document.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/private.png" TargetMode="External"/></Relationships>' });
    const result = await readWordDocument(linked, 'linked.docx');
    expect(result.blocks).toEqual([]);
    expect(result.notices.join(' ')).toContain('no external image was fetched');
    await expect(readWordDocument(await wordImportFixture('<w:p><other:t xmlns:other="urn:wrong">Do not import</other:t></w:p>'), 'wrong.docx')).rejects.toThrow('namespace');
  });

  it('rejects malformed/nonrectangular tables and deep or entity-bearing XML before use', async () => {
    await expect(readWordDocument(await wordImportFixture('<w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr><w:tr><w:tc><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>'), 'bad.docx')).rejects.toThrow();
    expect(() => wordXml(new TextEncoder().encode('<!DOCTYPE x [<!ENTITY y "x">]><x/>'), 'test')).toThrow('entities');
    expect(() => wordXml(new TextEncoder().encode('<x>'.repeat(65) + '</x>'.repeat(65)), 'test')).toThrow('deeply');
  });

  it('bounds real inflated bytes and honours already-cancelled operations', async () => {
    const archive = new JSZip(); archive.file('large.bin', 'x'.repeat(10 * 1024 * 1024 + 1));
    await expect(readWordArchive(await archive.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))).rejects.toThrow('expanded-content');
    const controller = new AbortController(); controller.abort();
    await expect(readWordDocument(await wordImportFixture(wordParagraph('Text')), 'cancel.docx', controller.signal)).rejects.toThrow();
  });
});
