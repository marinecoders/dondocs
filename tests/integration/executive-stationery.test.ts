import { describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { pdfImages } from '../_helpers/pdfImages';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { compileGeneratedDocxFixture } from '../_helpers/compileDocx';
import { PDFDocument, PDFArray, PDFDict, PDFName, PDFNumber } from 'pdf-lib';
import { finishCorrespondencePdf } from '@/services/pdf/finishCorrespondencePdf';
import { generateAllLatexFiles } from '@/services/latex/generator';
import JSZip from 'jszip';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { compileDocxFixture, formatDocxFailure } from '../_helpers/compileDocx';
import { buildBaseline } from '../_helpers/compileMatrix';
import { postProcessDocx } from '@/services/docx/pandoc-converter';
import { validateLetter } from '../../companion/validateLetter';
import { stationeryIssues } from '@/lib/stationery';
import { correspondenceStationery } from '@/lib/stationery';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';
import { renderDocx } from '../../companion/renderDocx';

describeToolchainRequirement('executive flag stationery');
describe.skipIf(!hasPdfToolchain)('executive flag stationery output', () => {
  it.each(['7x9', '5x7'] as const)('qualifies %s paper, body indents, dates, closing and Word tables', async size => {
    const source = buildBaseline('executive_correspondence');
    Object.assign(source.formData, { stationerySize: size, letterheadMode: 'preprinted', subject: '',
      date: 'November21,2026', salutation: 'Dear Admiral:', complimentaryClose: 'Sincerely,', sigFirst: 'A', sigMiddle: '', sigLast: 'SMITH', sigRank: '', sigTitle: '', signatureType: 'none',
      to: '', fontSize: '12pt', fontFamily: 'times' });
    source.paragraphs = [{ id: 'first', text: 'BODYPROBE Thank you for your support.', level: 0 },
      { id: 'table', text: '', level: 0, bodyTable: { rows: [['First', 'Second'], ['Value', 'Result']], headerRows: 1 } }];
    const stock = correspondenceStationery(source.docType, source.formData);
    const pdf = await compileFixture(source);
    expect(pdf.ok, formatFailure(size, pdf)).toBe(true);
    const document = await PDFDocument.load(pdf.pdfBytes!);
    expect(document.getPages().map(page => page.getSize())).toEqual(Array.from({ length: document.getPageCount() }, () => ({ width: stock.width * 72, height: stock.height * 72 })));
    const { boxes, collisions } = await pdfTextLayout(pdf.pdfBytes!);
    expect(collisions).toEqual([]);
    expect(boxes.find(box => box.text.startsWith('BODYPROBE'))?.left).toBeCloseTo(108, 0);
    expect(boxes.find(box => box.text === 'Sincerely,')?.left).toBeCloseTo(stock.width * 36, 0);
    const date = boxes.find(box => box.text === 'November21,2026')!;
    if (size === '7x9') expect((date.left + date.right) / 2).toBeCloseTo(stock.width * 36, 0);
    else expect(date.right).toBeCloseTo((stock.width - 1) * 72, 0);
    expect(boxes.every(box => box.left >= 71 && box.right <= (stock.width - 1) * 72 + 1)).toBe(true);
    const word = await compileDocxFixture(source);
    expect(word.ok, formatDocxFailure(size, word)).toBe(true);
    const processed = await postProcessDocx(new Blob([word.docxBytes! as BlobPart]), { docType: source.docType, stationerySize: size, letterheadMode: 'preprinted', bodyTables: source.paragraphs.flatMap(paragraph => paragraph.bodyTable ? [paragraph.bodyTable] : []) });
    await writeFile(`${word.workDir}/qualified.docx`, new Uint8Array(await processed.arrayBuffer()));
    const xml = await (await JSZip.loadAsync(await processed.arrayBuffer())).file('word/document.xml')!.async('string');
    expect(xml).toContain(`w:w="${stock.width * 1440}" w:h="${stock.height * 1440}"`);
    expect(xml).toContain('w:firstLine="720"');
    const dateParagraph = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)!.find(paragraph => paragraph.includes('November21,2026'))!;
    expect(dateParagraph).toContain(`w:val="${size === '7x9' ? 'center' : 'right'}"`);
    expect(xml).toContain('Sincerely,');
    expect(xml.includes(String.fromCharCode(8))).toBe(false);
    expect(xml.includes(String.fromCharCode(11))).toBe(false);
    for (const grid of xml.matchAll(/<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/g)) expect([...grid[1].matchAll(/w:w="(\d+)"/g)].reduce((sum, match) => sum + Number(match[1]), 0)).toBe(stock.textWidth * 1440);
    const companion = await renderDocx({ docType: source.docType, unit: { stationerySize: size, letterheadMode: 'preprinted' }, subject: 'Flag correspondence', paragraphs: [{ text: 'Shared companion body.' }], signature: { first: 'A', last: 'SMITH' } });
    const companionXml = await (await JSZip.loadAsync(companion)).file('word/document.xml')!.async('string');
    expect(companionXml).toContain(`w:w="${stock.width * 1440}" w:h="${stock.height * 1440}"`);
    console.info(`Qualified ${size}: PDF ${pdf.workDir}, DOCX ${word.workDir}`);
  }, 60_000);
  it('keeps subsequent small sheets plain and preserves every paragraph', async () => {
    const source = buildBaseline('executive_correspondence');
    Object.assign(source.formData, { stationerySize: '5x7', letterheadMode: 'title-only', unitLine1: 'AUTHORIZED TITLE', subject: '', date: '', to: '', signatureType: 'none' });
    source.paragraphs = Array.from({ length: 30 }, (_, index) => ({ id: `body-${index}`, level: 0, text: `Record ${index}. Coordinate the complete action and preserve the approved instructions.` }));
    const result = await compileFixture(source);
    expect(result.ok, formatFailure('multipage small stationery', result)).toBe(true);
    const document = await PDFDocument.load(result.pdfBytes!);
    expect(document.getPageCount()).toBeGreaterThan(1);
    const { boxes, collisions } = await pdfTextLayout(result.pdfBytes!);
    expect(collisions).toEqual([]);
    expect(boxes.filter(box => box.text.includes('AUTHORIZED TITLE')).map(box => box.page)).toEqual([1]);
    for (let index = 0; index < 30; index++) expect(boxes.some(box => box.text.includes(`Record ${index}.`))).toBe(true);
    expect(document.getPages().every(page => page.getWidth() === 360 && page.getHeight() === 504)).toBe(true);
    const word = await compileDocxFixture(source);
    expect(word.ok, formatDocxFailure('small title-only Word', word)).toBe(true);
    const zip = await JSZip.loadAsync(word.docxBytes!);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).not.toMatch(/<w:t[^>]*>n<\/w:t>/);
    expect(xml).toContain('AUTHORIZED TITLE');
  }, 60_000);

  it.each(['7x9', '5x7'] as const)('places both classification banners on every %s page', async size => {
    const source = buildBaseline('executive_correspondence');
    Object.assign(source.formData, { stationerySize: size, letterheadMode: 'preprinted', classLevel: 'secret', date: '', subject: '', to: '', signatureType: 'none' });
    source.paragraphs = Array.from({ length: 12 }, (_, index) => ({ id: `record-${index}`, level: 0, text: `Record ${index}. Coordinate the approved activity and retain the complete instruction for reference.` }));
    const result = await compileFixture(source);
    expect(result.ok, formatFailure('marked small stock', result)).toBe(true);
    const pdf = await PDFDocument.load(result.pdfBytes!);
    const { boxes } = await pdfTextLayout(result.pdfBytes!);
    for (let page = 1; page <= pdf.getPageCount(); page++) {
      const markings = boxes.filter(box => box.page === page && box.text === 'SECRET');
      expect(markings).toHaveLength(2);
      for (const marking of markings) {
        expect((marking.left + marking.right) / 2).toBeCloseTo(pdf.getPage(page - 1).getWidth() / 2, 0);
        expect(marking.bottom).toBeGreaterThanOrEqual(0);
        expect(marking.top).toBeLessThan(pdf.getPage(page - 1).getHeight());
      }
    }
  });
  it.each(['7x9', '5x7'] as const)('uses an exact digital signing slot on %s even without a printed name', async size => {
    const source = buildBaseline('executive_correspondence');
    Object.assign(source.formData, { stationerySize: size, letterheadMode: 'preprinted', sigFirst: '', sigMiddle: '', sigLast: '', sigTitle: '', sigRank: '', signatureType: 'digital', date: '', to: '', subject: '' });
    source.paragraphs = [{ id: 'body', level: 0, text: 'Short personal correspondence for review.' }];
    const compiled = await compileFixture(source);
    expect(compiled.ok, formatFailure('small digital slot', compiled)).toBe(true);
    const generated = generateAllLatexFiles(source);
    const signed = await finishCorrespondencePdf(compiled.pdfBytes!, source.docType, source.formData, generated);
    const document = await PDFDocument.load(signed.pdfBytes);
    const fields = document.catalog.lookup(PDFName.of('AcroForm'), PDFDict).lookup(PDFName.of('Fields'), PDFArray);
    expect(fields.size()).toBe(1);
    const field = fields.lookup(0, PDFDict), rectangle = field.lookup(PDFName.of('Rect'), PDFArray);
    const numbers = Array.from({ length: 4 }, (_, index) => rectangle.lookup(index, PDFNumber).asNumber());
    const page = document.getPage(0);
    expect(numbers[0]).toBeGreaterThanOrEqual(page.getWidth() / 2 - 2.1);
    expect(numbers[2]).toBeLessThanOrEqual(page.getWidth() - 72);
    expect(numbers[1]).toBeGreaterThan(72);
    expect(numbers[3]).toBeLessThan(page.getHeight() - 72);
    const forged = await PDFDocument.load(compiled.pdfBytes!);
    forged.catalog.delete(PDFName.of('Names'));
    for (const page of forged.getPages()) page.node.delete(PDFName.of('Annots'));
    await expect(finishCorrespondencePdf(await forged.save(), source.docType, source.formData, generated)).rejects.toThrow(/signature location is missing/);
  });

  it('fits body and signature images within five-by-seven text and signature areas', async () => {
    const png = await sharp({ create: { width: 1200, height: 600, channels: 3, background: '#bc2020' } }).png().toBuffer();
    const source = buildBaseline('executive_correspondence');
    Object.assign(source.formData, { stationerySize: '5x7', letterheadMode: 'preprinted', date: '', to: '', subject: '', sigTitle: '', sigRank: '', signatureType: 'image', signatureImage: { name: 'signature.png', size: png.length, data: png.toString('base64') } });
    source.paragraphs = [{ id: 'image', level: 0, text: '', figure: { placement: 'body', name: 'body.png', type: 'image/png', width: 1200, height: 600, altText: 'Synthetic geometry fixture', fileRef: { id: 'body-image', name: 'body.png', size: png.length, type: 'image/png' } } }];
    const generated = generateAllLatexFiles(source);
    const pdf = await compileFixture(source, { [generated.figures[0].file]: png, 'attachments/signature.png': png });
    expect(pdf.ok, formatFailure('small-stock images', pdf)).toBe(true);
    const document = await PDFDocument.load(pdf.pdfBytes!);
    const images = (await Promise.all(document.getPages().map((_, index) => pdfImages(pdf.pdfBytes!, index + 1)))).flat();
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image.left).toBeGreaterThanOrEqual(71.9); expect(image.right).toBeLessThanOrEqual(288.1);
      expect(image.bottom).toBeGreaterThan(71); expect(image.top).toBeLessThan(433);
    }
    const word = await compileGeneratedDocxFixture(generateFlatLatex(source), source.formData, { 'figure-1.png': png, 'signature.png': png });
    expect(word.ok, formatDocxFailure('small-stock images', word)).toBe(true);
    const blob = await postProcessDocx(new Blob([word.docxBytes! as BlobPart]), { docType: source.docType, stationerySize: '5x7', letterheadMode: 'preprinted' });
    const xml = await (await JSZip.loadAsync(await blob.arrayBuffer())).file('word/document.xml')!.async('string');
    const extents = [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)].map(match => Number(match[1]));
    expect(extents).toHaveLength(2);
    expect(Math.max(...extents)).toBeLessThanOrEqual(3 * 914400);
    const companion = await renderDocx({ docType: 'executive_correspondence', unit: { stationerySize: '5x7', letterheadMode: 'preprinted' }, subject: '', paragraphs: [{ text: 'Short image-signature correspondence.' }], signature: { first: 'A', last: 'SMITH', imageFileId: 'signature' }, attachments: [{ id: 'signature', name: 'signature.png', mimeType: 'image/png', dataBase64: png.toString('base64') }] });
    await writeFile(`${word.workDir}/companion-image.docx`, companion);
    const companionXml = await (await JSZip.loadAsync(companion)).file('word/document.xml')!.async('string');
    expect(companionXml).toContain('<w:left w:w="0" w:type="dxa"/>');
    expect(companionXml).toContain('w:w="7200" w:h="10080"');
  }, 60_000);

  it.each([
    ['executive_correspondence', 'letter', 'full'],
    ['executive_correspondence', 'letter', 'preprinted'],
    ['executive_correspondence', '5x7', 'title-only'],
    ['executive_correspondence', '7x9', 'preprinted'],
    ['business_letter', 'letter', 'preprinted'],
  ] as const)('preserves native companion paragraph indents for %s on %s %s stock', async (docType, size, mode) => {
    const bytes = await renderDocx({ docType, unit: { name: 'TITLE PROBE', stationerySize: size, letterheadMode: mode }, to: 'Training Recipient', salutation: 'Dear Recipient:', paragraphs: [{ text: 'BODYPROBE First paragraph retains the required first-line indent.' }, { text: 'SECONDPROBE New paragraphs keep their own indent.' }], signature: { first: 'A', last: 'SMITH' } });
    const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');
    for (const marker of ['BODYPROBE', 'SECONDPROBE']) {
      const paragraph = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)!.find(value => value.includes(marker))!;
      expect(paragraph).toContain('w:firstLine="720"');
      expect(paragraph).not.toContain(String.fromCodePoint(0x2003));
    }
    if (mode === 'title-only') {
      const header = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g)!.find(table => table.includes('DonDocsTitleLetterhead'))!;
      expect(header).toContain('<w:sz w:val="20"/>');
    }
  }, 60_000);

  it.each([['5x7', 3, [4, 5, 10]], ['7x9', 7, [8, 9, 10]]] as const)('guards deep imported indents on %s while preserving fitting paragraphs', async (size, fitting, rejected) => {
    const source = buildBaseline('executive_correspondence');
    Object.assign(source.formData, { stationerySize: size, letterheadMode: 'preprinted', date: '', to: '', subject: '', signatureType: 'none' });
    source.paragraphs = [{ id: 'nested', level: fitting, text: 'Short words.' }];
    const result = await compileFixture(source);
    expect(result.ok, formatFailure('fitting small indent', result)).toBe(true);
    const { boxes } = await pdfTextLayout(result.pdfBytes!);
    const text = boxes.find(box => box.text.includes('Short words.'))!;
    expect(text.right).toBeLessThanOrEqual((correspondenceStationery(source.docType, source.formData).width - 1) * 72);
    for (const level of rejected) {
      source.paragraphs[0].level = level;
      expect(() => generateAllLatexFiles(source)).toThrow(/Outdent it or choose larger stock/);
      expect(() => generateFlatLatex(source)).toThrow(/Outdent it or choose larger stock/);
    }
    // The same imported preference remains harmless on a larger legacy document.
    source.formData.stationerySize = 'letter';
    expect(() => generateAllLatexFiles(source)).not.toThrow();
    source.formData.stationerySize = size;
    source.paragraphs = [{ id: 'table', level: 10, text: '', bodyTable: { rows: [['Fits']], headerRows: 0 } }];
    expect(stationeryIssues(source.docType, source.formData, source.paragraphs)).toEqual([]);
    if (size === '5x7') expect(validateLetter({ docType: source.docType, unit: { stationerySize: size, letterheadMode: 'preprinted' }, paragraphs: [{ text: 'Body text', level: 4 }] })).toEqual([expect.stringContaining('Outdent it')]);
  }, 60_000);

});
