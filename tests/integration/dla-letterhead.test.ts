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
import { postProcessDocx } from '@/services/docx/pandoc-converter';
import { applyLetterheadStyling } from '@/services/docx/letterheadStyling';

function draft(type: string, formData: Partial<DocumentData> = {}) {
  const session = createBlankSession(undefined, type);
  Object.assign(session.formData, { unitLine1: 'HEADQUARTERS', unitAddress: '123 MAIN STREET, ARLINGTON, VA 22201',
    date: '12 Sep 27', officeCode: 'ADMIN', subject: 'Formatting sample', from: 'Commanding Officer',
    to: 'Distribution List', classLevel: 'unclassified', sigLast: 'Test', ...formData });
  session.paragraphs = [{ text: 'Sample content for the administrative format.', level: 0 }];
  const captured = captureDocumentRevision({ documentId: type, epoch: 0, editSequence: 0, capturedAt: 0 }, prepareSessionState(session));
  return copyCapturedDocument(projectRenderedDocument(captured)).document;
}

describeToolchainRequirement('dla letterhead');
describe.skipIf(!hasPdfToolchain)('dla letterhead export', () => {
  let engine: Awaited<ReturnType<typeof createNodeEngine>>;
  beforeAll(async () => { engine = await createNodeEngine(); prepareEngine(engine, await loadAssets()); }, 60_000);
  afterAll(async () => { await engine?.dispose(); });

  async function pdf(document: ReturnType<typeof draft>, textMode = '-layout') {
    let bytes: Uint8Array;
    try { bytes = await compileDocument(engine, generateAllLatexFiles(document).texFiles); }
    catch (error) {
      if (error instanceof LatexCompileError) throw new Error(error.log.slice(-7_000), { cause: error });
      throw error;
    }
    const result = spawnSync('pdftotext', [textMode, '-', '-'], { input: bytes, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout;
  }

  async function word(document: ReturnType<typeof draft>) {
    const result = await compileDocxFixture(document);
    expect(result.ok, result.log).toBe(true);
    return (await mammoth.extractRawText({ buffer: Buffer.from(result.docxBytes!) })).value;
  }

  it('sets the agency typeface and sizes in final Word output', async () => {
    const document = draft('business_letter', { letterheadStandard: 'dla' });
    const result = await compileDocxFixture(document);
    expect(result.ok, result.log).toBe(true);
    const processed = await postProcessDocx(new Blob([new Uint8Array(result.docxBytes!)]), {
      docType: document.docType, dlaLetterhead: true,
    });
    const xml = await (await JSZip.loadAsync(await processed.arrayBuffer())).file('word/document.xml')!.async('string');
    expect(xml).toMatch(/Copperplate Gothic Light[\s\S]*?w:sz w:val="24"[\s\S]*?DEFENSE LOGISTICS AGENCY/);
    expect(xml).toMatch(/Copperplate Gothic Light[\s\S]*?w:sz w:val="20"[\s\S]*?HEADQUARTERS/);
    const anchor = xml.match(/<wp:anchor\b[^>]*>[\s\S]*?<\/wp:anchor>/)?.[0];
    expect(anchor).toContain('<wp:positionH relativeFrom="page"><wp:posOffset>457200</wp:posOffset>');
    expect(anchor).toContain('<wp:positionV relativeFrom="page"><wp:posOffset>457200</wp:posOffset>');
    expect(anchor).toContain('<wp:extent cx="914400" cy="914400"/>');
    const firstTable = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/)![0];
    expect(firstTable).toContain('w:trHeight w:val="1440" w:hRule="atLeast"');
    expect(firstTable).not.toContain('<w:drawing>');
    for (const match of firstTable.matchAll(/<w:rPr>([\s\S]*?)<\/w:rPr>/g)) {
      expect([...match[1].matchAll(/<w:rFonts\b/g)]).toHaveLength(1);
      expect([...match[1].matchAll(/<w:sz\b/g)]).toHaveLength(1);
      expect([...match[1].matchAll(/<w:color\b/g)]).toHaveLength(1);
    }
    expect(applyLetterheadStyling(xml, '00205B', 0, true)).toBe(xml);
  }, 60_000);

  it('keeps the PDF date below a wrapped DLA letterhead', async () => {
    const document = draft('business_letter', {
      letterheadStandard: 'dla',
      unitLine1: 'ACQUISITION MANAGEMENT AND SUPPLY CHAIN OPERATIONS DIRECTORATE',
      unitLine2: 'INSTALLATION SUPPORT AND EXPEDITIONARY GOVERNMENT SERVICES DIVISION',
    });
    const bbox = await pdf(document, '-bbox');
    const words = [...bbox.matchAll(/<word xMin="([^"]+)" yMin="([^"]+)" xMax="[^"]+" yMax="([^"]+)">([^<]+)<\/word>/g)];
    const zip = words.find(word => word[4] === '22201');
    const day = words.find(word => Number(word[1]) < 100 && word[4] === '12');
    expect(zip).toBeDefined();
    expect(day).toBeDefined();
    expect(Number(day?.[2]) - Number(zip?.[3])).toBeGreaterThan(10);
  }, 60_000);

  it('retains ordinary and preprinted rendering when DLA is inactive', async () => {
    const preprinted = draft('business_letter', { letterheadStandard: 'dla', letterheadMode: 'preprinted' });
    for (const text of [await pdf(preprinted), await word(preprinted)]) expect(text).not.toContain('DEFENSE LOGISTICS AGENCY');
    const naval = draft('naval_letter', { letterheadStandard: 'dla', department: 'dla' });
    for (const text of [await pdf(naval), await word(naval)]) {
      expect(text).toContain('UNITED STATES MARINE CORPS');
      expect(text).not.toContain('DEFENSE LOGISTICS AGENCY');
    }
  }, 60_000);

  it.each(['business_letter', 'letterhead_memorandum', 'mf', 'mfr'])('renders DLA stationery on %s', async type => {
    const document = draft(type, { letterheadStandard: 'dla' });
    for (const text of [await pdf(document), await word(document)]) {
      expect(text).toContain('DEFENSE LOGISTICS AGENCY');
      expect(text).toContain('HEADQUARTERS');
      expect(text).not.toContain('UNITED STATES MARINE CORPS');
    }
  }, 60_000);
});
