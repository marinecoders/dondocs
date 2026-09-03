import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { buildBaseline } from '../_helpers/compileMatrix';
import { compileFixture } from '../_helpers/compileLatex';
import type { TestStore } from '../_helpers/compileMatrix';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

// One Modification Instruction with everything the template and the
// specification provide for, read back page by page in the order the
// document must present them. The other I-Type suites prove each part on its
// own; this one proves they stand together as a document.


const fig = (name: string, type: string, size: number) => ({ fileRef: { id: name, name, size, type }, name, type });

describeToolchainRequirement('i-type-full-document');

describe.skipIf(!hasPdfToolchain)('a complete Modification Instruction, end to end', () => {
  let pages: string[];
  let pdf: string;

  beforeAll(async () => {
    const seal = new Uint8Array(readFileSync(join(process.cwd(), 'public', 'attachments', 'usmc-seal.png')));
    const doc = await PDFDocument.create();
    doc.addPage([400, 300]).drawText('DRAWING 1', { x: 40, y: 150, size: 24, font: await doc.embedFont(StandardFonts.Helvetica) });
    const drawing = await doc.save();

    const s = buildBaseline('i_type' as never) as unknown as Record<string, unknown>;
    Object.assign(s.formData as Record<string, unknown>, {
      date: '31 Dec 24', publicationType: 'MI',
      nomenclature: 'RIFLE, 7.62MM, M40A6',
      subject: 'INSTALLATION OF THE STOCK ACCESSORY RAIL AND CHEEK PIECE',
      shortTitle: 'MI 12345A-24/1', pcn: '184 123456 00',
      miUrgency: 'urgent', miCompletionDate: '2025-06-30', exportRestricted: true,
      supersedure: 'SUPERSEDURE NOTICE: This publication supersedes MI 12344A-24/1 dated JANUARY 2025.',
      unitLine1: 'UNITED STATES MARINE CORPS', unitLine2: 'MARINE CORPS SYSTEMS COMMAND', unitAddress: '2200 LESTER STREET, QUANTICO, VA 22134',
      signatureType: 'digital', sigFirst: 'J.', sigMiddle: 'A.', sigLast: 'DOE', sigTitle: 'Program Manager, Infantry Weapons', sigRank: 'Colonel, U.S. Marine Corps',
      controllingOffice: 'GWS', pocEmail: 'john.doe@usmc.mil',
      classLevel: 'cui', cuiControlledBy: 'DOD', cuiCategory: 'CTI', cuiDissemination: 'FEDCON',
      cuiDistStatement: 'D', distReason: 'Critical Technology', distDate: '2024-12-01',
    });
    s.endItems = Array.from({ length: 7 }, (_, i) => ({ nsn: `1005-01-566-110${i}`, tamcn: `A0255${i}G`, id: `1103${i}A`, model: `M40A6-${i}` }));
    s.enclosures = [{ title: 'Parts Diagram' }];
    s.paragraphs = [
      { text: 'To provide instructions for installing the stock accessory rail and cheek piece on the M40A6 rifle.', level: 0, header: 'Purpose' },
      { text: 'For concerns or issues with the content or procedures contact the program office.', level: 0, header: 'Administrative Instructions' },
      { text: 'Complete this modification by 30 June 2025.', level: 0, header: 'Time Compliance Period' },
      { text: 'The accessory rail allows mounting of night optics.', level: 0, header: 'Information' },
      { text: 'TM 12345A-OI/1 is affected by this instruction.', level: 0, header: 'Technical Manuals Affected' },
      { text: '', level: 0, header: 'Major Items Affected', tableKey: 'majorItems' },
      { text: '', level: 0, header: 'Components Affected', tableKey: 'components' },
      { text: '', level: 0, header: 'Materiel Affected' },
      { text: '', level: 1, header: 'Materiel Required', tableKey: 'materielRequired' },
      { text: 'Dispose of discarded materiel in accordance with current Marine Corps directives.', level: 1, header: 'Materiel Discarded', tableKey: 'materielDiscarded' },
      { text: '', level: 1, header: 'Materiel Retained', tableKey: 'materielRetained' },
      { text: '', level: 1, header: 'Bulk and Consumable Materiel', tableKey: 'materielBulk' },
      { text: '', level: 0, header: 'Special Tools, Jigs, and Fixtures Required' },
      { text: '', level: 1, header: 'Special Tools', tableKey: 'specialTools' },
      { text: '', level: 1, header: 'Jigs and Fixtures', tableKey: 'jigsFixtures' },
      { text: 'Apply thread locker to all screws.', level: 0, header: 'Special Instructions' },
      { text: 'Requisition the kit through normal supply channels.', level: 0, header: 'Supply Action' },
      { text: '2111 Small Arms Repairer, or technician with equivalent skills, 2.0 hours.', level: 0, header: 'Skill and Time Required' },
      { text: 'Install the accessory rail and cheek piece.', level: 0, header: 'Procedures' },
      { text: 'Ensure the weapon is clear and the bolt is removed before beginning work.', level: 0, callout: 'warning' },
      { text: 'Do not use power tools on the rail screws; over-torque will strip the receiver threads.', level: 0, callout: 'caution' },
      { text: 'A torque wrench calibrated in inch-pounds is required.', level: 0, callout: 'note' },
      { text: 'Remove the existing stock.', level: 0, procedure: true },
      { text: 'Loosen the two action screws.', level: 1, procedure: true },
      { text: 'Lift the barreled action clear of the stock.', level: 1, procedure: true },
      { text: 'Rail alignment', level: 0, figure: fig('rail.png', 'image/png', seal.length) },
      { text: 'Install the accessory rail.', level: 0, procedure: true },
      { text: 'Align the rail with the forend holes.', level: 1, procedure: true },
      { text: 'Start all four screws by hand.', level: 2, procedure: true },
      { text: 'Torque the screws to 25 inch-pounds in a cross pattern.', level: 2, procedure: true },
      { text: 'Check the first screw.', level: 3, procedure: true },
      { text: 'Check the second screw.', level: 3, procedure: true },
      { text: 'Fit the cheek piece.', level: 1, procedure: true },
      { text: 'Rail drawing', level: 0, figure: fig('rail.pdf', 'application/pdf', drawing.length) },
      { text: 'Record completion in the weapon record book.', level: 0, header: 'Records and Reports' },
      { text: 'Rail screws 25 in-lb; action screws 65 in-lb.', level: 0, header: 'Torque Values', appendix: true },
      { text: 'Torque chart', level: 0, figure: fig('chart.png', 'image/png', seal.length) },
    ];
    const materiel = (n: number) => [
      { values: { item: '1', description: 'KIT, ACCESSORY RAIL', nsn: '1005-01-566-1300', pn: 'KIT-AR-1', qty: '1' } },
      { values: { item: '2', description: 'RAIL, 1913', nsn: '1005-01-566-1301', pn: 'RL-1913', qty: '1' }, level: 1 },
      { values: { item: '3', description: 'SCREW, CAP', nsn: '', pn: `MS16995-${n} (1CSL0)`, qty: '4' }, level: 1 },
    ];
    s.publicationTables = {
      majorItems: [{ values: { description: 'RIFLE, 7.62MM, M40A6', nsn: '1005-01-566-1100', tamcn: 'A02550G', id: '11030A' } }],
      components: [{ values: { item: '1', description: 'STOCK ASSEMBLY', nsn: '1005-01-566-1200', pn: '12345-STK' } }],
      materielRequired: materiel(14),
      materielDiscarded: [{ values: { description: 'STOCK, ORIGINAL', nsn: '1005-01-566-1000', pn: 'STK-0', qty: '1' } }],
      materielRetained: [{ values: { description: 'SLING, RIFLE', nsn: '1005-01-566-1001', pn: 'SL-1', qty: '1' } }],
      materielBulk: [{ values: { description: 'GREASE, MOLD RELEASE', nsn: '9150-00-123-4567', pn: 'GR-1', qty: '1' } }],
      specialTools: [{ values: { description: 'WRENCH, TORQUE, 10-150 IN-LB', nsn: '5120-01-234-5678', pn: 'TW-150', qty: '1' } }],
      jigsFixtures: [{ values: { description: 'FIXTURE, STOCK', nsn: '', pn: 'FX-1 (1CSL0)', qty: '1' } }],
    };
    const r = await compileFixture(s as unknown as TestStore, { 'attachments/figure-1.png': seal, 'attachments/figure-2.pdf': drawing, 'attachments/figure-3.png': seal });
    expect(r.ok, r.errors.slice(0, 5).join('\n')).toBe(true);
    pdf = join(mkdtempSync(join(tmpdir(), 'itype-full-')), 'full.pdf');
    writeFileSync(pdf, r.pdfBytes!);
    const n = Number(/Pages:\s+(\d+)/.exec(spawnSync('pdfinfo', [pdf], { encoding: 'utf8' }).stdout)?.[1] ?? 0);
    pages = Array.from({ length: n }, (_, i) => spawnSync('pdftotext', ['-f', String(i + 1), '-l', String(i + 1), pdf, '-'], { encoding: 'utf8' }).stdout);
  }, 150_000);

  const order = (page: string, ...needles: (string | RegExp)[]) => {
    let at = -1;
    for (const needle of needles) {
      const i = typeof needle === 'string' ? page.indexOf(needle, at + 1) : page.slice(at + 1).search(needle) + (at + 1);
      expect(i, `${String(needle)} after position ${at}`).toBeGreaterThan(at);
      at = i;
    }
  };

  it('opens with the cover, its header lines and footer notices in the template\'s order', () => {
    order(pages[0], 'CUI', 'DECEMBER 2024', 'MI 12345A-24/1', 'U.S. MARINE CORPS MODIFICATION INSTRUCTION', 'INSTALLATION OF THE STOCK ACCESSORY RAIL AND CHEEK PIECE', 'URGENT',
      'RIFLE, 7.62MM, M40A6', 'NSN', 'See Next Page',
      'Controlled by: DOD, Program Manager, Infantry Weapons GWS', 'CUI Category: CTI', 'Distribution/Dissemination Control: FEDCON', 'POC: john.doe@usmc.mil',
      'SUPERSEDURE NOTICE', 'DISTRIBUTION STATEMENT D', 'Critical Technology', '1 December 2024', 'referred to GWS', 'WARNING: This document contains technical data', 'DESTRUCTION NOTICE', 'PCN 184 123456 00');
  });

  it('lists all seven end items on the back of the cover', () => {
    for (let i = 0; i < 7; i++) expect(pages[1]).toMatch(new RegExp(`1005-01-566-110${i}`));
    order(pages[1], 'NSN', 'TAMCN', 'ID', 'MODEL');
  });

  it('authenticates on page three: command, full date, the five paragraphs, signature, distribution, attachments', () => {
    order(pages[2], 'MI 12345A-24/1', 'UNITED STATES MARINE CORPS', 'MARINE CORPS SYSTEMS COMMAND', '2200 LESTER STREET', '31 December 2024',
      /1\.\s+This Modification Instruction, MI 12345A-24\/1, is/, /2\.\s+Per MCO 5100\.34/, /All significant hazards/, /3\.\s+Use TDM-Publications portal/,
      /4\.\s+For concerns\/issues with the content\/procedures contact\s+Equipment/, /5\.\s+GCSS-MC Recording/,
      'OFFICIAL', 'J. A. DOE', 'Program Manager, Infantry Weapons', 'GWS', 'DISTRIBUTION: EDO', 'Appendix A: Torque Values', 'Enclosure (1): Parts Diagram');
    expect(pages[2]).not.toMatch(/Colonel|Controlled by/);
  });

  it('sets the body in the fixed paragraph order with every callout, step level and figure, then closes', () => {
    const body = pages.slice(3, pages.findIndex((p) => /APPENDIX A/.test(p))).join('\n');
    order(body,
      /1\.\s+Purpose/, /2\.\s+Administrative Instructions/, /3\.\s+Time Compliance Period/, /4\.\s+Information/, /5\.\s+Technical Manuals Affected/,
      /6\.\s+Major Items Affected/, /7\.\s+Components Affected/, /8\.\s+Materiel Affected/, /a\.\s+Materiel Required/, /b\.\s+Materiel Discarded/,
      /c\.\s+Materiel Retained/, /d\.\s+Bulk and Consumable Materiel/, /9\.\s+Special Tools, Jigs, and Fixtures Required/, /a\.\s+Special Tools/, /b\.\s+Jigs and Fixtures/,
      /10\.\s+Special Instructions/, /11\.\s+Supply Action/, /12\.\s+Skill and Time Required/, '2111 Small Arms Repairer',
      /13\.\s+Procedures/, 'WARNING', 'ENSURE THE WEAPON IS CLEAR', 'CAUTION', 'Do not use power tools', 'NOTE', 'A torque wrench',
      /14\.\s+Remove the existing stock/, /a\.\s+Loosen the two action screws/, /b\.\s+Lift the barreled action/,
      /Figure 1\.\s+Rail alignment/,
      /15\.\s+Install the accessory rail/, /a\.\s+Align the rail/, /\(1\)\s+Start all four screws/, /\(2\)\s+Torque the screws/, /\(a\)\s+Check the first screw/, /\(b\)\s+Check the second screw/, /b\.\s+Fit the cheek piece/,
      'DRAWING 1', /Figure 2\.\s+Rail drawing/,
      /16\.\s+Records and Reports/, 'END OF INSTRUCTION');
    expect(body).not.toMatch(/\bRef:|\bEncl:/);
  });

  it('fills all eight tables, with the kit\'s parts under Consisting of: and a CAGE under a part number', () => {
    const body = pages.slice(3).join('\n');
    // pdftotext walks a table's columns rather than its rows, so cells are
    // asserted by presence, the boxheads by their labels.
    for (const cell of ['I.D. No.', 'A02550G', 'STOCK ASSEMBLY', 'KIT, ACCESSORY RAIL', 'Consisting of:', 'RAIL, 1913', 'MS16995-14', '(1CSL0)',
      'STOCK, ORIGINAL', 'SLING, RIFLE', 'GREASE, MOLD RELEASE', 'WRENCH, TORQUE', 'FIXTURE, STOCK', 'FX-1']) {
      expect(body, cell).toContain(cell);
    }
    expect((body.match(/\bQty\b/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it('ends with the appendix, lettered, titled, numbered A-1, its figure numbered with the letter', () => {
    const last = pages[pages.length - 1];
    order(last, 'MI 12345A-24/1', '31 December 2024', 'APPENDIX A', 'TORQUE VALUES', 'Rail screws 25 in-lb', /Figure A-1\.\s+Torque chart/, 'A-1');
  });

  it('places every image: the seal, two raster figures, and keeps every page inside the margins', () => {
    const images = spawnSync('pdfimages', ['-list', pdf], { encoding: 'utf8' }).stdout.split('\n').filter((l) => /\bimage\b/.test(l));
    expect(images.length).toBeGreaterThanOrEqual(3);
    for (let page = 1; page <= pages.length; page++) {
      const html = spawnSync('pdftotext', ['-bbox-layout', '-f', String(page), '-l', String(page), pdf, '-'], { encoding: 'utf8' }).stdout;
      const boxes = Array.from(html.matchAll(/<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/line>/g))
        .map((m) => ({ x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], text: Array.from(m[5].matchAll(/>([^<]+)<\/word>/g)).map((w) => w[1]).join(' ') }))
        .filter((l) => l.text !== 'CUI');
      for (const l of boxes) {
        expect(l.x0, `page ${page}: ${l.text}`).toBeGreaterThanOrEqual(71);
        expect(l.x1, `page ${page}: ${l.text}`).toBeLessThanOrEqual(541);
        expect(l.y1, `page ${page}: ${l.text}`).toBeLessThanOrEqual(792 - 0.3 * 72 + 2);
      }
    }
  });
});
