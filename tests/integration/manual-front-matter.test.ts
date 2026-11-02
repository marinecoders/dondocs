// @vitest-environment node
import { expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { manualInput, manualPacket } from '../_helpers/manualPacket';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';
import { MANUAL_TYPES } from '@/data/techpub/manualFrontMatter';
import { renderPdf } from '../../companion/render';

const render = (packet = manualPacket()) => renderPdf(manualInput(packet));
async function inspect(bytes: Uint8Array) {
  const document = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
  try {
    const pages = await Promise.all(Array.from({ length: document.numPages }, async (_, i) => {
      const page = await document.getPage(i + 1);
      const items = (await page.getTextContent()).items.filter(t => 'str' in t);
      return { items, text: items.map(t => t.str).join(' ').replace(/\s+/g, ' ') };
    }));
    return pages;
  } finally { await document.destroy(); }
}
function targets(pdf: PDFDocument, page: number) {
  return (pdf.getPage(page).node.Annots()?.asArray() ?? []).flatMap(ref => {
    const action = pdf.context.lookup(ref, PDFDict).lookup(PDFName.of('A'));
    const uri = action instanceof PDFDict ? action.lookup(PDFName.of('URI')) : undefined;
    return uri instanceof PDFString ? [uri.decodeText()] : [];
  });
}

it.each([1, 6, 7, 38])('renders %i items exactly once with source continuation rules and no overlapping words', async count => {
  const bytes = await render(manualPacket(count));
  const pages = await inspect(bytes);
  const continued = count > 6;
  expect(pages).toHaveLength(continued ? 3 : 2);
  expect(pages[0].text.includes('See Next Page')).toBe(continued);
  for (let i = 1; i <= count; i++) {
    const id = `TEST-${String(i).padStart(3, '0')}`;
    expect(pages.map(p => p.text).join(' ').split(id)).toHaveLength(2);
    expect(pages[continued ? 1 : 0].text).toContain(id);
  }
  expect(pages.at(-1)!.text).toContain('is authenticated for Marine Corps use');
  expect(pages.at(-1)!.text).toContain('DISTRIBUTION: EDO');
  const layout = await pdfTextLayout(bytes);
  expect(layout.collisions).toEqual([]);
  for (const box of layout.boxes) {
    expect(box.left, box.text).toBeGreaterThanOrEqual(36);
    expect(box.right, box.text).toBeLessThanOrEqual(576.5);
    expect(box.bottom, box.text).toBeGreaterThanOrEqual(30);
    expect(box.top, box.text).toBeLessThanOrEqual(756.5);
  }
});

it.each(Object.keys(MANUAL_TYPES) as Array<keyof typeof MANUAL_TYPES>)('renders %s with its source authentication wording', async subtype => {
  const pages = await inspect(await render(manualPacket(1, subtype)));
  expect(pages[0].text).toContain(MANUAL_TYPES[subtype][0]);
  expect(pages[0].text).toContain('TECHNICAL MANUAL');
  expect(pages.at(-1)!.text).toContain(MANUAL_TYPES[subtype][1]);
  expect(pages.at(-1)!.text).toContain(subtype === 'ietm' ? 'IETM TM 00000A-10/1' : 'TM 00000A-10/1');
});

it.each(['none', '252.227-7013', '252.227-7015'] as const)('preserves %s and a single unsigned signature widget clear of printed text', async dfarClause => {
  const packet = manualPacket(7); packet.formData.manualFrontMatter!.dfarClause = dfarClause;
  const bytes = await render(packet);
  const pages = await inspect(bytes);
  expect(pages.at(-1)!.text.includes('5. DFAR')).toBe(dfarClause !== 'none');
  if (dfarClause !== 'none') expect(pages.at(-1)!.text).toContain(dfarClause);
  const pdf = await PDFDocument.load(bytes);
  const fields = pdf.getForm().getFields(); expect(fields).toHaveLength(1);
  expect(fields[0].acroField.dict.get(PDFName.of('FT'))).toEqual(PDFName.of('Sig'));
  expect(fields[0].acroField.dict.get(PDFName.of('V'))).toBeUndefined();
  const widgets = fields[0].acroField.getWidgets(); expect(widgets).toHaveLength(1);
  expect(widgets[0].P()).toEqual(pdf.getPage(2).ref);
  const rect = widgets[0].getRectangle();
  const layout = await pdfTextLayout(bytes);
  expect(layout.boxes.filter(box => box.page === 3 && box.left < rect.x + rect.width && box.right > rect.x && box.bottom < rect.y + rect.height && box.top > rect.y)).toEqual([]);
  const labels = pdf.catalog.lookup(PDFName.of('PageLabels'), PDFDict).lookup(PDFName.of('Nums'), PDFArray);
  expect(labels.lookup(2, PDFNumber).asNumber()).toBe(2);
  expect(labels.lookup(3, PDFDict).get(PDFName.of('S'))).toEqual(PDFName.of('D'));
  expect(pages[1].items.some(item => item.str === 'T-2')).toBe(true);
  expect(pages[2].items.some(item => item.str === '1')).toBe(true);
});

it('uses Figure 4 cover type sizes, Figure 16 date/PCN order, and preserves issuer address lines', async () => {
  const packet = manualPacket();
  Object.assign(packet.formData.manualFrontMatter!, { maintenanceLevel: 'Field maintenance', subtitle: 'Operating instructions' });
  const pages = await inspect(await render(packet));
  const cover = pages[0].items;
  const number = cover.find(item => item.str === 'TM 00000A-10/1')!;
  const date = cover.find(item => item.str === 'OCTOBER 2026')!;
  const pcn = cover.find(item => item.str.includes('PCN 000 000000 00'))!;
  expect(number.transform[0]).toBeCloseTo(24, 0);
  expect(date.transform[0]).toBeCloseTo(18, 0);
  expect(date.transform[5]).toBeGreaterThan(pcn.transform[5]);
  expect(pages[0].text).not.toContain('30 OCTOBER 2026');
  expect(pages[1].text).toContain('30 OCTOBER 2026');
  expect(pages[0].text).toContain('FIELD MAINTENANCE');
  expect(pages[0].text).toContain('OPERATING INSTRUCTIONS');
  const street = pages[1].items.find(item => item.str === '123 Example Road')!;
  const city = pages[1].items.find(item => item.str === 'Quantico, VA 22134')!;
  expect(street.transform[5]).toBeGreaterThan(city.transform[5]);
});

it('retains all full destinations when a long supplement URL wraps, including punctuation and Unicode', async () => {
  const packet = manualPacket(7, 'supplement');
  const uris = ['https://example.usmc.mil/manual_(volume_1)', 'https://example.usmc.mil/équipement.pdf', `https://example.usmc.mil/${'publication-'.repeat(12)}manual.pdf?edition=2&part=1`];
  packet.formData.manualFrontMatter!.supplementNotice = `USE WITH TM 00000A-10/1. ${uris.map(uri => `(<${uri}>).`).join(' ')}`;
  const pdf = await PDFDocument.load(await render(packet));
  const links = targets(pdf, 0);
  for (const uri of uris) expect(links).toContain(new URL(uri).href);
  expect(new Set(links)).toEqual(new Set(uris.map(uri => new URL(uri).href)));
  const names = pdf.catalog.lookup(PDFName.of('Names'), PDFDict).lookup(PDFName.of('Dests'), PDFDict).lookup(PDFName.of('Names'), PDFArray);
  const index = names.asArray().findIndex(value => value instanceof PDFString && value.decodeText() === 'manual.items');
  expect(index).toBeGreaterThanOrEqual(0);
  expect(names.lookup(index + 1, PDFArray).get(0)).toEqual(pdf.getPage(1).ref);
});

it('renders populated controlled notices, volumes, rights and clause without collisions', async () => {
  const packet = manualPacket(38);
  Object.assign(packet.formData, { classLevel: 'cui', cuiControlledBy: 'Test Program Office', cuiCategory: 'CTI', cuiDissemination: 'NOFORN', pocEmail: '202-555-0100', cuiDistStatement: 'D', distReason: 'Export Controlled', distDate: '2026-10-01', exportRestricted: true, supersedure: 'This manual supersedes TM 00000A-10/1 dated 1 JULY 2025.' });
  Object.assign(packet.formData.manualFrontMatter!, { maintenanceLevel: 'FIELD MAINTENANCE', volume: '1', volumes: '2', subtitle: 'OPERATING INSTRUCTIONS', volumeNotice: 'This volume is incomplete without volume 2.', copyrightCredit: '© 2026 Example Publisher. Fictional equipment guide.', governmentRights: 'Fictional test license: the Government may publish, reproduce and distribute this guide.', dfarClause: '252.227-7013' });
  const bytes = await render(packet); const pages = await inspect(bytes);
  expect(pages).toHaveLength(3);
  for (const page of pages) { expect(page.text).toContain('CUI//NOFORN'); expect(page.text).toContain('VOLUME 1 OF 2'); }
  for (const notice of ['DESTRUCTION NOTICE', 'SUPERSEDURE NOTICE', 'DISTRIBUTION STATEMENT D', 'export is restricted', 'Government may publish, reproduce and distribute']) expect(pages[0].text).toContain(notice);
  expect(pages[0].text).toContain('POC: 202-555-0100');
  expect(pages[0].text).toContain('Controlled by: United States Marine Corps');
  expect(targets(await PDFDocument.load(bytes), 0)).not.toContain('mailto:202-555-0100');
  const layout = await pdfTextLayout(bytes);
  // pdfTeX composes the copyright glyph from an overprinted circle and c.
  expect(layout.collisions.filter(pair => new Set([pair.first.text, pair.second.text]).size !== 2 || ![pair.first.text, pair.second.text].every(text => ['©', 'c'].includes(text)))).toEqual([]);
  const coverBanner = pages[0].items.find(item => item.str === 'CUI//NOFORN')!;
  const authBanner = pages[2].items.find(item => item.str === 'CUI//NOFORN')!;
  expect(coverBanner.transform[0]).toBeCloseTo(24, 0); expect(authBanner.transform[0]).toBeCloseTo(14, 0);
});

it('moves wrapped six-row lists to T-2 and refuses an overflowing continuation or authentication page', async () => {
  const packet = manualPacket(6);
  packet.formData.manualFrontMatter!.endItems.forEach(item => { item.model = 'MODEL description '.repeat(6); });
  expect(await inspect(await render(packet))).toHaveLength(3);
  packet.formData.manualFrontMatter!.endItems = manualPacket(38).formData.manualFrontMatter!.endItems.map(item => ({ ...item, model: 'MODEL description '.repeat(12) }));
  await expect(render(packet)).rejects.toThrow(/continuation exceeds/);
  const longContact = manualPacket(); longContact.formData.manualFrontMatter!.contentContact = 'Very long contact text '.repeat(200);
  await expect(render(longContact)).rejects.toThrow(/Authentication exceeds/);
});

it('blocks incomplete fields and incompatible release data before rendering', async () => {
  const packet = manualPacket(); packet.formData.pcn = '';
  await expect(render(packet)).rejects.toThrow('PCN is required');
  packet.formData.pcn = '00000000000'; packet.formData.classLevel = 'cui';
  await expect(render(packet)).rejects.toThrow('Public release conflicts');
});

it('refuses a control banner wider than the page', async () => {
  const packet = manualPacket();
  Object.assign(packet.formData, { classLevel: 'cui', cuiControlledBy: 'Test office', cuiCategory: 'CTI', pocEmail: '202-555-0100', cuiDistStatement: 'D', distReason: 'Controlled Technical Information', distDate: '2026-10-01', cuiDissemination: 'NOFORN '.repeat(18) });
  await expect(render(packet)).rejects.toThrow('Control banner exceeds page width');
});

it('wraps unbroken equipment identifiers within their columns on the cover and T-2', async () => {
  for (const count of [1, 7]) {
    const packet = manualPacket(count);
    packet.formData.manualFrontMatter!.endItems.forEach((item, i) => { item.id = `TEST${i}${'1234567890'.repeat(5)}`; item.model = `MODEL${i}${'ABCDEFGHIJ'.repeat(6)}`; });
    const bytes = await render(packet);
    const layout = await pdfTextLayout(bytes);
    expect(layout.collisions).toEqual([]);
    for (const box of layout.boxes) { expect(box.right, box.text).toBeLessThanOrEqual(576.5); expect(box.left, box.text).toBeGreaterThanOrEqual(36); }
  }
});

it.each(['nomenclature', 'subject', 'unitLine1', 'controllingOffice', 'sigLast'] as const)('keeps a long unbroken %s inside the document margins', async field => {
  const packet = manualPacket(); packet.formData[field] = 'TRAINER0123'.repeat(6);
  const bytes = await render(packet); const layout = await pdfTextLayout(bytes);
  expect(layout.collisions).toEqual([]);
  for (const box of layout.boxes) {
    expect(box.left, box.text).toBeGreaterThanOrEqual(71.5);
    expect(box.right, box.text).toBeLessThanOrEqual(540.5);
  }
});

it('refuses an assigned publication number or volume line that cannot fit the source cover', async () => {
  const packet = manualPacket(); packet.formData.shortTitle = `NAVAIR ${'1234567890'.repeat(15)}`;
  Object.assign(packet.formData.manualFrontMatter!, { shortTitleBasis: 'sponsor_assigned', shortTitleApproval: 'Fictional assigning office, TEST-1' });
  await expect(render(packet)).rejects.toThrow('Publication number exceeds cover width');
  packet.formData.shortTitle = 'NAVAIR 01-1A-505-1';
  Object.assign(packet.formData.manualFrontMatter!, { volume: '1'.repeat(100), volumes: '1'.repeat(100), subtitle: 'OPERATING INSTRUCTIONS' });
  await expect(render(packet)).rejects.toThrow('Volume identification exceeds cover width');
});

it.each(['A', 'B', 'C', 'D', 'E', 'F'])('prints statement %s with the appropriate destruction notice', async statement => {
  const packet = manualPacket(7);
  Object.assign(packet.formData, { cuiDistStatement: statement, distReason: ['A', 'F'].includes(statement) ? '' : 'Controlled Technical Information', distDate: statement === 'A' ? '' : '2026-10-01' });
  const pages = await inspect(await render(packet));
  expect(pages[0].text).toContain(`DISTRIBUTION STATEMENT ${statement}`);
  expect(pages[0].text.includes('DESTRUCTION NOTICE')).toBe(statement !== 'A');
  expect(pages[0].text).not.toMatch(/\(category\)|date of determination|insert controlling DoD office/);
});

it('rejects inherited subject prompts rather than printing them', async () => {
  const packet = manualPacket(); packet.formData.subject = '[SUBJECT]';
  await expect(render(packet)).rejects.toThrow('template prompts');
});

it.each(Object.keys(MANUAL_TYPES) as Array<keyof typeof MANUAL_TYPES>)('fits a fully populated controlled %s packet while keeping mandatory notices on the cover', async subtype => {
  const packet = manualPacket(38, subtype);
  Object.assign(packet.formData, { classLevel: 'cui', cuiControlledBy: 'Fictional Training Program Office', cuiCategory: 'CTI', cuiDissemination: 'NOFORN', pocEmail: '202-555-0100', cuiDistStatement: 'D', distReason: 'Export Controlled', distDate: '2026-10-01', exportRestricted: true, supersedure: 'This fictional sample supersedes TM 00000A-10/1 dated 1 JULY 2025.' });
  Object.assign(packet.formData.manualFrontMatter!, { volume: '1', volumes: '2', subtitle: 'OPERATING INSTRUCTIONS', maintenanceLevel: 'FIELD MAINTENANCE', supplementNotice: 'Use with the fictional training guide at https://example.com/training-guide.', volumeNotice: 'This volume is incomplete without volume 2.', copyrightCredit: '© 2026 Example Publisher. Fictional equipment guide.', governmentRights: 'Fictional test license: the Government may publish, reproduce and distribute this guide.', dfarClause: '252.227-7013' });
  const bytes = await render(packet); const pages = await inspect(bytes);
  expect(pages).toHaveLength(3);
  expect(pages[0].text).toContain('DISTRIBUTION STATEMENT D');
  expect(pages[0].text).toContain('export is restricted');
  const all = pages.map(page => page.text).join(' ');
  for (const text of ['DESTRUCTION NOTICE', '© 2026 Example Publisher', 'Government may publish, reproduce and distribute']) expect(all.split(text)).toHaveLength(2);
  if (pages[1].text.includes('DESTRUCTION NOTICE')) {
    expect(pages[0].text).toContain('Destruction notice and copyright/government-rights statements: see T-2.');
    expect(pages[0].text).not.toContain('© 2026 Example Publisher');
    expect(pages[1].text).toContain('© 2026 Example Publisher');
    expect(pages[1].text).toContain('DESTRUCTION NOTICE');
  } else {
    expect(pages[0].text).not.toContain('see T-2');
  }
  const layout = await pdfTextLayout(bytes);
  expect(layout.collisions.filter(pair => ![pair.first.text, pair.second.text].every(text => ['©', 'c'].includes(text)))).toEqual([]);
  for (const box of layout.boxes) {
    if (box.text === 'CUI//NOFORN' && box.bottom < 100) expect(Math.abs(box.bottom - 36)).toBeLessThan(0.5);
    expect(box.left, box.text).toBeGreaterThanOrEqual(35.5);
    expect(box.right, box.text).toBeLessThanOrEqual(576.5);
    expect(box.bottom, box.text).toBeGreaterThanOrEqual(35.5);
    expect(box.top, box.text).toBeLessThanOrEqual(756.5);
  }
});
