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
import { coordinationTable } from '@/lib/staffPapers';
import { postProcessDocx } from '@/services/docx/pandoc-converter';

function draft(type: string, formData: Partial<DocumentData> = {}) {
  const session = createBlankSession(undefined, type);
  Object.assign(session.formData, { unitLine1: 'HEADQUARTERS', unitAddress: '123 MAIN STREET, ARLINGTON, VA 22201',
    date: '12 Sep 27', officeCode: 'ADMIN', subject: 'Formatting sample', from: 'Commanding Officer',
    to: 'Distribution List', classLevel: 'unclassified', sigLast: 'Test', ...formData });
  if (type !== 'coordination_page') session.paragraphs = [{ text: 'Sample content for the administrative format.', level: 0 }];
  const captured = captureDocumentRevision({ documentId: type, epoch: 0, editSequence: 0, capturedAt: 0 }, prepareSessionState(session));
  return copyCapturedDocument(projectRenderedDocument(captured)).document;
}

describeToolchainRequirement('staff papers');
describe.skipIf(!hasPdfToolchain)('staff papers export', () => {
  let engine: Awaited<ReturnType<typeof createNodeEngine>>;
  beforeAll(async () => { engine = await createNodeEngine(); prepareEngine(engine, await loadAssets()); }, 60_000);
  afterAll(async () => { await engine?.dispose(); });

  async function pdf(document: ReturnType<typeof draft>, mode = '-layout') {
    let bytes: Uint8Array;
    try { bytes = await compileDocument(engine, generateAllLatexFiles(document).texFiles); }
    catch (error) {
      if (error instanceof LatexCompileError) throw new Error(error.log.slice(-7_000), { cause: error });
      throw error;
    }
    const result = spawnSync('pdftotext', [mode, '-', '-'], { input: bytes, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout;
  }

  async function word(document: ReturnType<typeof draft>) {
    const result = await compileDocxFixture(document);
    expect(result.ok, result.log).toBe(true);
    return (await mammoth.extractRawText({ buffer: Buffer.from(result.docxBytes!) })).value;
  }

  it.each(['secnav', 'hqmc'] as const)('renders the %s coordination page', async layout => {
    const document = draft('coordination_page', { coordinationLayout: layout, coordinationComments: 'Follow-up remarks.',
      coordinationEntries: [{ office: 'Operations', contact: 'Casey Example', phone: '555-0101', date: '16 Sep 27', position: 'Concur' }] });
    for (const text of [await pdf(document), await word(document)]) {
      expect(text).toContain('COORDINATION PAGE');
      expect(text).toContain('Casey Example');
      expect(text.includes('555-0101')).toBe(layout === 'secnav');
      expect(text).toContain('16 Sep 27');
      expect(text.includes('Follow-up remarks.')).toBe(layout === 'hqmc');
      expect(text).not.toContain('MEMORANDUM');
    }
  }, 60_000);

  it.each(['secnav', 'hqmc'] as const)('applies fixed columns, borders and header repetition in final %s Word output', async layout => {
    const document = draft('coordination_page', { coordinationLayout: layout, coordinationComments: 'Route to the records office.', coordinationEntries: [
      { office: 'Operations', contact: 'Casey Example', phone: '555-0101', date: '16 Sep 27', position: 'Concur' },
      { office: '', contact: '', phone: '', date: '', position: '' },
    ] });
    const result = await compileDocxFixture(document);
    expect(result.ok, result.log).toBe(true);
    const table = coordinationTable(document.formData);
    const processed = await postProcessDocx(new Blob([new Uint8Array(result.docxBytes!)]), {
      docType: document.docType, bodyTables: [table],
    });
    const xml = await (await JSZip.loadAsync(await processed.arrayBuffer())).file('word/document.xml')!.async('string');
    const renderedTable = [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map(match => match[0])
      .find(block => block.includes('DonDocsBodyTable0'))!;
    expect(renderedTable).toContain('<w:tblHeader/>');
    expect(renderedTable).toContain('<w:tblLayout w:type="fixed"/>');
    expect(renderedTable).toContain('<w:insideH w:val="nil"');
    expect(renderedTable).toContain('<w:cantSplit/>');
    if (layout === 'secnav') expect(renderedTable).toMatch(/<w:u w:val="single"\s*\/>/);
    else expect(xml).toMatch(/<w:pBdr>[\s\S]*?Staffing Comments:/);
    const widths = [...renderedTable.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map(match => Number(match[1]));
    expect(widths).toHaveLength(layout === 'hqmc' ? 3 : 5);
    expect(widths.reduce((total, value) => total + value, 0)).toBe(9360);
    expect([...renderedTable.matchAll(/<w:tr[ >]/g)]).toHaveLength(2);
  }, 60_000);

  it('keeps a long unbroken office name inside the coordination table', async () => {
    const office = 'OPERATIONS' + 'A'.repeat(170) + 'ENDMARKER';
    const document = draft('coordination_page', { coordinationEntries: [
      { office, contact: 'Casey Example', phone: '', date: '', position: '' },
    ] });
    const bbox = await pdf(document, '-bbox');
    const words = [...bbox.matchAll(/<word xMin="[^"]+" yMin="[^"]+" xMax="([^"]+)" yMax="[^"]+">([^<]+)<\/word>/g)];
    const officeWords = words.filter(word => /^[A-Z]+$/.test(word[2]) && !['COORDINATION', 'PAGE'].includes(word[2]));
    expect(officeWords.map(word => word[2]).join('')).toBe(office);
    expect(Math.max(...officeWords.map(word => Number(word[1])))).toBeLessThan(168);
    expect((await word(document)).replace(/\s/g, '')).toContain(office);
  }, 60_000);

  it.each(['position_decision_paper', 'information_paper'])('renders %s without memo furniture', async type => {
    const document = draft(type, { preparedBy: 'Synthetic Author', staffDecisionStyle: 'independent',
      staffDecisionOptions: 'Use the first option.\nUse the second option.', staffApprovedBy: 'Synthetic Reviewer' });
    for (const text of [await pdf(document), await word(document)]) {
      expect(text).toContain(type === 'information_paper' ? 'INFORMATION PAPER' : 'POSITION/DECISION PAPER');
      expect(text).toContain('Synthetic Author');
      expect(text.includes('Use the second option.')).toBe(type === 'position_decision_paper');
      expect(text).not.toContain('MEMORANDUM');
      expect(text).not.toContain('Commanding Officer');
    }
  }, 60_000);

  it.each(['single', 'choose_one', 'independent'] as const)('renders official-by-official %s decision rows in PDF and DOCX', async style => {
    const document = draft('position_decision_paper', {
      preparedBy: 'Synthetic Author', staffApprovedBy: 'Synthetic Reviewer',
      staffDecisionStyle: style, staffDecisionOfficials: 'Staff reviewer\nDecision authority',
      staffDecisionOptions: 'Retain the current process.\nAdopt the revised process.',
    });
    for (const text of [await pdf(document), await word(document)]) {
      expect(text).toContain('Staff reviewer recommends:');
      expect(text).toContain('Decision authority decision:');
      expect(text.indexOf('Staff reviewer recommends:')).toBeLessThan(text.indexOf('Decision authority decision:'));
      expect(text.match(/Decision authority decision:/g)).toHaveLength(style === 'independent' ? 2 : 1);
      expect(text).toContain(style === 'choose_one' ? 'COA 2' : 'Disapproved');
    }
  }, 60_000);
});
