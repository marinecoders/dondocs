import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { manualPacket } from '../_helpers/manualPacket';
import { renderPublicationDocx, type PublicationWordSource } from '@/services/docx/publication';
import { PublicationWordPackage } from '@/services/docx/publication/package';
import { MANUAL_TYPES, type ManualFrontMatter } from '@/data/techpub/manualFrontMatter';

const referenceDate = new Date('2026-10-30T12:00:00Z');
const source = (count = 1): PublicationWordSource => ({ ...manualPacket(count), paragraphs: [], endItems: [], publicationTables: {} });
const seal = async () => new Uint8Array(await readFile('public/attachments/usmc-seal.png'));
const noAsset = () => { throw new Error('Unexpected attachment read.'); };
async function output(document = source()) {
  const blob = await renderPublicationDocx(document, { readAsset: noAsset, loadSeal: seal }, new AbortController().signal, referenceDate);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return { zip, xml: await zip.file('word/document.xml')!.async('string') };
}
function text(xml: string) { return new DOMParser().parseFromString(xml, 'application/xml').documentElement.textContent ?? ''; }

describe('publication Word output', () => {
  it('preserves manual identity, editable end items, notices and authentication without a false signature', async () => {
    const { zip, xml } = await output();
    for (const marker of ['PORTABLE TEST EQUIPMENT', 'TM 00000A-10/1', 'TEST-001', 'MODEL-1', 'DISTRIBUTION STATEMENT A', 'A. SAMPLE', 'Program Manager', 'PCN 000 000000 00', 'OCTOBER 2026', '30 OCTOBER 2026']) expect(text(xml)).toContain(marker);
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('<w:tblHeader/>');
    expect(xml).toContain('<w:sectPr>');
    expect(Object.keys(zip.files).filter(name => /^word\/media\//.test(name) && !name.endsWith('/'))).toHaveLength(1);
    expect(await zip.file('word/footer1.xml')!.async('string')).not.toContain('PAGE');
    expect(await zip.file('word/footer2.xml')!.async('string')).not.toContain('T-');
    expect(await zip.file('word/_rels/document.xml.rels')!.async('string')).toContain('https://app.mcboss.usmc.mil/');
    expect(xml).not.toContain('signatureImage');
    expect(xml).not.toContain('w:object');
  });
  it('retains all continuation rows and all CUI cover notices', async () => {
    const document = source(9), data = document.formData;
    Object.assign(data, { classLevel: 'cui', cuiControlledBy: 'Example Command', cuiCategory: 'CTI', cuiDissemination: 'FEDCON', pocEmail: 'sample@example.usmc.mil', cuiDistStatement: 'C', distReason: 'Controlled Technical Information', distDate: '2026-10-01' });
    data.manualFrontMatter!.copyrightCredit = 'Copyright 2026 Example Company.';
    data.manualFrontMatter!.governmentRights = 'Example contract approved government rights.';
    const result = await output(document), visible = text(result.xml);
    for (let i = 1; i <= 9; i++) expect(visible).toContain(`TEST-${String(i).padStart(3, '0')}`);
    expect(visible).toContain('END ITEM CONTINUATION');
    expect(visible).toContain('DESTRUCTION NOTICE');
    expect(visible).toContain('government rights');
    for (let i = 1; i <= 3; i++) {
      expect(await result.zip.file(`word/header${i}.xml`)!.async('string')).toContain('CUI//FEDCON');
      expect(await result.zip.file(`word/footer${i}.xml`)!.async('string')).toContain('CUI//FEDCON');
    }
    expect(await result.zip.file('word/footer1.xml')!.async('string')).not.toContain('PAGE');
    expect(await result.zip.file('word/footer2.xml')!.async('string')).toContain('T-');
  });
  it('rejects incomplete data before loading seal or writing a document', async () => {
    const document = source(); document.formData.shortTitle = '';
    let loaded = false;
    await expect(renderPublicationDocx(document, { readAsset: noAsset, loadSeal: async () => { loaded = true; return seal(); } }, new AbortController().signal, referenceDate)).rejects.toThrow();
    expect(loaded).toBe(false);
  });
  it('does not deliver a document after cancellation during asset loading', async () => {
    const controller = new AbortController();
    await expect(renderPublicationDocx(source(), { readAsset: noAsset, loadSeal: async () => { controller.abort(); return seal(); } }, controller.signal, referenceDate)).rejects.toThrow('cancelled');
  });
  it('keeps unsafe links and XML in user text inert and allows expandable table rows', async () => {
    const word = new PublicationWordPackage(new AbortController().signal);
    word.text('<w:object> & https://example.test/one?x=1&y=2');
    word.table(['Header'], [['Long cell\nsecond line']], [10080]);
    const zip = await JSZip.loadAsync(await (await word.finish({ title: 'TEST' })).arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('&lt;w:object&gt;');
    expect(xml).not.toContain('w:trHeight');
    expect(new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('parsererror')).toHaveLength(0);
    expect(await zip.file('word/_rels/document.xml.rels')!.async('string')).toContain('https://example.test/one?x=1&amp;y=2');
  });
  it.each(Object.keys(MANUAL_TYPES) as ManualFrontMatter['subtype'][])('preserves the %s manual family heading', async subtype => {
    const document = source();
    document.formData.manualFrontMatter!.subtype = subtype;
    if (subtype === 'supplement') document.formData.manualFrontMatter!.supplementNotice = 'THIS PUBLICATION SUPPLEMENTS TM 00000A-10/1.';
    const visible = text((await output(document)).xml);
    const cover = MANUAL_TYPES[subtype][0];
    expect(visible).toContain(`U.S. MARINE CORPS ${cover.includes('TECHNICAL MANUAL') ? cover : 'TECHNICAL MANUAL'}`);
    if (subtype === 'ietm') expect(visible).toContain('IETM TM 00000A-10/1');
  });
  it('preserves uppercase protocols and balanced URL parentheses without linking punctuation', async () => {
    const word = new PublicationWordPackage(new AbortController().signal);
    word.text('HTTPS://EXAMPLE.TEST/path_(one).');
    const zip = await JSZip.loadAsync(await (await word.finish({ title: 'TEST' })).arrayBuffer());
    const rels = await zip.file('word/_rels/document.xml.rels')!.async('string');
    expect(rels).toContain('Target="HTTPS://EXAMPLE.TEST/path_(one)"');
    expect(rels).not.toContain('Target="HTTPS://EXAMPLE.TEST/path_(one)."');
  });
  it('orders Word run, paragraph and table properties according to the OOXML schema', async () => {
    const word = new PublicationWordPackage(new AbortController().signal);
    word.text('Underlined sized text', { size: 14, underline: true, indent: 18, align: 'center' });
    word.table(['Header'], [['Cell']], [10080]);
    const zip = await JSZip.loadAsync(await (await word.finish({ title: 'TEST' })).arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toMatch(/<w:sz w:val="28"\/><w:szCs w:val="28"\/><w:u w:val="single"\/>/);
    expect(xml).toMatch(/<w:ind w:left="360"\/><w:jc w:val="center"\/>/);
    expect(xml).toMatch(/<w:tblW[^>]*\/><w:tblBorders>[\s\S]*?<\/w:tblBorders><w:tblLayout w:type="fixed"\/><w:tblCellMar>/);
  });
  it('retains a manual volume in its running title', async () => {
    const document = source();
    Object.assign(document.formData.manualFrontMatter!, { volume: '1', volumes: '2', subtitle: 'CONTROLLER INSPECTION' });
    const { zip } = await output(document);
    expect(await zip.file('word/header2.xml')!.async('string')).toContain('VOLUME 1 OF 2');
  });

  it('resolves styled and nested paragraph, table, figure and note references', async () => {
    const word = new PublicationWordPackage(new AbortController().signal);
    const refs = ['P', 'T', 'F', 'N'].map((kind, index) => ({ name: `PUBREF_${kind}_${'A'.repeat(32)}${kind === 'N' ? '_A' : ''}`, label: `${kind} target`, destination: `target.${index}`, ...(kind === 'N' ? { note: 'a' } : {}) }));
    word.registerTargets(refs);
    for (const ref of refs) word.text(`**Using *this __target {{${ref.name}}}__* now**`, { inlineMode: 'rich' });
    for (const ref of refs) word.anchor(ref.destination);
    const zip = await JSZip.loadAsync(await (await word.finish({ title: 'TEST' })).arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).not.toContain('{{PUBREF_');
    expect(text(xml)).not.toMatch(/\*|__/);
    expect(xml.match(/<w:hyperlink w:anchor=/g)).toHaveLength(4);
    for (let index = 1; index <= 4; index++) expect(xml).toContain(`w:anchor="publication_${index}"`);
    expect(xml).toContain('<w:b/><w:i/><w:u w:val="single"/><w:vertAlign w:val="superscript"/>');
  });

  it('preserves case-sensitive URLs adjacent to nested closing emphasis', async () => {
    const word = new PublicationWordPackage(new AbortController().signal);
    word.text('**HTTPS://example.test/CaseSensitive** and *italic **bold*** and **bold *italic***', { inlineMode: 'rich' });
    const zip = await JSZip.loadAsync(await (await word.finish({ title: 'TEST' })).arrayBuffer());
    const document = await zip.file('word/document.xml')!.async('string');
    expect(text(document)).toBe('HTTPS://example.test/CaseSensitive and italic bold and bold italic');
    expect(await zip.file('word/_rels/document.xml.rels')!.async('string')).toContain('Target="HTTPS://example.test/CaseSensitive"');
    expect(document.match(/<w:b\/><w:i\/>/g)).toHaveLength(2);
  });

  it('rejects invalid generic header counts and inapplicable imported content in front-matter profiles', async () => {
    const word = new PublicationWordPackage(new AbortController().signal);
    for (const headerRows of [-1, 1.5, 3]) expect(() => word.table(['Header'], [['Cell']], [10080], { headerRows })).toThrow('header count');
    const document = source();
    document.paragraphs.push({ level: 0, text: '', bodyTable: { rows: [['RETAIN THIS']], headerRows: 0 } });
    await expect(output(document)).rejects.toThrow('general body tables');
  });
  it('keeps manual identifiers literal rather than interpreting emphasis markers', async () => {
    const document = source();
    document.formData.subject = 'CONTROLLER__REV__A';
    document.formData.unitLine2 = 'Office__Branch__A';
    document.formData.manualFrontMatter!.endItems[0].model = 'MODEL__REV__A';
    const result = await output(document);
    for (const marker of ['CONTROLLER__REV__A', 'Office__Branch__A', 'MODEL__REV__A']) expect(text(result.xml)).toContain(marker);
  });
});
