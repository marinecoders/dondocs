import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { publicationWordFixtures, stockWordSource } from '../_helpers/publicationWordQualification';
import { renderPublicationDocx, type PublicationWordPorts } from '@/services/docx/publication';
import { PublicationWordPackage } from '@/services/docx/publication/package';
import { artworkLabelPosition } from '@/services/docx/publication/artwork';
import { sl3InventoryGeometry } from '@/data/techpub/sl3';
import { sl3Body } from '@/services/docx/publication/stock';
import { buildSl4Indexes } from '@/lib/sl4References';

const referenceDate = new Date('2026-10-30T12:00:00Z');
async function output(docType: 'sl3' | 'sl4', extend?: (source: ReturnType<typeof stockWordSource>) => void, extra: Partial<PublicationWordPorts> = {}) {
  const source = stockWordSource(docType); extend?.(source);
  const before = JSON.stringify(source);
  const seal = new Uint8Array(await readFile('public/attachments/usmc-seal.png'));
  const artwork = new Uint8Array(await readFile('tests/fixtures/publication-word/diagram.png'));
  const blob = await renderPublicationDocx(source, {
    loadSeal: async () => seal,
    readAsset: id => ({ id, name: 'diagram.png', type: 'image/png', size: artwork.byteLength, data: new Uint8Array(artwork).buffer }),
    ...extra,
  }, new AbortController().signal, referenceDate);
  expect(JSON.stringify(source)).toBe(before);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file('word/document.xml')!.async('string');
  return { zip, xml, text: new DOMParser().parseFromString(xml, 'application/xml').documentElement.textContent ?? '', source };
}

describe('stock publication Word output', () => {
  it('retains inventory rows, twelve writing columns and the certification writing area', async () => {
    const { zip, xml, text } = await output('sl3');
    for (const fixture of publicationWordFixtures().filter(fixture => fixture.name === 'sl3-portrait')) for (const marker of fixture.markers) expect(text).toContain(marker);
    for (const marker of ['COMPONENT, Training 002', 'COMPONENT, Training 003', 'Periodic Inventory', 'SUPERVISED BY', 'DATE', 'Components Stock List SL-3']) expect(text).toContain(marker);
    expect(xml).toContain('<w:gridSpan w:val="12"/>');
    expect(xml).toContain('w:hRule="atLeast"');
    expect(xml).not.toContain('w:hRule="exact"');
    expect(xml).toContain(' PAGEREF publication_');
    expect(xml).toContain('\\* roman');
    expect(xml).toContain('\\* Arabic');
    expect(xml).not.toContain('{{PUBREF_');
    expect(await zip.file('word/header4.xml')!.async('string')).toContain('END ITEM NOMENCLATURE: TOOL KIT, TRAINING');
    expect(await zip.file('word/header4.xml')!.async('string')).toContain('SERIAL NUMBER:');
    expect(await zip.file('word/header2.xml')!.async('string')).toContain('30 OCTOBER 2026');
    expect(await zip.file('word/footer4.xml')!.async('string')).toContain('<w:jc w:val="right"/>');
    expect(await zip.file('word/footer1.xml')!.async('string')).not.toContain('PAGE');
  });
  it('keeps wide stock sheets at the canonical eleven-inch square geometry', async () => {
    const { xml, text } = await output('sl3', source => {
      source.formData.sl3!.orientation = 'landscape';
      source.formData.sl3!.showFigureReference = true;
      source.formData.sl3!.showModel = true;
      source.formData.sl3!.fieldingPlanReference = 'EXAMPLE FIELDING PLAN';
      source.formData.sl3!.components[0].model = 'MODEL-WIDE';
    });
    expect(xml).toContain('<w:pgSz w:w="15840" w:h="15840"/>');
    const inventory = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g)!.find(table => table.includes('Periodic Inventory'))!;
    const widths = [...inventory.matchAll(/<w:gridCol w:w="(\d+)"/g)].map(match => Number(match[1]));
    const original = sl3InventoryGeometry({ orientation: 'landscape', showFigureReference: true, showModel: true }).widths.map(width => Math.round(width * 20));
    expect(widths.slice(18).every(width => width >= 1152)).toBe(true);
    expect(widths.slice(5, 17)).toEqual(original.slice(5, 17));
    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(original.reduce((sum, width) => sum + width, 0));
    for (const marker of ['MODEL-WIDE', 'EXAMPLE FIELDING PLAN', 'Model Number', 'Fig Key / Ref Des']) expect(text).toContain(marker);
  });
  it('retains SL-4 parts, all cross-reference occurrences, row targets and source artwork', async () => {
    const { zip, xml, text, source } = await output('sl4');
    for (const part of source.formData.sl4!.rows) if (part.kind === 'part') {
      for (const marker of [part.nomenclature, part.partNumber, part.nsn, part.cage].filter(Boolean)) expect(text).toContain(marker);
    }
    const indexes = buildSl4Indexes(source.formData.sl4!);
    expect(indexes.partIII.length).toBeGreaterThan(new Set(indexes.partIII.map(row => row.nsn)).size);
    for (const marker of ['PART II', 'PART III', 'PART IV', 'PART V', 'Marine Corps Components Repair Parts List, SL-4-12345A, TAMCN A12345G', 'is effective upon receipt.']) expect(text).toContain(marker);
    expect(xml.match(/<w:tblHeader\/>/g)!.length).toBeGreaterThan(7);
    expect(xml).toContain('<w:gridSpan w:val="2"/>');
    expect(xml).toContain('descr="Synthetic training control box');
    expect(text.match(/Figure 1\. Control Box, Training/g)).toHaveLength(2);
    expect(text).toContain('AUTHENTICATION');
    expect(xml).not.toContain('{{PUBREF_');
    expect(Object.keys(zip.files).filter(path => /^word\/media\/image\d+\.png$/.test(path))).toHaveLength(2);
    const targets = [...xml.matchAll(/<w:bookmarkStart w:id="\d+" w:name="([^"]+)"/g)].map(match => match[1]);
    for (const match of xml.matchAll(/w:anchor="([^"]+)"/g)) expect(targets).toContain(match[1]);
  });
  it('composites labels into a separate image and preserves the original draft', async () => {
    const derivative = new Uint8Array(await readFile('public/attachments/usmc-seal.png'));
    const renderArtwork = vi.fn(async () => derivative);
    const { zip } = await output('sl4', source => { source.formData.sl4!.artwork[0] = { figureId: source.paragraphs[0].referenceId!, lettering: 'labels', labels: [{ id: 'label-one', text: '1', x: 50, y: 50 }] }; }, { renderArtwork });
    expect(renderArtwork).toHaveBeenCalledOnce();
    expect(await zip.file('word/media/image2.png')!.async('uint8array')).toEqual(derivative);
  });
  it('uses canonical label baselines and refuses edge clipping', () => {
    expect(artworkLabelPosition({ text: '1', x: 25.05, y: 25 }, { width: 400, height: 300 }, { width: 10, ascent: 8, descent: 2 })).toEqual({ x: 100.4, y: 225 });
    expect(() => artworkLabelPosition({ text: '1', x: 0, y: 50 }, { width: 400, height: 300 }, { width: 10, ascent: 8, descent: 2 })).toThrow('crosses');
  });
  it('rejects merged headers that would discard content or overlap', () => {
    const word = new PublicationWordPackage(new AbortController().signal);
    expect(() => word.table(['one', 'two'], [], [1000, 1000], { headerSpans: [{ column: 0, span: 2 }] })).toThrow('discard');
    expect(() => word.table(['one', ''], [], [1000, 1000], { headerSpans: [{ column: 0, span: 2 }, { column: 1, span: 1 }] })).toThrow('discard');
  });
  it('does not deliver artwork that completes after export cancellation', async () => {
    const source = stockWordSource('sl4'), controller = new AbortController();
    source.formData.sl4!.artwork[0] = { figureId: source.paragraphs[0].referenceId!, lettering: 'labels', labels: [{ id: 'label-one', text: '1', x: 50, y: 50 }] };
    const before = JSON.stringify(source), bytes = new Uint8Array(await readFile('tests/fixtures/publication-word/diagram.png'));
    await expect(renderPublicationDocx(source, {
      loadSeal: async () => new Uint8Array(await readFile('public/attachments/usmc-seal.png')),
      readAsset: id => ({ id, name: 'diagram.png', type: 'image/png', size: bytes.byteLength, data: new Uint8Array(bytes).buffer }),
      renderArtwork: async () => { controller.abort(); return bytes; },
    }, controller.signal, referenceDate).then(() => undefined)).rejects.toThrow('cancelled');
    expect(JSON.stringify(source)).toBe(before);
  });

  it('numbers authored and derived special notes consecutively with their own portions', async () => {
    const source = stockWordSource();
    source.formData.classLevel = 'secret';
    Object.assign(source.formData.sl3!, { notes: [{ id: 'authored', text: 'AUTHOR NOTE ONE', portionMarking: 'U' }], sequencingNote: 'SEQUENCE RULE TWO', sequencingPortion: 'S', showModel: true, fieldingPlanReference: 'SYNTHETIC FIELDING PLAN', technicalPortion: 'C' });
    const word = new PublicationWordPackage(new AbortController().signal);
    word.registerTargets([{ name: 'PUBREF_AUTH', label: 'AUTHENTICATION', destination: 'itype.authentication' }]);
    const section = await sl3Body(word, source, { readAsset: () => { throw new Error('Unexpected image.'); } }, { title: 'SYNTHETIC', marking: 'SECRET' });
    const zip = await JSZip.loadAsync(await (await word.finish(section)).arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    const text = new DOMParser().parseFromString(xml, 'application/xml').documentElement.textContent;
    for (const marker of ['19. (U) AUTHOR NOTE ONE', '20. (S) SEQUENCE RULE TWO', '21. (C) Inventory columns are renumbered to include Model Number. Fielding Plan: SYNTHETIC FIELDING PLAN.']) expect(text).toContain(marker);
  });

  it('retains literal stock identifiers, plain descriptions and source metadata', async () => {
    const { text, xml } = await output('sl4', source => {
      source.formData.nomenclature = 'CONTROL__BOX__A';
      source.paragraphs[0].text = 'CONTROL__BOX__A';
      source.formData.unitLine2 = 'OFFICE__REV__A';
      source.endItems[0].model = 'MODEL__REV__A';
      const part = source.formData.sl4!.rows.find(row => row.kind === 'part')!;
      if (part.kind !== 'part') throw new Error('Missing test part.');
      part.partNumber = 'PN__REV__A'; part.description = 'plain **label**'; part.figureId = source.paragraphs[0].referenceId!;
    });
    for (const marker of ['CONTROL__BOX__A', 'OFFICE__REV__A', 'MODEL__REV__A', 'PN__REV__A', 'plain **label**']) expect(text).toContain(marker);
    expect(xml).not.toContain('{{PUBREF_');
  });

});
