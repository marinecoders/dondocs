import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNodeEngine, loadAssets } from '../../companion/nodeEngine';
import { createBlankSession, prepareSessionState } from '@/stores/documentStore';
import { captureDocumentRevision, copyCapturedDocument } from '@/lib/capturedDocument';
import { projectRenderedDocument } from '@/lib/renderedDocument';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { compileDocument, LatexCompileError, prepareEngine } from '@/services/latex/renderDocument';
import { compileDocxFixture } from '../_helpers/compileDocx';
import { describeToolchainRequirement, hasPdfToolchain } from '../_helpers/pdfToolchain';
import type { DocumentData } from '@/types/document';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { directiveContinuation } from '@/lib/directiveFormats';
import { postProcessDocx } from '@/services/docx/pandoc-converter';
import { finishCorrespondencePdf } from '@/services/pdf/finishCorrespondencePdf';
import { PDFDocument } from 'pdf-lib';

function draft(type: string, formData: Partial<DocumentData> = {}) {
  const session = createBlankSession(undefined, type);
  Object.assign(session.formData, { unitLine1: 'HEADQUARTERS', unitAddress: '123 MAIN STREET, ARLINGTON, VA 22201',
    date: '12 Sep 27', officeCode: 'ADMIN', subject: 'Formatting sample', from: 'Commanding Officer',
    to: 'Distribution List', classLevel: 'unclassified', sigLast: 'Test', ...formData });
  session.paragraphs = [{ text: 'Sample content for the administrative format.', level: 0 }];
  const captured = captureDocumentRevision({ documentId: type, epoch: 0, editSequence: 0, capturedAt: 0 }, prepareSessionState(session));
  return copyCapturedDocument(projectRenderedDocument(captured)).document;
}

describeToolchainRequirement('directive formats');
describe.skipIf(!hasPdfToolchain)('directive formats export', () => {
  let engine: Awaited<ReturnType<typeof createNodeEngine>>;
  beforeAll(async () => { engine = await createNodeEngine(); prepareEngine(engine, await loadAssets()); }, 60_000);
  afterAll(async () => { await engine?.dispose(); });

  async function pdf(document: ReturnType<typeof draft>) {
    let bytes: Uint8Array;
    try { bytes = await compileDocument(engine, generateAllLatexFiles(document).texFiles); }
    catch (error) {
      if (error instanceof LatexCompileError) throw new Error(error.log.slice(-7_000), { cause: error });
      throw error;
    }
    const result = spawnSync('pdftotext', ['-layout', '-', '-'], { input: bytes, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout;
  }

  async function word(document: ReturnType<typeof draft>) {
    const result = await compileDocxFixture(document);
    expect(result.ok, result.log).toBe(true);
    return (await mammoth.extractRawText({ buffer: Buffer.from(result.docxBytes!) })).value;
  }

  it.each([
    ['marine_corps_order', 'MARINE CORPS ORDER 5215.1K'],
    ['marine_corps_bulletin', 'MARINE CORPS BULLETIN 5215.1K'],
    ['secnav_instruction', 'SECNAV INSTRUCTION 5215.1K'],
    ['secnav_notice', 'SECNAV NOTICE 5215'],
    ['change_transmittal', 'SECNAV INSTRUCTION 5215.1E CHANGE TRANSMITTAL 2'],
  ])('renders %s with the designation before the body', async (type, designation) => {
    const document = draft(type, { directiveNumber: type === 'change_transmittal' ? 'SECNAVINST 5215.1E' : type === 'secnav_notice' ? '5215' : '5215.1K',
      directiveChangeNumber: '2', directiveCancellation: 'Canc: Sep 2027', directiveReports: 'Synthetic inventory report' });
    const reports = type === 'marine_corps_bulletin' || type === 'marine_corps_order';
    const cancellation = type === 'marine_corps_bulletin' || type === 'secnav_notice';
    for (const text of [await pdf(document), await word(document)]) {
      expect(text.includes('Distribution List')).toBe(reports);
      expect(/\bTo:\s+/.test(text)).toBe(reports);
      expect(text).toContain(designation);
      expect(text.indexOf(designation)).toBeLessThan(text.indexOf('Sample content'));
      expect(text.includes('Canc: Sep 2027')).toBe(cancellation);
      expect(text.includes('Synthetic inventory report')).toBe(reports);
      if (!reports) {
        expect(text).toContain('DEPARTMENT OF THE NAVY');
        expect(text).toContain('OFFICE OF THE SECRETARY');
        expect(text).not.toContain('UNITED STATES MARINE CORPS');
      }
    }
  }, 60_000);

  it.each(['unclassified', 'secret'] as const)('identifies continuation sheets in %s PDF and Word', async classLevel => {
    const document = draft('marine_corps_order', {
      directiveNumber: 'Marine Corps Order 5215.1K', classLevel, fontSize: '10pt', fontFamily: 'times',
      showSubjectOnContinuation: true,
      ...(classLevel === 'secret' ? { classificationBasis: 'derivative', classifiedBy: 'Synthetic Authority', derivedFrom: 'Synthetic source record', declassifyOn: '20501231' } : {}),
    });
    document.paragraphs = Array.from({ length: 58 }, (_, index) => ({
      level: 0, text: 'Directive continuation sample number ' + (index + 1) + '. Prepare the written materials and record the routine administrative results for the next meeting.',
      ...(classLevel === 'secret' ? { portionMarking: 'S' as const } : {}),
    }));
    expect(document.formData).toMatchObject({ fontFamily: 'courier', fontSize: '10pt' });
    const pages = (await pdf(document)).split('\f').filter(page => page.trim());
    expect(pages.length).toBeGreaterThan(2);
    expect(pages[0]).toContain('MARINE CORPS ORDER 5215.1K');
    expect(pages[0]).not.toContain('MCO MARINE CORPS ORDER');
    if (classLevel === 'secret') {
      expect(pages[0]).toContain('Classified by: Synthetic Authority');
      expect(pages[0]).toContain('Derived from: Synthetic source record');
      const wordText = await word(document);
      expect(wordText).toContain('Classified by: Synthetic Authority');
      expect(wordText.indexOf('Classified by: Synthetic Authority')).toBeLessThan(wordText.indexOf('Directive continuation sample'));
    }
    for (const page of pages.slice(1)) {
      expect(page).toContain('MCO 5215.1K');
      expect(page).toContain('12 Sep 27');
      expect(page).not.toContain('ADMIN');
      expect(page).not.toContain('FORMATTING SAMPLE');
    }

    const result = await compileDocxFixture(document);
    expect(result.ok, result.log).toBe(true);
    const processed = await postProcessDocx(new Blob([new Uint8Array(result.docxBytes!)]), {
      docType: document.docType, classLevel, fontFamily: 'courier', fontSize: '10pt',
      directiveContinuation: directiveContinuation(document.docType, document.formData),
      pageNumbering: 'simple',
    });
    const zip = await JSZip.loadAsync(await processed.arrayBuffer());
    const header = await zip.file('word/header2.xml')!.async('string');
    expect(header).toMatch(/w:val="right"[\s\S]*MCO 5215\.1K[\s\S]*12 Sep 27/);
    expect(await zip.file('word/header1.xml')!.async('string')).not.toContain('MCO 5215.1K');
    if (classLevel === 'secret') {
      expect(await zip.file('word/header3.xml')!.async('string')).toMatch(/w:val="left"[\s\S]*MCO 5215\.1K/);
      expect(await zip.file('word/footer3.xml')!.async('string')).toContain(' PAGE ');
      expect(await zip.file('word/settings.xml')!.async('string')).toContain('<w:evenAndOddHeaders/>');
    } else {
      expect(zip.file('word/header3.xml')).toBeNull();
    }
  }, 60_000);

  it.each([
    ['secnav_instruction', 'secret', 'SECNAVINST', 'SECNAV INSTRUCTION', 'S'],
    ['secnav_notice', 'confidential', 'SECNAVNOTE', 'SECNAV NOTICE', 'C'],
  ] as const)('prints the classification prefix on the %s identifier and designation', async (type, classLevel, short, title, prefix) => {
    const subjectCode = type === 'secnav_notice' ? '5215' : '5215.1K';
    const document = draft(type, {
      directiveNumber: short + ' ' + prefix + subjectCode, directiveCancellation: 'Canc: Sep 2027', classLevel,
    });
    for (const output of [await pdf(document), await word(document)]) {
      expect(output).toContain(short + ' ' + prefix + subjectCode);
      expect(output).toContain(title + ' ' + prefix + subjectCode);
    }
    expect(directiveContinuation(type, document.formData)?.lines[0]).toBe(short + ' ' + prefix + subjectCode);
  }, 60_000);

  it('identifies every enclosure page on a normal SECNAV instruction', async () => {
    const document = draft('secnav_instruction', { directiveNumber: '5215.1K' });
    const source = await PDFDocument.create();
    source.addPage([612, 792]).drawText('Portrait attachment');
    source.addPage([792, 612]).drawText('Landscape attachment');
    const bytes = new Uint8Array(await source.save());
    document.enclosures = [{ title: 'Attachment pages', pageStyle: 'fullpage',
      file: { name: 'enclosure.pdf', size: bytes.byteLength, data: bytes.buffer } }];
    const generated = generateAllLatexFiles(document);
    const basic = await compileDocument(engine, generated.texFiles);
    const result = await finishCorrespondencePdf(basic, document.docType, document.formData, generated);
    expect(result.errors).toEqual([]);
    const pages = (await PDFDocument.load(result.pdfBytes)).getPages();
    expect(pages).toHaveLength(3);
    expect(pages[2].getSize()).toEqual({ width: 792, height: 612 });
    const text = spawnSync('pdftotext', ['-layout', '-', '-'], { input: result.pdfBytes, encoding: 'utf8' });
    expect(text.status, text.stderr).toBe(0);
    for (const page of text.stdout.split('\f').slice(1, 3)) {
      expect(page).toContain('SECNAVINST 5215.1K');
      expect(page).toContain('12 Sep 27');
      expect(page).toContain('Enclosure (1)');
      expect(page).toContain('attachment');
    }
  }, 60_000);
});
