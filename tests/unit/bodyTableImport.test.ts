import { describe, expect, it } from 'vitest';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
import { wordImportFixture, wordParagraph } from '../_helpers/wordImportFixture';
import { readWordDocument } from '@/services/docx/import/readWord';
installWordXmlDom();
const cells = `<w:tr><w:trPr><w:tblHeader/><w:trHeight w:val="480" w:hRule="atLeast"/></w:trPr><w:tc><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Name</w:t></w:r></w:p></w:tc><w:tc><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Description</w:t></w:r></w:p></w:tc></w:tr>`;
describe('supported Word table formatting import', () => {
  it('does not spread one explicit run size over text that inherits another Word size', async () => {
    const bytes = await wordImportFixture('<w:tbl><w:tr><w:tc><w:p><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Explicit ten</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Inherited twelve</w:t></w:r></w:p></w:tc></w:tr></w:tbl>', {
      'word/styles.xml': '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>',
    });
    const result = await readWordDocument(bytes, 'inherited-size.docx');
    expect(result.blocks[0].paragraph.bodyTable?.fontSize).toBeUndefined();
    expect(result.blocks[0].paragraph.bodyTable?.rows).toEqual([['Explicit ten', 'Inherited twelve']]);
    expect(result.notices.join(' ')).toMatch(/inherited|[Mm]ixed.*sizes/);
    expect(result.source.bytes).toEqual(bytes);
  });
  it('retains widths, column alignment, outline, text size and minimum height', async () => {
    const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(side => `<w:${side} w:val="${side.startsWith('inside') ? 'nil' : 'single'}"/>`).join('');
    const bytes = await wordImportFixture(`${wordParagraph('Introduction')}<w:tbl><w:tblPr><w:tblBorders>${borders}</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="2340"/><w:gridCol w:w="7020"/></w:tblGrid>${cells}</w:tbl>`);
    const result = await readWordDocument(bytes, 'layout.docx');
    expect(result.blocks.find(block => block.paragraph.bodyTable)?.paragraph.bodyTable).toEqual({ rows: [['Name', 'Description']], headerRows: 1, columnWidths: [25, 75], columnAlignments: ['right', 'center'], borders: 'outline', fontSize: 10, minimumRowHeight: 24 });
    expect(result.source.bytes).toEqual(bytes);
  });
  it('retains columns borders, individual row heights and no-wrap from editable Word cells', async () => {
    const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(side => `<w:${side} w:val="${side === 'insideH' ? 'nil' : 'single'}"/>`).join('');
    const header = cells.replaceAll('<w:tc>', '<w:tc><w:tcPr><w:noWrap/><w:tcFitText/></w:tcPr>');
    const body = header.replace('<w:tblHeader/>', '').replace('w:val="480"', 'w:val="960"');
    const bytes = await wordImportFixture(`<w:tbl><w:tblPr><w:tblBorders>${borders}</w:tblBorders></w:tblPr>${header}${body}</w:tbl>`);
    const result = await readWordDocument(bytes, 'columns.docx');
    expect(result.blocks[0].paragraph.bodyTable).toMatchObject({ headerRows: 1, borders: 'columns', wrap: false, rowHeights: [24, 48] });
    expect(result.source.bytes).toEqual(bytes);
  });
  it('reports repeated headers beyond the supported count without losing any row', async () => {
    const bytes = await wordImportFixture(`<w:tbl>${cells.repeat(4)}</w:tbl>`);
    const result = await readWordDocument(bytes, 'four-headers.docx');
    expect(result.blocks[0].paragraph.bodyTable?.rows).toHaveLength(4);
    expect(result.blocks[0].paragraph.bodyTable?.headerRows).toBe(3);
    expect(result.notices.join(' ')).toContain('more than three repeating header rows');
    expect(result.source.bytes).toEqual(bytes);
  });
  it('reports unsupported narrow columns while keeping every cell and the untouched original', async () => {
    const bytes = await wordImportFixture(`<w:tbl><w:tblGrid><w:gridCol w:w="1"/><w:gridCol w:w="9999"/></w:tblGrid>${cells}</w:tbl>`);
    const result = await readWordDocument(bytes, 'narrow.docx');
    expect(result.blocks[0].paragraph.bodyTable?.columnWidths).toBeUndefined();
    expect(result.blocks[0].paragraph.bodyTable?.rows).toEqual([['Name', 'Description']]);
    expect(result.notices.join(' ')).toContain('Very narrow');
    expect(result.source.bytes).toEqual(bytes);
  });
});
