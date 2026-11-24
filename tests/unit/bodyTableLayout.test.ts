import { captureDocumentRevision, copyCapturedDocument } from '@/lib/capturedDocument';
import { projectRenderedDocument } from '@/lib/renderedDocument';
import { createBlankSession } from '@/stores/documentStore';
import { mapCapturedText } from '@/lib/documentFields';
import { describe, expect, it } from 'vitest';
import { bodyTableRowHeight, bodyTableSchema, bodyTableWidths, bodyTableTwips, fitBodyTableColumn, resizeBodyTableBoundary, resizeBodyTableColumn, autofitBodyTable, type BodyTable } from '@/lib/bodyTable';
import { renderBodyTable } from '@/services/latex/bodyTable';
import { applyBodyTableLayouts } from '@/services/docx/bodyTables';

const source: BodyTable = { rows: [['Name', 'Description'], ['ALPHA', 'A longer readable text description']], headerRows: 1 };

describe('body table layout', () => {
  it('retains legacy defaults and rejects ambiguous, non-finite or incomplete widths', () => {
    expect(bodyTableSchema.parse(source)).toEqual(source);
    for (const widths of [[0, 100], [20], [20, 20], [NaN, 50], [Infinity, 50], [1, 99]]) expect(bodyTableSchema.safeParse({ ...source, columnWidths: widths }).success).toBe(false);
    expect(bodyTableSchema.safeParse({ ...source, columnAlignments: ['right'] }).success).toBe(false);
  });
  it('returns validation issues for missing rows even when column formatting is present', () => {
    for (const formatting of [{ columnWidths: [100] }, { columnAlignments: ['left'] }]) {
      expect(() => bodyTableSchema.safeParse({ rows: [], headerRows: 0, ...formatting })).not.toThrow();
      expect(bodyTableSchema.safeParse({ rows: [], headerRows: 0, ...formatting }).success).toBe(false);
    }
  });
  it('keeps exact total widths and printable minima through resize and autofit', () => {
    const table = { ...source, columnWidths: [25, 75] };
    expect(bodyTableWidths(table)).toEqual([25, 75]);
    expect(bodyTableTwips(table, 9360)).toEqual([2340, 7020]);
    for (const next of [resizeBodyTableColumn(table, 0, 150), resizeBodyTableColumn(table, 1, -5), autofitBodyTable(source)]) {
      expect(bodyTableSchema.safeParse(next).success).toBe(true);
      expect(next.columnWidths!.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100);
      expect(Math.min(...next.columnWidths!)).toBeGreaterThanOrEqual(5);
      expect(bodyTableTwips(next, 9360).reduce((sum, width) => sum + width, 0)).toBe(9360);
    }
  });
  it('uses proportionate PDF widths, alignment and content-preserving minimum heights', () => {
    const tex = renderBodyTable({ ...source, columnWidths: [25, 75], columnAlignments: ['right', 'center'], fontSize: 10, minimumRowHeight: 24, borders: 'outline', repeatHeaders: false }, value => value);
    expect(tex).toContain('0.250000\\textwidth'); expect(tex).toContain('0.750000\\textwidth');
    expect(tex).toContain('\\raggedleft'); expect(tex).toContain('\\centering'); expect(tex).toContain('\\fontsize{10}{12}');
    expect(tex).toContain('\\rule{0pt}{24pt}'); expect(tex).toContain('\\endfirsthead\n\\endhead');
    expect(tex.match(/A longer readable text description/g)).toHaveLength(1);
  });
  it('resizes adjacent columns while preserving the rest and can fit a single column', () => {
    const table = { rows: [['Larger first column', 'B', 'C']], headerRows: 0, columnWidths: [30, 35, 35] };
    expect(resizeBodyTableBoundary(table, 0, 90).columnWidths).toEqual([60, 5, 35]);
    expect(resizeBodyTableBoundary(table, 1, 0).columnWidths).toEqual([30, 5, 65]);
    expect(fitBodyTableColumn(table, 0).columnWidths![0]).toBeGreaterThan(55);
    expect(table.columnWidths).toEqual([30, 35, 35]);
  });
  it('inherits each row minimum, accepts an explicit zero, and rejects malformed overrides', () => {
    const table = { ...source, minimumRowHeight: 18, rowHeights: [null, 0] };
    expect(bodyTableRowHeight(table, 0)).toBe(18);
    expect(bodyTableRowHeight(table, 1)).toBe(0);
    for (const rowHeights of [[8], [Infinity, 5], [144.1, 0], [-1, 144], [1, 2, 3]]) {
      expect(bodyTableSchema.safeParse({ ...source, rowHeights }).success).toBe(false);
    }
  });
  it('retains every layout control through substitution and the real output projection', () => {
    const table: BodyTable = { ...source, columnWidths: [25, 75], columnAlignments: ['right', 'center'], borders: 'columns', fontSize: 10, minimumRowHeight: 24, rowHeights: [null, 42], wrap: false, repeatHeaders: false };
    const captured = captureDocumentRevision({ documentId: 'layout', epoch: 0, editSequence: 1, capturedAt: 1 }, { ...createBlankSession(), endItems: [], publicationTables: {}, paragraphs: [{ text: '', level: 0, bodyTable: table }] });
    const projected = copyCapturedDocument(projectRenderedDocument(mapCapturedText(captured, field => field.text))).document;
    expect(projected.paragraphs[0].bodyTable).toEqual(table);
  });
  it('refuses missing or duplicate generated table identities', () => {
    expect(() => applyBodyTableLayouts('<w:document/>', [source])).toThrow('missing');
    const table = '<w:tbl><w:bookmarkStart w:name="DonDocsBodyTable0"/></w:tbl>';
    expect(() => applyBodyTableLayouts(table + table, [source])).toThrow();
  });
});
