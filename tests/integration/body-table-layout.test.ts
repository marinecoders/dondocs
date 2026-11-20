import { bodyTableText } from '@/services/latex/bodyTableText';
import { DOMParser } from '@xmldom/xmldom';
import { PDFDocument } from 'pdf-lib';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { compileGeneratedFixture } from '../_helpers/compileLatex';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';
import { describe, expect, it } from 'vitest';
import { renderBodyTable } from '@/services/latex/bodyTable';
import { formatBodyTables } from '@/services/docx/bodyTables';
import type { BodyTable } from '@/lib/bodyTable';
import { compileGeneratedDocxFixture } from '../_helpers/compileDocx';
import JSZip from 'jszip';
const source: BodyTable = { rows: [['Name', 'Description'], ['ALPHA', 'A longer readable text description']], headerRows: 1 };
describe('actual Word body-table layout', () => {
  it('applies the shared layout to an actual Pandoc Word table without duplicating header content', async () => {
    const table: BodyTable = { ...source, columnWidths: [25, 75], columnAlignments: ['right', 'center'], borders: 'outline', fontSize: 10, minimumRowHeight: 24 };
    const latex = '\\documentclass{article}\n\\usepackage{longtable,array}\n\\begin{document}\n' + renderBodyTable(table, text => text, { repeatHeaders: false, wordIndex: 0 }) + '\\end{document}';
    const compiled = await compileGeneratedDocxFixture(latex);
    expect(compiled.ok, compiled.log).toBe(true);
    const bytes = await formatBodyTables(compiled.docxBytes!, [table]);
    const zip = await JSZip.loadAsync(bytes), xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('<w:gridCol w:w="2340"/>'); expect(xml).toContain('<w:gridCol w:w="7020"/>');
    expect(xml).toContain('<w:insideH w:val="nil"'); expect(xml).toContain('<w:jc w:val="right"/>');
    expect(xml).toContain('<w:trHeight w:val="480" w:hRule="atLeast"/>');
    expect(xml.match(/<w:tblHeader\/>/g)).toHaveLength(1);
    expect(xml.match(/A longer readable text description/g)).toHaveLength(1);
    expect(xml).toContain('<w:sz w:val="20"/>');
    const firstCell = xml.match(/<w:tbl\b[\s\S]*?<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/)![1];
    expect(firstCell.match(/<w:p(?:\s|>)/g), 'The generated table marker must not add a blank header line.').toHaveLength(1);
  }, 60_000);
});

describe('PDF table continuation', () => {
  describeToolchainRequirement('body tables');
  it.skipIf(!hasPdfToolchain)('renders every row and repeats only the chosen headers on actual PDF pages', async () => {
    const table: BodyTable = { rows: [['ROSTER HEADER', 'DETAIL HEADER'], ...Array.from({ length: 60 }, (_, index) => [`ITEM${String(index).padStart(3, '0')}`, `Retain this row ${index}.`])], headerRows: 1, columnWidths: [30, 70], borders: 'outline', fontSize: 10, minimumRowHeight: 28 };
    const body = renderBodyTable(table, text => text);
    const result = await compileGeneratedFixture({ 'main.tex': '\\documentclass{article}\n\\usepackage{longtable,array}\n\\begin{document}\n' + body + '\\end{document}' });
    expect(result.ok, result.logTail).toBe(true);
    const pdf = await PDFDocument.load(result.pdfBytes!);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    const text = spawnSync('pdftotext', ['-layout', join(result.workDir, 'main.pdf'), '-'], { encoding: 'utf8' });
    expect(text.status).toBe(0);
    for (let index = 0; index < 60; index++) expect(text.stdout.match(new RegExp(`ITEM${String(index).padStart(3, '0')}`, 'g'))).toHaveLength(1);
    expect(text.stdout.match(/DETAIL HEADER/g)).toHaveLength(pdf.getPageCount());
  });
});

describe('narrow table cell content', () => {
  it.skipIf(!hasPdfToolchain)('keeps unbroken identifiers, bold underscores and underlined URL-like text inside 5% columns', async () => {
    const template = await readFile(join(dirname(fileURLToPath(import.meta.url)), '../../tex/main.tex'), 'utf8');
    const underline = template.match(/\\makeatletter\n\\newcommand\{\\uline\}\[1\]\{[\s\S]*?\n\}\n\\makeatother/)?.[0];
    expect(underline, 'Use the PDF renderer’s bundled underline implementation.').toBeTruthy();
    const values = ['012345678901234567', '**ABCD_EFGHIJK123**', '__https://x.test/AB__', 'Retained wide column content.'];
    const table: BodyTable = { rows: [['A', 'B', 'C', 'D'], values], headerRows: 1, columnWidths: [5, 5, 5, 85], fontSize: 10 };
    const tex = '\\documentclass{article}\n\\usepackage[letterpaper,margin=1in]{geometry}\n\\usepackage{longtable,array}\n' + underline + '\n\\usepackage[T1]{fontenc}\n\\renewcommand{\\familydefault}{\\ttdefault}\n\\begin{document}\n' + renderBodyTable(table, text => bodyTableText(text)) + '\\end{document}';
    const result = await compileGeneratedFixture({ 'main.tex': tex, 'ulem.sty': '\\PackageError{DonDocs-test}{ulem is intentionally unavailable in this test}{}\n\\endinput' });
    expect(result.ok, result.logTail).toBe(true);
    const extracted = spawnSync('pdftotext', ['-bbox-layout', join(result.workDir, 'main.pdf'), '-'], { encoding: 'utf8' });
    expect(extracted.status).toBe(0);
    const xml = new DOMParser().parseFromString(extracted.stdout, 'text/xml');
    const words = Array.from(xml.getElementsByTagName('word')).filter(word => Number(word.getAttribute('yMin')) < 700);
    const starts = [72, 95.4, 118.8, 142.2], ends = [95.4, 118.8, 142.2, 540];
    const expected = ['A012345678901234567', 'BABCD_EFGHIJK123', 'Chttps://x.test/AB', 'DRetainedwidecolumncontent.'];
    for (let column = 0; column < starts.length; column++) {
      const cells = words.filter(word => Number(word.getAttribute('xMin')) >= starts[column] - 0.5 && Number(word.getAttribute('xMin')) < ends[column] - 0.5);
      expect(cells.map(word => word.textContent).join('')).toBe(expected[column]);
      expect(cells.every(word => Number(word.getAttribute('xMax')) <= ends[column] + 0.5)).toBe(true);
    }
  });
  it.skipIf(!hasPdfToolchain)('preserves empty lines inside a table cell', async () => {
    const table: BodyTable = { rows: [['FIRST\n\nSECOND']], headerRows: 0, fontSize: 10 };
    const tex = '\\documentclass{article}\n\\usepackage{longtable,array}\n\\begin{document}\n' + renderBodyTable(table, text => bodyTableText(text)) + '\\end{document}';
    const result = await compileGeneratedFixture({ 'main.tex': tex });
    expect(result.ok, result.logTail).toBe(true);
    const extracted = spawnSync('pdftotext', ['-bbox-layout', join(result.workDir, 'main.pdf'), '-'], { encoding: 'utf8' });
    expect(extracted.status).toBe(0);
    const xml = new DOMParser().parseFromString(extracted.stdout, 'text/xml');
    const words = Array.from(xml.getElementsByTagName('word'));
    const first = words.find(word => word.textContent === 'FIRST')!;
    const second = words.find(word => word.textContent === 'SECOND')!;
    expect(Number(second.getAttribute('yMin')) - Number(first.getAttribute('yMin'))).toBeGreaterThan(20);
  });
  it.skipIf(!hasPdfToolchain)('allows a tall body row that fits below its actual short header', async () => {
    const table: BodyTable = { rows: [['Header', 'Detail'], ['A tall readable cell', 'Adjacent']], headerRows: 1, columnWidths: [30, 70], fontSize: 10 };
    const tex = '\\documentclass{article}\n\\usepackage[letterpaper,margin=1in]{geometry}\n\\usepackage{longtable,array}\n\\begin{document}\n' + renderBodyTable(table, (text, row) => row ? '\\rule{0pt}{400pt}' + bodyTableText(text) : bodyTableText(text)) + '\\end{document}';
    const result = await compileGeneratedFixture({ 'main.tex': tex });
    expect(result.ok, result.logTail).toBe(true);
    const extracted = spawnSync('pdftotext', ['-layout', join(result.workDir, 'main.pdf'), '-'], { encoding: 'utf8' });
    expect(extracted.stdout).toContain('A tall readable cell');expect(extracted.stdout).toContain('Adjacent');
  });
  it.skipIf(!hasPdfToolchain)('allows a complete body row on the next page when header repetition is disabled', async () => {
    const table: BodyTable = { rows: [
      [Array.from({ length: 24 }, (_, index) => `ONCEHEADER${index}`).join('\n')],
      [Array.from({ length: 35 }, (_, index) => `CONTINUEDBODY${index}`).join('\n')],
    ], headerRows: 1, repeatHeaders: false, fontSize: 10 };
    const tex = '\\documentclass{article}\n\\usepackage[letterpaper,margin=1in]{geometry}\n\\usepackage{longtable,array}\n\\begin{document}\n' + renderBodyTable(table, text => bodyTableText(text)) + '\\end{document}';
    const result = await compileGeneratedFixture({ 'main.tex': tex });
    expect(result.ok, result.logTail).toBe(true);
    const pdf = await PDFDocument.load(result.pdfBytes!);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    const extracted = spawnSync('pdftotext', ['-layout', join(result.workDir, 'main.pdf'), '-'], { encoding: 'utf8' });
    expect(extracted.status).toBe(0);
    for (let index = 0; index < 24; index++) expect(extracted.stdout.match(new RegExp(`ONCEHEADER${index}(?![0-9])`, 'g'))).toHaveLength(1);
    for (let index = 0; index < 35; index++) expect(extracted.stdout.match(new RegExp(`CONTINUEDBODY${index}(?![0-9])`, 'g'))).toHaveLength(1);
  });
  it.skipIf(!hasPdfToolchain)('refuses a row taller than the printable page instead of clipping it', async () => {
    const table: BodyTable = { rows: [['ID', 'Detail'], ['X'.repeat(1000), 'Retain this content']], headerRows: 1, columnWidths: [5, 95], fontSize: 10 };
    const tex = '\\documentclass{article}\n\\usepackage[letterpaper,margin=1in]{geometry}\n\\usepackage{longtable,array}\n\\begin{document}\n' + renderBodyTable(table, text => bodyTableText(text)) + '\\end{document}';
    const result = await compileGeneratedFixture({ 'main.tex': tex });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ') + result.logTail).toContain('table row is too tall');
  });
});
