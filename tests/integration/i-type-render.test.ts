import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { buildBaseline } from '../_helpers/compileMatrix';
import { compileFixture } from '../_helpers/compileLatex';
import type { TestStore } from '../_helpers/compileMatrix';
import type { Paragraph } from '@/types/document';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

// The I-Type's rules are typographic, so they are proved on the rendered
// page rather than on the LaTeX that produced it: the compile matrix already
// shows every fixture compiles, and a string test on generated TeX passes
// while proving nothing about what a Marine sees. These read the PDF back
// with pdftotext and check the rules the MARCORSYSCOM template states.


async function renderDocument(mutate: (s: Record<string, unknown>) => void, extraFiles: Record<string, Uint8Array> = {}): Promise<{ pages: string[]; pdf: string }> {
  const store = buildBaseline('i_type' as never) as unknown as Record<string, unknown>;
  mutate(store);
  const r = await compileFixture(store as unknown as TestStore, extraFiles);
  expect(r.ok, r.errors.slice(0, 4).join('\n')).toBe(true);
  const pdf = join(mkdtempSync(join(tmpdir(), 'itype-')), 'o.pdf');
  writeFileSync(pdf, r.pdfBytes!);
  const n = Number(/Pages:\s+(\d+)/.exec(spawnSync('pdfinfo', [pdf], { encoding: 'utf8' }).stdout)?.[1] ?? 0);
  const pages = Array.from({ length: n }, (_, i) =>
    spawnSync('pdftotext', ['-f', String(i + 1), '-l', String(i + 1), pdf, '-'], { encoding: 'utf8' }).stdout
  );
  return { pages, pdf };
}

const renderPages = async (mutate: (s: Record<string, unknown>) => void, extraFiles: Record<string, Uint8Array> = {}) =>
  (await renderDocument(mutate, extraFiles)).pages;

/** Every text line on a page with its box, in points from the page's top-left. */
function lineBoxes(pdf: string, page: number): { x0: number; y0: number; x1: number; y1: number; text: string }[] {
  const html = spawnSync('pdftotext', ['-bbox-layout', '-f', String(page), '-l', String(page), pdf, '-'], { encoding: 'utf8' }).stdout;
  return Array.from(html.matchAll(/<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/line>/g)).map((m) => ({
    x0: Number(m[1]), y0: Number(m[2]), x1: Number(m[3]), y1: Number(m[4]),
    text: Array.from(m[5].matchAll(/>([^<]+)<\/word>/g)).map((w) => w[1]).join(' '),
  }));
}

describeToolchainRequirement('i-type-render');

/** Every word on a page with its left edge, in points from the page's left. */
function wordBoxes(pdf: string, page: number): { x0: number; text: string }[] {
  const xml = spawnSync('pdftotext', ['-bbox', '-f', String(page), '-l', String(page), pdf, '-'], { encoding: 'utf8' }).stdout;
  return Array.from(xml.matchAll(/<word xMin="([\d.]+)"[^>]*>([^<]+)<\/word>/g)).map((m) => ({ x0: Number(m[1]), text: m[2] }));
}

describe.skipIf(!hasPdfToolchain)('I-Type renders per the template', () => {
  let pages: string[];

  beforeAll(async () => {
    pages = await renderPages((s) => {
      Object.assign(s.formData as Record<string, unknown>, {
        date: '15 Dec 24',
        nomenclature: 'RIFLE, 7.62MM, M40A6',
        subject: 'INSTALLATION OF THE STOCK ACCESSORY RAIL',
        shortTitle: 'MI 12345A-24/1',
        pcn: '184 123456 00',
        miUrgency: 'urgent',
        exportRestricted: true,
        supersedure: 'SUPERSEDURE NOTICE: This publication supersedes MI 12344A-24/1 dated 1 Jan 2025.',
        signatureType: 'digital',
        classLevel: 'cui', cuiControlledBy: 'DOD', cuiCategory: 'PRVCY',
        cuiDissemination: 'FEDCON', cuiDistStatement: 'D',
      });
      s.endItems = Array.from({ length: 7 }, (_, i) => ({
        nsn: `5895-01-520-436${i}`, tamcn: `A0255${i}G`, id: `1103${i}A`, model: `V${i}`,
      }));
      s.paragraphs = [
        { text: 'To provide instructions.', level: 0, header: 'Purpose' },
        { text: '', level: 0, header: 'Materiel Required', tableKey: 'materielRequired' },
        { text: 'Do not exceed the torque limit.', level: 0, callout: 'warning' },
        { text: 'Remove the stud.', level: 0, procedure: true },
      ];
      s.publicationTables = {
        materielRequired: [{ values: { description: 'TIE DOWN STRAPS', nsn: '5975-00-984-6582', pn: 'MS3367-1-0', qty: '4' } }],
      };
    });
  }, 90_000);

  it('heads the cover with the anticipated month and year, not the day', () => {
    expect(pages[0]).toMatch(/DECEMBER 2024/);
    expect(pages[0]).not.toMatch(/15 Dec 24/);
  });

  it('carries the fixed notices at the foot of the cover', () => {
    expect(pages[0]).toMatch(/DISTRIBUTION STATEMENT D: Distribution authorized to Department of Defense/);
    expect(pages[0]).toMatch(/Arms Export Control Act/);
    expect(pages[0]).toMatch(/DESTRUCTION NOTICE: Destroy by making this publication unreadable/);
    expect(pages[0]).toMatch(/PCN 184 123456 00/);
    expect(pages[0]).toMatch(/SUPERSEDURE NOTICE/);
  });

  it('prints the PCN on the cover only', () => {
    expect(pages.slice(1).join('\n')).not.toMatch(/PCN 184/);
  });

  it('moves seven end items to the back of the cover, all of them', () => {
    expect(pages[0]).toMatch(/See Next Page/);
    expect(pages[1]).toMatch(/5895-01-520-4360/);
    expect(pages[1]).toMatch(/5895-01-520-4366/);
  });

  it('names the publication by type and number in the authentication sentence', () => {
    const body = pages.join('\n');
    expect(body).toMatch(/This Modification Instruction, MI 12345A-24\/1, is\s+authenticated for Marine Corps use/);
  });

  it('records the modification — the MI-only paragraph, in the template\'s words', () => {
    expect(pages.join('\n')).toMatch(/5\.\s+GCSS-MC Recording\. Ensure appropriate records are updated/);
  });

  it('leaves the hazard-report sentence unnumbered, as the template does', () => {
    // The template gives this paragraph no numbering properties, so the list
    // runs 1, 2, [hazards], 3, 4 -- and the MI item it hardcodes as "5." only
    // lands on 5 if the POC sentence is numbered 4.
    const auth = pages.find((p) => /authenticated for Marine Corps use/.test(p))!;
    expect(auth).toMatch(/All significant hazards[\s\S]*?Hazard Report per MCO 5100\.29/);
    expect(auth).not.toMatch(/3\.\s+All significant hazards/);
    expect(auth).toMatch(/3\.\s+Use TDM-Publications portal/);
  });

  it('runs the short title and the full date on every page after the cover', () => {
    for (const p of pages.slice(1)) {
      expect(p).toMatch(/MI 12345A-24\/1/);
      expect(p).toMatch(/15 December 2024/);
      expect(p).not.toMatch(/15 Dec 24/);
    }
  });

  it('sets a WARNING entirely in capitals', () => {
    expect(pages.join('\n')).toMatch(/WARNING\s+DO NOT EXCEED THE TORQUE LIMIT\./);
  });

  it('does not number a callout, and keeps the steps consecutive around it', () => {
    const body = pages.join('\n');
    expect(body).toMatch(/1\.\s+Purpose/);
    expect(body).toMatch(/3\.\s+Remove the stud/);
    expect(body).not.toMatch(/\d\.\s+DO NOT EXCEED/);
  });

  it('drops the Item column from a table where no row uses it', () => {
    const body = pages.join('\n');
    expect(body).toMatch(/Description/);
    expect(body).not.toMatch(/\bItem\b\s+Description/);
  });

  it('starts an appendix on its own page, lettered and titled, numbered A-1', async () => {
    const own = await renderPages((s) => {
      Object.assign(s.formData as Record<string, unknown>, { date: '15 Dec 24', shortTitle: 'MI 12345A-24/1', subject: 'TITLE' });
      (s.paragraphs as Paragraph[]).push({ text: 'Values apply at 20 C.', level: 0, header: 'Torque Values', appendix: true });
    });
    const last = own[own.length - 1];
    expect(last).toMatch(/APPENDIX A/);
    expect(last).toMatch(/TORQUE VALUES/);
    expect(last).toMatch(/\bA-1\b/);
  });
});

// What the MARCORSYSCOM template settles beyond the standard: read off the
// template's own header, footer, and authentication page.
describe.skipIf(!hasPdfToolchain)('I-Type follows the template page for page', () => {
  let pages: string[];
  let pdf: string;

  beforeAll(async () => {
    ({ pages, pdf } = await renderDocument((s) => {
      Object.assign(s.formData as Record<string, unknown>, {
        date: '15 Dec 24', subject: 'INSTALLATION OF THE RAIL', shortTitle: 'MI 12345A-24/1',
        unitLine1: 'UNITED STATES MARINE CORPS', unitLine2: 'MARINE CORPS SYSTEMS COMMAND',
        pocEmail: 'john.doe@usmc.mil',
        sigFirst: 'J.', sigLast: 'DOE', sigTitle: 'Program Manager, Infantry Weapons', sigRank: 'Colonel, U.S. Marine Corps',
        controllingOffice: 'PM IW', distReason: 'Critical Technology', distDate: '2024-12-01',
        classLevel: 'cui', cuiControlledBy: 'DOD', cuiCategory: 'CTI', cuiDissemination: 'FEDCON', cuiDistStatement: 'D',
      });
      s.references = [{ letter: 'a', title: 'TM 12345A-OI/1' }];
      s.enclosures = [{ title: 'Parts Diagram' }];
      s.paragraphs = [
        { text: 'To provide instructions.', level: 0, header: 'Purpose' },
        { text: '', level: 0, header: 'Materiel Required', tableKey: 'materielRequired' },
        { text: 'Values apply at 20 C.', level: 0, header: 'Torque Values', appendix: true },
      ];
      s.publicationTables = { materielRequired: [
        { values: { item: '1', description: 'KIT, ACCESSORY RAIL', nsn: '1005-01-566-1300', pn: 'KIT-AR-1', qty: '1' } },
        { values: { item: '1a', description: 'RAIL, 1913', nsn: '1005-01-566-1301', pn: 'RL-1913', qty: '1' }, level: 1 },
      ] };
    }));
  }, 90_000);

  it('opens the cover header with the date left and the short title right', () => {
    // pdftotext splits a left/right pair onto two lines; both must come
    // before the type line, and nothing but the marking may precede them.
    const lines = pages[0].split('\n').map((l) => l.trim()).filter(Boolean);
    const date = lines.indexOf('DECEMBER 2024');
    const short = lines.indexOf('MI 12345A-24/1');
    const type = lines.findIndex((l) => /U\.S\. MARINE CORPS MODIFICATION INSTRUCTION/.test(l));
    expect(date).toBeGreaterThanOrEqual(0);
    expect(short).toBeGreaterThanOrEqual(0);
    expect(Math.max(date, short)).toBeLessThan(type);
    expect(lines.slice(0, Math.min(date, short))).toEqual(['CUI']);
  });

  it('carries the Marine Corps seal, 300 by 300, on the cover', () => {
    const list = spawnSync('pdfimages', ['-list', '-f', '1', '-l', '1', pdf], { encoding: 'utf8' }).stdout;
    expect(list).toMatch(/image\s+300\s+300/);
    expect(pages[0]).not.toMatch(/add usmc-seal/);
  });

  it('keeps the CUI block off the authentication page -- the cover footer and banners carry it', () => {
    expect(pages[1]).not.toMatch(/Controlled by:/);
    expect(pages[1].split('\n').map((l) => l.trim())).not.toContain('D');
  });

  it('heads the authentication page with service, command, and date', () => {
    expect(pages[1]).toMatch(/UNITED STATES MARINE CORPS\s+MARINE CORPS SYSTEMS COMMAND/);
    expect(pages[1]).toMatch(/15 December 2024/);
  });

  it('numbers the point of contact as item 4, with the role the template fixes', () => {
    const auth = pages.find((p) => /authenticated for Marine Corps use/.test(p))!;
    expect(auth).toMatch(/4\.\s+For\s+concerns\/issues\s+with\s+the\s+content\/procedures\s+contact\s+Equipment\s+Specialist\s+or\s+designated\s+Program\s+Office\s+representative,\s+john\.doe@usmc\.mil/);
  });

  it('lists appendices and enclosures under DISTRIBUTION', () => {
    expect(pages[1]).toMatch(/DISTRIBUTION: EDO\s+Appendix A: Torque Values\s+Enclosure \(1\): Parts Diagram/);
  });

  it('signs with name, signing authority, and controlling office -- and no rank line', () => {
    expect(pages[1]).toMatch(/OFFICIAL\s+J\. A\. DOE\s+Program Manager, Infantry Weapons\s+PM IW\s+DISTRIBUTION: EDO/);
    expect(pages[1]).not.toMatch(/Colonel/);
  });

  it('prints the distribution statement with its reason, date, and controlling office', () => {
    // pdftotext wraps where the page does; the words are what matter.
    const sentence = 'DISTRIBUTION STATEMENT D: Distribution authorized to Department of Defense and U.S. DoD contractors only (Critical Technology) (1 December 2024). Other requests for this document must be referred to PM IW.';
    const wrapped = new RegExp(sentence.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'));
    expect(pages[0]).toMatch(wrapped);
  });

  it('composes Controlled by from entity, signing authority, and controlling office', () => {
    expect(pages[0]).toMatch(/Controlled by: DOD, Program Manager, Infantry Weapons PM IW/);
  });

  it('dates the authentication page in full, with the short title alone in its header', () => {
    expect(pages[1]).toMatch(/15 December 2024/);
    expect(pages[1]).not.toMatch(/15 Dec 24/);
  });

  it('closes the instruction with END OF INSTRUCTION, before the appendix', () => {
    const body = pages.findIndex((p) => /END OF INSTRUCTION/.test(p));
    const appendix = pages.findIndex((p) => /APPENDIX A/.test(p));
    expect(body).toBeGreaterThanOrEqual(0);
    expect(body).toBeLessThan(appendix);
  });

  it('centres the short title and date in an appendix header, above the appendix title', () => {
    // pdftotext may split the centred pair at its gap; both precede the title.
    const lines = pages[pages.length - 1].split('\n').map((l) => l.trim()).filter(Boolean);
    const title = lines.indexOf('APPENDIX A');
    const short = lines.findIndex((l) => /MI 12345A-24\/1/.test(l));
    const date = lines.findIndex((l) => /15 December 2024/.test(l));
    expect(short).toBeGreaterThanOrEqual(0);
    expect(date).toBeGreaterThanOrEqual(0);
    expect(Math.max(short, date)).toBeLessThan(title);
  });

  it("labels a parent item's parts with a Consisting of: row", () => {
    expect(pages.join('\n')).toMatch(/KIT, ACCESSORY RAIL[\s\S]*Consisting of:[\s\S]*RAIL, 1913/);
  });

  it('keeps the margins the template sets: one inch at the sides, banners at its header and footer', () => {
    const IN = 72;
    for (let page = 1; page <= pages.length; page++) {
      const lines = lineBoxes(pdf, page);
      const banners = lines.filter((l) => l.text === 'CUI');
      expect(banners.length).toBe(2);
      // Header begins 0.6in from the top; the footer ends 0.18in from the bottom.
      expect(Math.abs(banners[0].y0 - 0.6 * IN)).toBeLessThan(3);
      expect(Math.abs(792 - banners[1].y1 - 0.18 * IN)).toBeLessThan(4);
      // One inch at the left and right, tables included.
      for (const l of lines.filter((l) => l.text !== 'CUI')) {
        expect(l.x0).toBeGreaterThanOrEqual(IN - 1);
        expect(l.x1).toBeLessThanOrEqual(612 - IN + 1);
      }
      // Nothing below the banner: the page number and, on the cover, the PCN.
      const lowest = Math.max(...lines.filter((l) => l.text !== 'CUI').map((l) => l.y1));
      expect(lowest).toBeLessThanOrEqual(banners[1].y0 + 1);
    }
  });

  it('prints no letter-style Ref: or Encl: list', () => {
    const body = pages.join('\n');
    expect(body).not.toMatch(/\bRef:/);
    expect(body).not.toMatch(/\bEncl:/);
  });

  it('names a Technical Instruction as one, and does not ask it to record a modification', async () => {
    const ti = await renderPages((s) => {
      Object.assign(s.formData as Record<string, unknown>, { date: '15 Dec 24', subject: 'TITLE', shortTitle: 'TI 12345A-24/1', publicationType: 'TI' });
    });
    expect(ti[0]).toMatch(/U\.S\. MARINE CORPS TECHNICAL INSTRUCTION/);
    expect(ti[1]).toMatch(/This Technical Instruction, TI 12345A-24\/1, is\s+authenticated/);
    expect(ti[1]).not.toMatch(/GCSS-MC Recording/);
  });

  it('places a figure image with its numbered title beneath', async () => {
    const image = new Uint8Array(readFileSync(join(process.cwd(), 'public', 'attachments', 'usmc-seal.png')));
    const { pages, pdf: out } = await renderDocument((s) => {
      Object.assign(s.formData as Record<string, unknown>, { date: '15 Dec 24', subject: 'TITLE', shortTitle: 'MI 1' });
      s.paragraphs = [
        { text: 'To provide instructions.', level: 0, header: 'Purpose' },
        { text: 'Rail alignment', level: 0, figure: { fileRef: { id: 'f', name: 'rail.png', size: image.length, type: 'image/png' }, name: 'rail.png', type: 'image/png' } },
        { text: 'Remove the stock.', level: 0 },
      ];
    }, { 'attachments/figure-1.png': image });
    const body = pages.join('\n');
    expect(body).toMatch(/Figure 1\. Rail alignment/);
    expect(body).not.toMatch(/add image/);
    expect(body).toMatch(/2\.\s+Remove the stock/);
    // The seal on the cover and the figure in the body.
    const images = spawnSync('pdfimages', ['-list', out], { encoding: 'utf8' }).stdout.split('\n').filter((l) => /\bimage\b/.test(l));
    expect(images.length).toBeGreaterThanOrEqual(2);
  });

  it('carries a long parts list and a long end item list across pages, every row kept', async () => {
    const { pages, pdf: out } = await renderDocument((s) => {
      Object.assign(s.formData as Record<string, unknown>, { date: '15 Dec 24', subject: 'TITLE', shortTitle: 'MI 1' });
      s.endItems = Array.from({ length: 39 }, (_, i) => ({ nsn: `1005-01-566-${1000 + i}`, tamcn: `A${i}G`, id: `I${i}`, model: `M${i}` }));
      s.paragraphs = [{ text: '', level: 0, header: 'Materiel Required', tableKey: 'materielRequired' }];
      s.publicationTables = { materielRequired: Array.from({ length: 60 }, (_, i) => ({ values: { item: String(i + 1), description: `PART NUMBER ${i + 1} OF THE KIT`, nsn: `5305-00-123-${4000 + i}`, pn: `PN-${i + 1}`, qty: '1' } })) };
    });
    const body = pages.join('\n');
    for (let n = 1; n <= 60; n++) expect(body, `row ${n} of the parts list is missing`).toMatch(new RegExp(`PART NUMBER ${n} OF THE KIT`));
    expect(body).toMatch(/1005-01-566-1038/);
    expect(body).toMatch(/Materiel Required -- Continued|Materiel Required – Continued|Materiel Required — Continued/);
    // Nothing is placed below the page's bottom margin on any page.
    for (let page = 1; page <= pages.length; page++) {
      const lowest = Math.max(...lineBoxes(out, page).filter((l) => l.text !== 'CUI').map((l) => l.y1));
      expect(lowest).toBeLessThanOrEqual(792 - 0.3 * 72);
    }
  });

  it('places a PDF page as a figure', async () => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    page.drawText('DRAWING 1', { x: 40, y: 150, size: 24, font: await doc.embedFont(StandardFonts.Helvetica) });
    const drawing = await doc.save();
    const pages = await renderPages((s) => {
      Object.assign(s.formData as Record<string, unknown>, { date: '15 Dec 24', subject: 'TITLE', shortTitle: 'MI 1' });
      s.paragraphs = [
        { text: 'To provide instructions.', level: 0, header: 'Purpose' },
        { text: 'Rail drawing', level: 0, figure: { fileRef: { id: 'd', name: 'rail.pdf', size: drawing.length, type: 'application/pdf' }, name: 'rail.pdf', type: 'application/pdf' } },
      ];
    }, { 'attachments/figure-1.pdf': drawing });
    const body = pages.join('\n');
    expect(body).toMatch(/DRAWING 1/);
    expect(body).toMatch(/Figure 1\. Rail drawing/);
  });

  it('never leaves a warning or caution at the foot of a page', async () => {
    const many = await renderPages((s) => {
      Object.assign(s.formData as Record<string, unknown>, { date: '15 Dec 24', subject: 'TITLE', shortTitle: 'MI 1' });
      s.paragraphs = Array.from({ length: 30 }, (_, i) => [
        { text: `Mind the pinch point at station ${i}.`, level: 0, callout: (['caution', 'warning'] as const)[i % 2] },
        { text: `Fit part ${i} and torque it to the value in the table.`, level: 0, procedure: true },
      ]).flat();
    });
    expect(many.length).toBeGreaterThan(3);
    for (const page of many.slice(2, -1)) {
      const lines = page.split('\n').map((l) => l.trim()).filter((l) => l && !/^(CUI|\d+|[A-Z]-\d+)$/.test(l));
      expect(lines[lines.length - 1]).toMatch(/^\d+\.\s+Fit part/);
    }
  });
});

describe.skipIf(!hasPdfToolchain)('I-Type stays inside its page', () => {
  // A part number is one token with no space or hyphen to break at, and TeX
  // will not hyphenate a word containing digits. Over ~24 characters it used
  // to print through the next column and, past ~38, off the sheet.
  it('breaks an over-long part number inside its own column', async () => {
    const { pages, pdf: out } = await renderDocument((s) => {
      Object.assign(s.formData as Record<string, unknown>, { date: '15 Dec 24', subject: 'TITLE', shortTitle: 'MI 1' });
      s.paragraphs = [{ text: '', level: 0, header: 'Materiel Required', tableKey: 'materielRequired' }];
      s.publicationTables = {
        materielRequired: [{ values: { item: '1', description: 'KIT, ACCESSORY RAIL', nsn: '1005015661300', pn: 'MS3367100000000ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', qty: '1' } }],
      };
    });
    // 1in margins on a 8.5in page: the text block ends 1in from the right.
    const rightEdge = 612 - 72;
    for (let page = 1; page <= pages.length; page++) {
      for (const line of lineBoxes(out, page)) {
        expect(line.x1, `"${line.text.slice(0, 30)}" runs past the right margin on page ${page}`).toBeLessThanOrEqual(rightEdge + 0.5);
      }
    }
  });

  // MIL-STD-38784C 4.7.4.1.4: an appendix numbers its paragraphs within the
  // appendix, prefixed by its letter. Only the primary level takes it.
  it("prefixes an appendix's paragraphs with its letter", async () => {
    const pages = await renderPages((s) => {
      Object.assign(s.formData as Record<string, unknown>, { date: '15 Dec 24', subject: 'TITLE', shortTitle: 'MI 1' });
      s.paragraphs = [
        { text: 'Install the rail.', level: 0, header: 'Procedures' },
        { text: '', level: 0, header: 'Torque Values', appendix: true },
        { text: 'Rail screws are torqued to 25 inch-pounds.', level: 0, header: 'Rail Screws' },
        { text: 'Check each screw in turn.', level: 1 },
        { text: 'Action screws are torqued to 65 inch-pounds.', level: 0, header: 'Action Screws' },
      ];
    });
    const appendix = pages.find((p) => /APPENDIX A/.test(p))!;
    expect(appendix).toMatch(/A-1\.\s+Rail Screws/);
    expect(appendix).toMatch(/A-2\.\s+Action Screws/);
    // Subparagraphs hang off the primary unprefixed, as figure 10 sets them.
    expect(appendix).toMatch(/a\.\s+Check each screw/);
    // The body's own paragraphs are untouched.
    expect(pages.find((p) => /1\.\s+Procedures/.test(p))).toBeTruthy();
  });

  // 4.7.10.1: the title is centred below its illustration. A plain \\ in a
  // center environment carries no penalty, so a figure landing at the foot of
  // a page left its title stranded at the top of the next one.
  it('keeps a figure title on the page with its illustration', async () => {
    const image = new Uint8Array(readFileSync(join(process.cwd(), 'public', 'attachments', 'usmc-seal.png')));
    const { pdf: out } = await renderDocument((s) => {
      Object.assign(s.formData as Record<string, unknown>, { date: '15 Dec 24', subject: 'TITLE', shortTitle: 'MI 1' });
      s.paragraphs = [
        ...Array.from({ length: 24 }, () => ({
          text: 'Filler text that fills the measure of the page so the figure below lands at the foot of it and has to decide whether to take its title along.',
          level: 0,
        })),
        { text: 'Rail alignment', level: 0, figure: { fileRef: { id: 'f1' }, name: 'rail.png', type: 'image/png' } },
      ];
    }, { 'attachments/figure-1.png': image });
    const imagePages = spawnSync('pdfimages', ['-list', out], { encoding: 'utf8' })
      .stdout.split('\n').filter((l) => /\bimage\b/.test(l))
      .map((l) => Number(l.trim().split(/\s+/)[0]));
    const figurePage = Math.max(...imagePages);
    const caption = spawnSync('pdftotext', ['-f', String(figurePage), '-l', String(figurePage), out, '-'], { encoding: 'utf8' }).stdout;
    expect(caption, `the title left the illustration behind on page ${figurePage}`).toMatch(/Figure 1\.\s+Rail alignment/);
  });

  // 4.7.11.5.3 and figure 11: step labels are aligned right, so a two-digit
  // label ends where a one-digit label ends, and carry-over lines start under
  // the first letter of the step rather than at a fixed offset.
  it('aligns step labels right and blocks their carry-over lines', async () => {
    const { pdf: out } = await renderDocument((s) => {
      Object.assign(s.formData as Record<string, unknown>, { date: '15 Dec 24', subject: 'TITLE', shortTitle: 'MI 1' });
      s.paragraphs = Array.from({ length: 11 }, (_, i) => ({
        text: i === 8 || i === 9
          ? `Step ${i + 1} runs long enough to wrap onto a second line so the carry-over can be measured against the first letter of the step text above it.`
          : `Step ${i + 1}.`,
        level: 0,
        procedure: true,
      }));
    });
    const all = [1, 2, 3].flatMap((p) => lineBoxes(out, p));
    const at = (re: RegExp) => {
      const i = all.findIndex((l) => re.test(l.text));
      return { label: all[i], carryOver: all[i + 1] };
    };
    const nine = at(/^9\.\s/);
    const ten = at(/^10\.\s/);
    expect(nine.label && ten.label, 'steps 9 and 10 were not both rendered').toBeTruthy();
    // Aligned right: the wider label starts further left by exactly its extra
    // width. Left-aligned labels shared a left edge, which is the defect.
    expect(ten.label.x0, 'the two-digit label is not aligned right').toBeLessThan(nine.label.x0 - 1);
    // Blocked: each carry-over starts under the first letter of its OWN step's
    // text. Comparing the two against each other proves nothing -- the hanging
    // indent never depended on the label's width -- so measure each against
    // where its step's text actually begins.
    const words = [1, 2, 3].flatMap((p) => wordBoxes(out, p));
    const textStart = (label: string) => words[words.findIndex((w) => w.text === label) + 1].x0;
    expect(Math.abs(nine.carryOver.x0 - textStart('9.')), "step 9's carry-over does not block under its text").toBeLessThan(0.5);
    expect(Math.abs(ten.carryOver.x0 - textStart('10.')), "step 10's carry-over does not block under its text").toBeLessThan(0.5);
  });
});
