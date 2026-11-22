import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { compileDocxFixture, formatDocxFailure } from '../_helpers/compileDocx';
import { buildBaseline } from '../_helpers/compileMatrix';
import { postProcessDocx } from '@/services/docx/pandoc-converter';
import { renderDocx } from '../../companion/renderDocx';

const available = (tool: string) => spawnSync(tool, ['--version']).status === 0;
describe.skipIf(!available('pdflatex') || !available('pandoc'))('letterhead mode real exports', () => {
  it.each(['full', 'title-only', 'preprinted'] as const)('renders %s without losing the body or printing hidden header content', async mode => {
    const store = buildBaseline('naval_letter');
    Object.assign(store.formData, { letterheadMode: mode, unitLine1: 'COMMAND-TITLE', unitLine2: 'SECONDARY-UNIT', unitAddress: 'HIDDEN-STREET\nTEST-CITY, VA 12345' });
    store.paragraphs = [{ id: 'mode-body', level: 0, text: 'BODYPROBE The original document body remains visible.' }];
    if (available('pdflatex')) {
      const result = await compileFixture(store);
      if (!result.ok) throw new Error(formatFailure(mode, result));
      const pdf = await getDocument({ data: new Uint8Array(result.pdfBytes!), useSystemFonts: false }).promise;
      try {
        const text = (await (await pdf.getPage(1)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ');
        expect(text).toContain('BODYPROBE');
        expect(text.includes('COMMAND-TITLE')).toBe(mode !== 'preprinted');
        expect(text.includes('SECONDARY-UNIT')).toBe(mode === 'full');
        expect(text.includes('HIDDEN-STREET')).toBe(mode === 'full');
      } finally { await pdf.destroy(); }
    }
    if (available('pandoc')) {
      const result = await compileDocxFixture(store);
      if (!result.ok) throw new Error(formatDocxFailure(mode, result));
      const blob = await postProcessDocx(new Blob([result.docxBytes! as BlobPart]), { docType: store.docType, letterheadMode: mode, letterheadColor: 'blue' });
      const zip = await JSZip.loadAsync(await blob.arrayBuffer());
      const xml = await zip.file('word/document.xml')!.async('string');
      expect(xml).toContain('BODYPROBE');
      expect(xml.includes('COMMAND-TITLE')).toBe(mode !== 'preprinted');
      expect(xml.includes('SECONDARY-UNIT')).toBe(mode === 'full');
      expect(xml.includes('HIDDEN-STREET')).toBe(mode === 'full');
      expect(xml.includes('<w:drawing>')).toBe(mode === 'full');
      if (mode === 'title-only') expect(xml).toContain('DonDocsTitleLetterhead');
      await writeFile(`${result.workDir}/qualified.docx`, new Uint8Array(await blob.arrayBuffer()));
    }
  }, 60_000);
  it('keeps every repeated title-only letterhead at ten points without styling body tables', async () => {
    const store = buildBaseline('naval_letter');
    Object.assign(store.formData, {
      letterheadMode: 'title-only', unitLine1: 'REPEATED-COMMAND-TITLE',
      appendEndorsement: true, endorsementBody: 'Acknowledged.', endorsementSigLast: 'FIRST',
      additionalEndorsements: [{ id: 'second', endorsementBody: 'Reviewed and forwarded.', endorsementSigLast: 'SECOND' }],
    });
    store.paragraphs = [{ id: 'body-table', level: 0, text: '', bodyTable: {
      rows: [['BODYTABLE-DEPARTMENT', 'Owner'], ['Operations', 'Training']], headerRows: 1, fontSize: 12,
    } }];
    const result = await compileDocxFixture(store);
    if (!result.ok) throw new Error(formatDocxFailure('repeated title', result));
    const blob = await postProcessDocx(new Blob([result.docxBytes! as BlobPart]), {
      docType: store.docType, letterheadMode: 'title-only', letterheadColor: 'blue',
      bodyTables: store.paragraphs.flatMap(paragraph => paragraph.bodyTable ? [paragraph.bodyTable] : []),
    });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    const tables = [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map(match => match[0]);
    const titles = tables.filter(table => table.includes('w:name="DonDocsTitleLetterhead'));
    expect(titles).toHaveLength(2);
    for (const title of titles) {
      expect(title).toContain('<w:sz w:val="20"/>');
      expect(title).toContain('<w:color w:val="00205B"/>');
    }
    const body = tables.find(table => table.includes('BODYTABLE-DEPARTMENT'))!;
    expect(body).toContain('<w:sz w:val="24"/>');
    expect(body).not.toContain('<w:sz w:val="20"/>');
  }, 60_000);

  it('preserves a first body table on preprinted stationery instead of treating DEPARTMENT as a header', async () => {
    const store = buildBaseline('business_letter');
    Object.assign(store.formData, { letterheadMode: 'preprinted', date: '', ssic: '', serial: '', to: '', subject: '' });
    store.paragraphs = [{ id: 'body-table', level: 0, text: '', bodyTable: {
      rows: [['DEPARTMENT', 'Officer', 'Status'], ['Operations', 'Training', 'Pending']],
      headerRows: 1, columnWidths: [20, 30, 50],
    } }];
    const result = await compileDocxFixture(store);
    if (!result.ok) throw new Error(formatDocxFailure('preprinted body table', result));
    const blob = await postProcessDocx(new Blob([result.docxBytes! as BlobPart]), {
      docType: store.docType, letterheadMode: 'preprinted', letterheadColor: 'blue',
      bodyTables: store.paragraphs.flatMap(paragraph => paragraph.bodyTable ? [paragraph.bodyTable] : []),
    });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    const first = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/)![0];
    expect(first).toContain('DEPARTMENT');
    expect(first).toContain('<w:tblGrid><w:gridCol w:w="1872"/><w:gridCol w:w="2808"/><w:gridCol w:w="4680"/></w:tblGrid>');
    expect(first).not.toMatch(/<w:sz w:val="(?:16|20)"/);
    expect(await zip.file('word/styles.xml')!.async('string')).toContain('<w:sz w:val="24"/>');
  }, 60_000);

  it.each(['blue', 'black'] as const)('styles companion title-only output at ten points in %s without changing body tables', async color => {
    const bytes = await renderDocx({ docType: 'naval_letter', unit: { name: 'COMPANION TITLE PROBE', letterheadMode: 'title-only', letterheadColor: color }, subject: 'Companion style qualification', paragraphs: [{ text: 'BODYPROBE Retain the body style.' }, { text: '', bodyTable: { rows: [['DEPARTMENT', 'VALUE'], ['Operations', 'Pending']], headerRows: 1 } }] });
    const zip = await JSZip.loadAsync(bytes), xml = await zip.file('word/document.xml')!.async('string');
    const tables = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g)!;
    const title = tables.find(table => table.includes('DonDocsTitleLetterhead'))!;
    expect(title).toContain('<w:sz w:val="20"/>');
    expect(title).toContain(`<w:color w:val="${color === 'black' ? '000000' : '00205B'}"/>`);
    const body = tables.find(table => table.includes('DEPARTMENT'))!;
    expect(body).not.toContain('<w:sz w:val="20"/>');
    expect(body).not.toContain('<w:color w:val="00205B"/>');
  }, 60_000);

  it.each(['naval_letter', 'business_letter', 'executive_correspondence', 'mf'])('embeds the selected seal and styles the companion %s full header without changing body text', async docType => {
    const bytes = await renderDocx({ docType, unit: { name: 'FULL HEADER PROBE', address: '123 TEST ADDRESS', letterheadMode: 'full', letterheadColor: 'black', seal: 'dod' }, subject: 'Full letterhead qualification', paragraphs: [{ text: 'BODYPROBE Keep the body at twelve points.' }] });
    const zip = await JSZip.loadAsync(bytes), xml = await zip.file('word/document.xml')!.async('string');
    const header = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/)![0];
    expect(header).toContain('<w:drawing>');
    expect(header).toContain('distL="0" distR="0" distT="0" distB="0"');
    expect(header).toContain('<w:tblInd w:type="dxa" w:w="-720"/>');
    expect(header).toContain('<w:left w:w="0" w:type="dxa"/>');
    expect(xml).toMatch(/<w:pgMar[^>]*w:top="720"/);
    expect(Object.keys(zip.files).filter(path => path.startsWith('word/media/') && !zip.files[path].dir)).toHaveLength(1);
    expect(header).toContain('<w:sz w:val="20"/>');
    expect(header).toContain('<w:sz w:val="16"/>');
    expect(header).toContain('<w:color w:val="000000"/>');
    expect(header).not.toContain('>image<');
    const body = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)!.find(paragraph => paragraph.includes('BODYPROBE'))!;
    expect(body).not.toMatch(/<w:sz w:val="(?:16|20)"/);
    expect(await zip.file('word/styles.xml')!.async('string')).toContain('<w:sz w:val="24"');
  }, 60_000);

});
