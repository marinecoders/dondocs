import { describe, expect, it } from 'vitest';
import { letterSchema } from '../../companion/letterSchema';
import { toStore } from '../../companion/letterInput';
import { validateLetter } from '../../companion/validateLetter';
import { publicationInputErrors } from '../../companion/publicationInput';
const table = { rows: [['Name', 'Detail'], ['ALPHA', 'Retain all content']], headerRows: 1, columnWidths: [25, 75], columnAlignments: ['left', 'right'] as const, fontSize: 10, borders: 'outline', minimumRowHeight: 24, repeatHeaders: true };
const source = { docType: 'naval_letter', format: 'docx', subject: 'NATIVE TABLE INPUT', paragraphs: [{ text: '', bodyTable: table }] };
describe('companion native body tables', () => {
  it.each(['naval_letter', 'business_letter'])('admits and retains complete %s table geometry before rendering', docType => {
    const input = letterSchema.parse({ ...source, docType });
    expect(validateLetter(input)).toEqual([]);
    expect(toStore(input).paragraphs[0].bodyTable).toEqual(table);
  });
  it('rejects malformed or incomplete table geometry at the request boundary', () => {
    expect(letterSchema.safeParse({ ...source, paragraphs: [{ text: '', bodyTable: { ...table, columnWidths: [25] } }] }).success).toBe(false);
    const input = letterSchema.parse(source);
    input.paragraphs![0].bodyTable!.columnWidths = [1, 99];
    expect(validateLetter(input).join(' ')).toContain('bodyTable requires a supported rectangular table');
    input.paragraphs![0].bodyTable!.rows = [];
    expect(() => letterSchema.safeParse(input)).not.toThrow();
    expect(letterSchema.safeParse(input).success).toBe(false);
    expect(validateLetter(input).join(' ')).toContain('bodyTable requires a supported rectangular table');
  });
  it.each([{ figure: { fileId: 'image' } }, { callout: 'note' }, { procedure: true }, { appendix: true }])('rejects conflicting native table content before invoking a renderer: %j', conflicting => {
    const input = letterSchema.parse({ ...source, paragraphs: [{ text: '', bodyTable: table, ...conflicting }] });
    expect(publicationInputErrors(input).join(' ')).toContain('choose only one');
    expect(validateLetter(input).join(' ')).toContain('native body table');
  });
});
