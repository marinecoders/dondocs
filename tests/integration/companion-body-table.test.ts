import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { letterSchema } from '../../companion/letterSchema';
import { validateLetter } from '../../companion/validateLetter';
import { renderDocx } from '../../companion/renderDocx';
const hasPandoc = spawnSync('pandoc', ['--version']).status === 0;
describe.skipIf(!hasPandoc)('companion body table Word rendering', () => {
  it('writes the requested geometry, styles and repeated header through actual system Pandoc', async () => {
    const input = letterSchema.parse({ docType: 'naval_letter', format: 'docx', subject: 'NATIVE COMPANION TABLE', paragraphs: [{ text: '', bodyTable: { rows: [['Name', 'Detail'], ['ALPHA', 'Retain all content']], headerRows: 1, columnWidths: [25, 75], columnAlignments: ['left', 'right'], fontSize: 10, borders: 'outline', minimumRowHeight: 24 } }] });
    expect(validateLetter(input)).toEqual([]);
    const zip = await JSZip.loadAsync(await renderDocx(input));
    const xml = await zip.file('word/document.xml')!.async('string');
    const table = (xml.match(/<w:tbl\b[\s\S]*?<\/w:tbl>/g) ?? []).find(value => value.includes('DonDocsBodyTable0'))!;
    expect(table).toContain('Retain all content');expect(table).toContain('<w:gridCol w:w="2340"/>');expect(table).toContain('<w:gridCol w:w="7020"/>');
    expect(table).toContain('<w:insideH w:val="nil"');expect(table).toContain('<w:jc w:val="right"/>');expect(table).toContain('<w:sz w:val="20"/>');
    expect(table.match(/<w:tblHeader\/>/g)).toHaveLength(1);
    expect(table).toContain('<w:wordWrap w:val="0"/>');
  });
});
