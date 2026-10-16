import { DISCREPANCY_NOTICE, MI_REPORTING } from '@/data/techpub/sections';
import { PUBLICATION_TYPES } from '@/data/techpub/publicationTypes';
import { iTypeExportErrors } from '@/lib/iTypePreflight';
import { publicationMarking } from '@/lib/publicationMarking';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument } from 'pdf-lib';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildBaseline } from '../_helpers/compileMatrix';
import { compileFixture, type TestStore } from '../_helpers/compileLatex';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';
import { pdfRules } from '../_helpers/pdfRules';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { compileDocument, prepareEngine, LatexCompileError } from '@/services/latex/renderDocument';
import { createNodeEngine, loadAssets } from '../../companion/nodeEngine';
import { mergeEnclosures } from '@/services/pdf/mergeEnclosures';
import { addSignatureField } from '@/services/pdf/addSignatureField';
import { resolvePublicationDestinations } from '@/services/pdf/publicationDestinations';
import type { EndItem, PublicationTableRow, CalloutKind } from '@/types/document';

const output = mkdtempSync(join(tmpdir(), 'itype-compliance-'));
type Publication = TestStore & { endItems: EndItem[]; publicationTables: Record<string, PublicationTableRow[]> };
function baseline(): Publication {
  const s = buildBaseline('i_type' as never) as Publication;
  Object.assign(s.formData, { date: '30 Oct 26', publicationSigningDate: '2026-10-15', shortTitle: 'MI 12345A-26/1', subject: 'INSTALL THE ACCESSORY BRACKET', nomenclature: 'SUPPORT EQUIPMENT', pcn: '184 123456 00',
    publicationType: 'MI', miUrgency: 'normal', classLevel: 'unclassified', cuiDistStatement: 'A', fontFamily: 'times', fontSize: '12pt',
    signatureType: 'digital', sigFirst: 'J', sigMiddle: 'A', sigLast: 'DOE', sigTitle: 'Program Manager', controllingOffice: 'Program Office', pocEmail: 'review@example.mil' });
  s.references = []; s.enclosures = []; s.copyTos = []; s.distributions = [];
  s.endItems = [{ nsn: '1005-01-566-1100', tamcn: 'A02550G', id: '11030A', model: 'BRACKET' }];
  s.publicationTables = {};
  s.paragraphs = [{ level: 0, header: 'Purpose', text: 'BODY FONT SAMPLE. Install the bracket.' }];
  return s;
}
function pages(bytes: Uint8Array, name: string): string[] {
  const path = join(output, `${name}.pdf`); writeFileSync(path, bytes);
  return spawnSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8' }).stdout.split('\f').filter((page) => page.trim());
}
async function local(s: Publication, extra: Record<string, Uint8Array> = {}): Promise<Uint8Array> {
  const result = await compileFixture(s, extra);
  expect(result.ok, result.errors.join('\n') + result.logTail).toBe(true);
  return resolvePublicationDestinations(result.pdfBytes!);
}
async function textItems(bytes: Uint8Array, page: number) {
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
  try {
    return (await (await pdf.getPage(page)).getTextContent()).items.filter((item) => 'str' in item);
  } finally { await pdf.destroy(); }
}

describeToolchainRequirement('i-type-compliance');
describe.skipIf(!hasPdfToolchain)('I-Type rendered acceptance', () => {
  let engine: Awaited<ReturnType<typeof createNodeEngine>>;
  beforeAll(async () => { engine = await createNodeEngine(); prepareEngine(engine, await loadAssets()); }, 60_000);
  afterAll(async () => { await engine?.dispose(); });
  const production = async (s: Publication, extra: Record<string, Uint8Array> = {}) => {
    try { return await compileDocument(engine, { ...generateAllLatexFiles(s).texFiles, ...extra }); }
    catch (error) {
      if (error instanceof LatexCompileError) throw new Error(error.log.slice(-12000), { cause: error });
      throw error;
    }
  };

  it.each(['derivative', 'original'] as const)('puts %s classification authority on the cover', async (classificationBasis) => {
    const s = baseline();
    Object.assign(s.formData, { classLevel: 'secret', classificationBasis, classifiedBy: 'Synthetic reviewer, Program Office', derivedFrom: 'Synthetic guide', classReason: '1.4(a)', declassifyOn: '20361015', cuiDistStatement: 'D', distReason: 'Software Documentation', distDate: '2026-10-15' });
    s.paragraphs[0].portionMarking = 'S';
    const text = pages(await production(s), `authority-${classificationBasis}`);
    expect(text[0]).toContain('Classified By: Synthetic reviewer');
    expect(text[0]).toContain('Declassify On: 20361015');
    expect(text[0]).toContain('DoDM 5200.01, Volume 3');
    expect(text[0]).not.toContain('DoDI 5200.48');
    expect(text[0].includes('Derived From: Synthetic guide')).toBe(classificationBasis === 'derivative');
    expect(text[0].includes('Reason: 1.4(a)')).toBe(classificationBasis === 'original');
    expect(text[1]).not.toContain('Classified By:');
  }, 60_000);

  it('renders 12-point body text and keeps authentication on one page', async () => {
    const bytes = await production(baseline());
    const text = pages(bytes, 'font-auth');
    expect(text).toHaveLength(3);
    expect(text[1]).toMatch(/OFFICIAL[\s\S]*J\. A\. DOE[\s\S]*DISTRIBUTION: EDO/);
    const body = (await textItems(bytes, 3)).find((item) => item.str.includes('BODY FONT SAMPLE'))!;
    expect(body.height).toBeCloseTo(12 * 72 / 72.27, 2);
    const auth = await textItems(bytes, 2);
    const date = auth.find((item) => item.str === '30 October 2026')!;
    expect(date.transform[4] + date.width).toBeCloseTo(540, 0);
    const official = auth.find((item) => item.str === 'OFFICIAL')!;
    const name = auth.find((item) => item.str === 'J. A. DOE')!;
    expect(official.transform[5] - name.transform[5]).toBeGreaterThanOrEqual(48 * 72 / 72.27);
  }, 60_000);

  it.each([false, true])('aligns running short titles by printed page number (cover overflow: %s)', async (overflow) => {
    const s = baseline();
    if (overflow) s.endItems = Array.from({ length: 8 }, () => ({ ...s.endItems[0] }));
    s.paragraphs[0].text = 'Inspect the equipment and record the condition. '.repeat(140);
    s.paragraphs.push({ level: 0, header: 'Reference Data', appendix: true, text: 'Reference values. '.repeat(160) });
    const bytes = await production(s);
    const count = pages(bytes, `running-heads-${overflow}`).length;
    for (let page = 2; page <= count; page++) {
      const items = await textItems(bytes, page);
      const number = items.find((i) => i.transform[5] < 45 && /^(?:A-)?\d+$/.test(i.str))!;
      const printed = Number(number.str.split('-').at(-1));
      const title = items.find((i) => i.str.includes('12345A-26/1') && i.transform[5] > 700)!;
      expect(title, `header on page ${page}`).toBeDefined();
      expect(printed % 2 ? title.transform[4] + title.width : title.transform[4]).toBeCloseTo(printed % 2 ? 540 : 72, 0);
      expect(printed % 2 ? number.transform[4] + number.width : number.transform[4]).toBeCloseTo(printed % 2 ? 540 : 72, 0);
      expect(number.fontName).toBe(title.fontName);
    }
    const cover = await textItems(bytes, 1);
    const number = cover.find((i) => i.str === '1' && i.transform[5] < 100)!;
    const pcn = cover.find((i) => i.str.includes('PCN 184'))!;
    expect(number.transform[4] + number.width).toBeCloseTo(540, 0);
    expect(pcn.transform[4] + pcn.width).toBeCloseTo(540, 0);
    expect(pcn.transform[5] - number.transform[5]).toBeCloseTo(12 * 72 / 72.27, 0);
  }, 60_000);

  it.each(['MI', 'TI', 'SI', 'LI'] as const)('exports a complete %s through the production engine', async (type) => {
    const s = baseline();
    Object.assign(s.formData, { publicationType: type, shortTitle: `${type} 12345A-26/1` });
    const action = { MI: 'Install the bracket', TI: 'Inspect the bracket', SI: 'Request the bracket', LI: 'Lubricate the bracket' }[type];
    s.paragraphs = [
      { level: 0, header: 'Purpose', text: `${action}.` },
      { level: 0, header: 'Administrative Instructions', text: '' },
      { level: 1, header: 'Point of Contact', text: `For questions or concerns with the content or procedures in this ${PUBLICATION_TYPES[type]} (${type}) contact office@example.mil.` },
      { level: 1, header: 'Notice of Discrepancies', text: DISCREPANCY_NOTICE },
      ...(type === 'MI' ? [{ level: 1, header: 'Reporting Instructions', text: MI_REPORTING }] : []),
      { level: 0, header: 'Skill and Time Required', text: 'Equipment technician, 0.5 hours.' },
      { level: 0, header: action, publicationSection: 'procedures', text: 'Follow the steps below.' },
      { level: 1, procedure: true, text: `${action}.` },
      { level: 1, procedure: true, text: 'Record completion.' },
    ];
    expect(iTypeExportErrors(s)).toEqual([]);
    const text = pages(await production(s), `accepted-${type}`).join(' ');
    expect(text).toContain(PUBLICATION_TYPES[type].toUpperCase());
    expect(text).toContain('NAVMC 10772');
    expect(text.includes('will not manually add')).toBe(type === 'MI');
  }, 60_000);

  it('resolves internal paragraph, table and footnote links after assembly', async () => {
    const s = baseline();
    const id = 'ABCDEF0123456789ABCDEF0123456789';
    const figureId = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const image = new Uint8Array(readFileSync('public/attachments/usmc-seal.png'));
    s.paragraphs = [
      { level: 0, header: 'Purpose', text: `See {{PUBREF_P_${id}}} and {{PUBREF_T_${id}}}. See {{PUBREF_F_${figureId}}}. Source: https://example.mil/CaseSensitive.` },
      ...Array.from({ length: 18 }, () => ({ level: 0, text: 'Inspect the equipment. '.repeat(14) })),
      { level: 0, header: 'Materiel Required', text: 'Use the listed parts.', referenceId: id, tableKey: 'materielRequired', tableFootnotes: [{ id: 'a', text: 'Quantity is per assembly.' }] },
      { level: 0, referenceId: figureId, text: 'Synthetic drawing', figure: { name: 'figure.png', type: 'image/png', fileRef: { id: 'reference-figure', name: 'figure.png', type: 'image/png', size: image.length } } },
    ];
    s.publicationTables = { materielRequired: [{ values: { item: '1', description: `BOLT{{PUBREF_N_${id}_A}}`, qty: '2' } }] };
    const files = generateAllLatexFiles(s);
    const base = await production(s, { [files.figures[0].file]: image });
    const attachment = await PDFDocument.create(); attachment.addPage().drawText('SYNTHETIC ENCLOSURE');
    const enclosureBytes = await attachment.save();
    const merged = await mergeEnclosures(base, [{ number: 1, title: 'Drawing', data: enclosureBytes.buffer as ArrayBuffer, pageStyle: 'fit' }], undefined, true, [], { enclosureLabel: 'footer', header: { line1: s.formData.shortTitle!, line2: '30 October 2026' } });
    expect(merged.hasErrors).toBe(false);
    const bytes = await addSignatureField(merged.pdfBytes, { signatoryName: 'J. A. DOE', lastBasicPageIndex: merged.basicPageCount! - 1 });
    writeFileSync(join(output, 'cross-references.pdf'), bytes);
    const doc = await getDocument({ data: bytes.slice() }).promise;
    const outline = await doc.getOutline();
    expect(JSON.stringify(outline)).toContain('1. Purpose');
    const linked = [];
    const urls: string[] = [];
    for (let page = 1; page <= doc.numPages; page++) {
      for (const annotation of await (await doc.getPage(page)).getAnnotations()) {
        if (annotation.url) urls.push(annotation.url);
        if (typeof annotation.dest === 'string' && annotation.dest.startsWith('itype.')) linked.push(annotation.dest);
      }
    }
    for (const destination of ['itype.p.19', 'itype.table.19', 'itype.note.19.A', 'itype.figure.20']) {
      expect(linked).toContain(destination);
      const target = await doc.getDestination(destination);
      expect(target).not.toBeNull();
      expect(await doc.getPageIndex(target![0])).toBeGreaterThan(1);
    }
    expect(urls).toContain('https://example.mil/CaseSensitive');
    await doc.destroy();
  }, 60_000);

  it('rejects a long title exceeding four rendered lines', async () => {
    const s = baseline(); s.formData.subject = 'LONG PUBLICATION TITLE '.repeat(45);
    await expect(production(s)).rejects.toThrow(/long title exceeds four lines/);
  }, 60_000);

  it('centers table titles and closes only the final table page', async () => {
    const s = baseline();
    s.paragraphs.push({ level: 0, header: 'Materiel Required', text: 'Use the listed parts.', tableKey: 'materielRequired' });
    s.publicationTables = { materielRequired: Array.from({ length: 80 }, (_, i) => ({ values: { item: String(i + 1), description: 'BOLT', pn: 'ABC123 (1AB23)', qty: '2' } })) };
    const bytes = await production(s);
    const text = pages(bytes, 'centered-table-titles');
    expect(text.join(' ')).toContain('Continued');
    let titles = 0;
    for (let page = 3; page <= text.length; page++) {
      const items = await textItems(bytes, page);
      const label = items.find((item) => item.str.startsWith('Table 1.'));
      if (!label) continue;
      const line = items.filter((item) => Math.abs(item.transform[5] - label.transform[5]) < 0.1 && item.str.trim());
      const left = Math.min(...line.map((item) => item.transform[4]));
      const right = Math.max(...line.map((item) => item.transform[4] + item.width));
      expect((left + right) / 2).toBeCloseTo(306, 0);
      const rules = (await pdfRules(bytes, page)).filter((r) => r.right - r.left > 400);
      expect(rules).toHaveLength(page === 3 || page === text.length ? 2 : 1);
      const lastRow = Math.min(...items.filter((item) => item.str === 'BOLT').map((item) => item.transform[5]));
      expect(rules.some((rule) => rule.top < lastRow)).toBe(page === text.length);
      titles++;
    }
    expect(titles).toBeGreaterThan(1);
  }, 60_000);

  it('leaves continued end-item lists open and closes the last page once', async () => {
    const s = baseline();
    s.endItems = Array.from({ length: 100 }, (_, i) => ({ ...s.endItems[0], model: `MODEL-${i + 1}` }));
    const bytes = await production(s);
    const text = pages(bytes, 'end-item-rules');
    const tablePages = text.flatMap((page, i) => page.includes('MODEL-') ? [i + 1] : []);
    expect(tablePages.length).toBeGreaterThan(1);
    for (const page of tablePages) {
      const rules = (await pdfRules(bytes, page)).filter((r) => r.right - r.left > 400);
      const last = page === tablePages.at(-1);
      expect(rules).toHaveLength(page === tablePages[0] || last ? 2 : 1);
      const items = await textItems(bytes, page);
      const lastRow = Math.min(...items.filter((item) => item.str.startsWith('MODEL-')).map((item) => item.transform[5]));
      expect(rules.some((rule) => rule.top < lastRow)).toBe(last);
    }
  }, 60_000);

  it.each([false, true])('rejects an oversized later table row or component group (nested: %s)', async (nested) => {
    const s = baseline();
    s.paragraphs.push({ level: 0, header: 'Materiel Required', text: 'Use the listed parts.', tableKey: 'materielRequired' });
    const row = (description: string, level = 0) => ({ level, values: { description, pn: 'ABC123 (1AB23)', qty: '1' } });
    s.publicationTables = { materielRequired: [row('BOLT'), row(nested ? 'ASSEMBLY' : 'Detailed component description. '.repeat(150)),
      ...(nested ? [row('Detailed component description. '.repeat(150), 1)] : [])] };
    await expect(production(s)).rejects.toThrow(/row group 2 exceeds one page/);
  }, 60_000);

  it('prints software versions under the version heading', async () => {
    const s = baseline();
    s.paragraphs.push({ level: 0, header: 'Major Items Affected', text: 'Update the software.', tableKey: 'majorItems', tableIdentifierMode: 'software' });
    s.publicationTables = { majorItems: [{ values: { description: 'CONTROLLER SOFTWARE', softwareVersion: 'v2.4.1', id: '12345A', tamcn: 'A02557G' } }] };
    const text = pages(await production(s), 'software-version');
    expect(text[2]).toContain('v2.4.1');
    expect(text[2]).toContain('Software/Firmware');
    expect(text[2]).toContain('(S/F) Version');
    expect(text[2]).not.toMatch(/\bNSN\b/);
  }, 60_000);

  it('keeps notices and PCN on the cover when six wrapping rows require continuation', async () => {
    const s = baseline();
    Object.assign(s.formData, { classLevel: 'cui', cuiDistStatement: 'D', distReason: 'Critical Technology', distDate: '2026-10-01', cuiControlledBy: 'DOD', cuiCategory: 'CTI', cuiDissemination: 'FEDCON', exportRestricted: true,
      supersedure: 'SUPERSEDURE NOTICE: This publication supersedes MI 12345A-25/1 dated October 2025.' });
    s.endItems = Array.from({ length: 6 }, () => ({ ...s.endItems[0], model: 'MODEL ALPHA BRAVO CHARLIE DELTA' }));
    const text = pages(await production(s), 'cover-continuation');
    for (const required of ['See Next Page', 'DISTRIBUTION STATEMENT D', 'WARNING:', 'DESTRUCTION NOTICE:', 'PCN 184 123456 00']) expect(text[0]).toContain(required);
    expect(text[1]).toMatch(/BRAVO\s+CHARLIE\s+DELTA/);
    expect(text.slice(1).join(' ')).not.toMatch(/PCN 184/);
  }, 60_000);

  it('keeps every parent and its first component on the same table page', async () => {
    const s = baseline(); s.paragraphs = [{ level: 0, header: 'Materiel Required', text: '', tableKey: 'materielRequired' }];
    s.publicationTables = { materielRequired: Array.from({ length: 120 }, (_, i) => ({ level: i % 2, values: { item: String(i + 1), description: `${i % 2 ? 'CHILD' : 'PARENT'} ${i + 1}`, nsn: '1005-01-566-1100', pn: 'BR-100', qty: '1' } })) };
    const text = pages(await production(s), 'parent-components');
    for (let i = 1; i <= 120; i += 2) {
      const parent = text.findIndex((p) => new RegExp(`PARENT ${i}\\b`).test(p));
      expect(parent).toBeGreaterThanOrEqual(2);
      expect(text[parent]).toMatch(new RegExp(`CHILD ${i + 1}\\b`));
    }
  }, 60_000);

  it('keeps safety groups with the first lines of their steps near page boundaries', async () => {
    for (const callouts of [['warning'], ['warning', 'caution'], ['warning', 'caution', 'note']] as CalloutKind[][]) {
      for (const count of [16, 20, 24, 28]) {
        const s = baseline();
        s.paragraphs.push(...Array.from({ length: count }, (_, i) => ({ level: 0, text: `Filler paragraph ${i + 1}.` })),
          ...callouts.map((kind) => ({ level: 0, callout: kind, text: `${kind === 'warning' ? 'DISCONNECT POWER' : kind.toUpperCase()} before removing the bracket.` })),
          { level: 1, procedure: true, text: 'STEP TARGET. Remove the bracket. Inspect the fasteners and replace any damaged part before assembling the bracket. '.repeat(3) });
        const bytes = count === 20 ? await production(s) : await local(s);
        const text = pages(bytes, `safety-${callouts.length}-${count}`);
        const target = text.findIndex((p) => p.includes('STEP TARGET'));
        expect(text[target]).toContain('DISCONNECT POWER');
      }
    }
  }, 120_000);

  it('keeps table headings with a wrapping initial parent/component group', async () => {
    for (const count of [16, 20, 24, 28]) {
      const s = baseline(); s.paragraphs.push(...Array.from({ length: count }, () => ({ level: 0, text: 'Filler paragraph.' })), { level: 0, header: 'Materiel Required', text: '', tableKey: 'materielRequired' });
      s.publicationTables = { materielRequired: [{ level: 0, values: { description: 'TABLE TARGET PARENT BRACKET ASSEMBLY WITH LONG DESCRIPTION', qty: '1' } }, { level: 1, values: { description: 'FIRST COMPONENT WITH LONG DESCRIPTION', qty: '1' } }] };
      const text = pages(await production(s), `heading-${count}`);
      const target = text.findIndex((p) => p.includes('TABLE TARGET'));
      expect(text[target]).toContain('Materiel Required'); expect(text[target]).toContain('FIRST COMPONENT');
    }
  }, 60_000);

  it('preserves selected callout, graphic and caption marks and procedural spacing', async () => {
    const s = baseline();
    const image = new Uint8Array(readFileSync('public/attachments/usmc-seal.png'));
    s.paragraphs.push({ level: 0, callout: 'warning', portionMarking: 'S', text: 'Synthetic warning.' }, { level: 0, callout: 'caution', portionMarking: 'C', text: 'Synthetic caution.' }, { level: 0, callout: 'note', portionMarking: 'U', text: 'Synthetic note.' },
      { level: 1, procedure: true, portionMarking: 'U', text: 'FIRST STEP.' }, { level: 1, procedure: true, text: 'SECOND STEP.' },
      { level: 0, text: 'Synthetic caption', portionMarking: 'U', figure: { portionMarking: 'S', name: 'graphic.png', type: 'image/png', fileRef: { id: 'graphic', name: 'graphic.png', type: 'image/png', size: image.length } } });
    const files = generateAllLatexFiles(s);
    const bytes = await production(s, { [files.figures[0].file]: image });
    const text = pages(bytes, 'marks-spacing').join('\n');
    expect(text).toMatch(/\(S\) SYNTHETIC WARNING/); expect(text).toMatch(/\(C\) Synthetic caution/); expect(text).toMatch(/\(U\) Synthetic note/); expect(text).toMatch(/Figure 1\.\s+\(U\) Synthetic caption/);
    const items = await textItems(bytes, pages(bytes, 'marks-spacing').findIndex((p) => p.includes('FIRST STEP')) + 1);
    const first = items.find((item) => item.str.includes('FIRST STEP'))!; const second = items.find((item) => item.str.includes('SECOND STEP'))!;
    expect(first.transform[5] - second.transform[5]).toBeGreaterThan(25);
  }, 60_000);

  it('preserves destinations, custom banners, enclosure numbering, and the signature page after merging', async () => {
    const s = baseline(); Object.assign(s.formData, { classLevel: 'custom', customClassification: 'SYNTHETIC TEST BANNER' });
    s.paragraphs.push({ level: 0, header: 'Materiel Required', text: '', tableKey: 'materielRequired' }, { level: 0, header: 'Reference Data', appendix: true, text: 'Appendix content.' });
    s.publicationTables = { materielRequired: [{ values: { description: 'BRACKET', qty: '1' } }] };
    const drawing = await PDFDocument.create(); drawing.addPage().drawText('DRAWING SHEET ONE');
    const bytes = await drawing.save();
    const basic = await production(s);
    for (const count of [1, 2]) {
      if (count === 2) drawing.addPage().drawText('DRAWING SHEET TWO');
      const attachment = count === 1 ? bytes : await drawing.save();
      const merged = await mergeEnclosures(basic, [{ number: 1, title: 'Drawing', data: attachment.buffer as ArrayBuffer, pageStyle: 'fit' }], publicationMarking(s.formData, s.paragraphs), true, [], { enclosureLabel: 'footer', header: { line1: s.formData.shortTitle!, line2: '30 October 2026' } });
      expect(merged.errors).toEqual([]);
      const signed = await addSignatureField(merged.pdfBytes, { signatoryName: 'J. A. DOE', lastBasicPageIndex: merged.basicPageCount! - 1 });
      const text = pages(signed, `enclosure-${count}`);
      for (let i = 0; i < count; i++) {
        const page = text.length - count + i;
        expect(text[page]).toContain('SYNTHETIC TEST BANNER');
        expect(text[page].includes('Enclosure (1)')).toBe(i === 0);
        const items = await textItems(signed, page + 1);
        expect(items.find((item) => item.str === String(i + 1))?.height).toBe(12);
        const number = items.find((item) => item.str === String(i + 1))!;
        expect(i % 2 ? number.transform[4] : number.transform[4] + number.width).toBeCloseTo(i % 2 ? 72 : 540, 0);
        const label = items.find((item) => item.str === 'Enclosure (1)');
        if (i === 0) expect(label!.transform[4] + label!.width).toBeCloseTo(540, 0);
        const header = items.filter((item) => item.str.includes('MI 12345A') || item.str.includes('30 October 2026'));
        expect(header.length).toBe(i === 0 ? 1 : 0);
        if (i === 0) expect(header[0].transform[4] + header[0].width).toBeCloseTo(540, 0);
      }
      const pdf = await getDocument({ data: signed.slice(), useSystemFonts: false }).promise;
      try {
        const outline = await pdf.getOutline(); expect(outline?.map((entry) => entry.title)).toContain('Enclosure 1. Drawing');
        const table = outline!.find((entry) => entry.title === '2. Materiel Required')!;
        expect(table.count).toBeLessThan(0); expect(table.items[0].title).toBe('Table 1. Materiel Required');
        const destinations = await pdf.getDestinations();
        expect(await pdf.getPageIndex(destinations['itype.authentication'][0])).toBe(1);
        expect(await pdf.getPageIndex(destinations['itype.p.0'][0])).toBe(2);
        expect(await pdf.getPageIndex(destinations['enclosure1'][0])).toBe(text.length - count);
      } finally { await pdf.destroy(); }
      const final = await PDFDocument.load(signed);
      const widgets = final.getForm().getFields()[0].acroField.getWidgets();
      expect(widgets[0].P()?.toString()).toBe(final.getPage(1).ref.toString());
    }
  }, 60_000);

  it('rejects missing and multi-page figures even when the engine retains a previous drawing', async () => {
    const s = baseline(); const drawing = await PDFDocument.create(); drawing.addPage().drawText('DRAWING A');
    s.paragraphs.push({ level: 0, text: 'Drawing', figure: { name: 'drawing.pdf', type: 'application/pdf', fileRef: { id: 'drawing-a', name: 'drawing.pdf', type: 'application/pdf', size: 1 } } });
    let files = generateAllLatexFiles(s);
    await production(s, { [files.figures[0].file]: await drawing.save() });
    s.paragraphs[1].figure!.fileRef!.id = 'drawing-b';
    await expect(production(s)).rejects.toThrow(/missing from this document/);
    files = generateAllLatexFiles(s); drawing.addPage().drawText('DRAWING B');
    await expect(production(s, { [files.figures[0].file]: await drawing.save() })).rejects.toThrow(/2 pages/);
  }, 60_000);
});
