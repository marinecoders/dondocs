import { describe, expect, it } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import type { Paragraph } from '@/types/document';
import { generateAllLatexFiles, generateBodyTex } from '@/services/latex/generator';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { renderBodyTable } from '@/services/latex/bodyTable';
import { captureDocumentRevision, copyCapturedDocument } from '@/lib/capturedDocument';
import { projectRenderedDocument } from '@/lib/renderedDocument';
import { validateFigures } from '@/lib/figures';

const table: Paragraph = { text: 'A deliberate caption', header: 'Table heading', level: 0, portionMarking: 'U', bodyTable: { rows: [['Name', 'Date'], ['MARINE', '16 Nov 26']], headerRows: 1 } };
const image: Paragraph = { text: 'Image caption', header: 'Image heading', level: 0, portionMarking: 'U', figure: { placement: 'body', altText: 'A training diagram', portionMarking: 'CUI', width: 480, height: 240, type: 'image/png', name: 'diagram.png', fileRef: { id: 'att_image', name: 'diagram.png', size: 100, type: 'image/png' } } };
const source = (paragraphs: Paragraph[], docType = 'naval_letter') => ({ ...createBlankSession(undefined, docType), paragraphs, endItems: [], publicationTables: {} });

describe('native rich block exports', () => {
  it.each(['naval_letter', 'business_letter'])('retains table headings, captions and portion marks in both %s export sources', docType => {
    const pdf = generateBodyTex(source([table], docType)), word = generateFlatLatex(source([table], docType));
    for (const output of [pdf, word]) {
      for (const text of ['(U)', 'Table heading', 'A deliberate caption', 'Name', 'MARINE', '16 Nov 26']) expect(output).toContain(text);
      expect(output).toContain('longtable');
      expect(output).toContain('endhead');
    }
    expect(pdf).toContain('endfirsthead');
    expect(word).not.toContain('endfirsthead');
  });
  it('retains separate graphic and caption markings and marker-only body captions', () => {
    for (const paragraph of [image, { ...image, text: '', header: undefined }]) {
      for (const output of [generateBodyTex(source([paragraph])), generateFlatLatex(source([paragraph]))]) {
        expect(output).toContain('(CUI)'); expect(output).toContain('(U)'); expect(output).toContain('includegraphics');
      }
    }
    expect(generateBodyTex(source([image]))).toContain('Image heading');
    expect(generateFlatLatex(source([image]))).toContain('Image heading');
    expect(validateFigures([{ ...image, text: '' }]).some(finding => finding.message.includes('no title'))).toBe(false);
  });
  it('keeps table/image blocks out of paragraph numbering while collecting their actual image resource', () => {
    const document = source([{ text: 'Alpha prose.', level: 0 }, table, image, { text: 'Omega prose.', level: 0 }]);
    const files = generateAllLatexFiles(document);
    expect(files.figures).toHaveLength(1); expect(files.figures[0].ref.id).toBe('att_image');
    expect(files.texFiles['body.tex']).toMatch(/2\.~~Omega prose/);
    expect(generateFlatLatex(document)).toContain('Omega prose.');
  });
  it('preserves native table/image content through the real render projection without exposing the original Word metadata', () => {
    const original = source([table, image]);
    original.formData.wordSource = { name: 'original.docx', sha256: 'a'.repeat(64), retainedText: 'Hidden original comments', notices: [] };
    const captured = captureDocumentRevision({ documentId: 'render-test', epoch: 1, editSequence: 2, capturedAt: 1 }, original);
    const projected = copyCapturedDocument(projectRenderedDocument(captured)).document;
    expect(projected.paragraphs[0].bodyTable).toEqual(table.bodyTable);
    expect(projected.paragraphs[1].figure).toEqual(image.figure);
    expect(projected.formData.wordSource).toBeUndefined();
    expect(original.formData.wordSource?.retainedText).toBe('Hidden original comments');
    expect(projected.formData.classLevel).toBe('cui');
  });
  it('passes stable row/column/header coordinates to cell adapters and rejects incompatible block kinds', () => {
    const visited: string[] = [];
    renderBodyTable(table.bodyTable!, (text, row, column, header) => { visited.push(`${row}:${column}:${header}:${text}`); return text; });
    expect(visited).toEqual(['0:0:true:Name', '0:1:true:Date', '1:0:false:MARINE', '1:1:false:16 Nov 26']);
    for (const paragraph of [{ ...table, figure: image.figure }, { ...table, tableKey: 'items' }, { ...table, callout: 'warning' as const }]) {
      expect(() => generateBodyTex(source([paragraph]))).toThrow('own native block');
      expect(() => generateFlatLatex(source([paragraph]))).toThrow('own native block');
    }
  });
});
