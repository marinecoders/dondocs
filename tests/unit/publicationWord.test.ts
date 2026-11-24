import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { volumeFixture } from '../_helpers/volumeFixture';
import { manualPacket } from '../_helpers/manualPacket';
import { renderPublicationDocx, type PublicationWordSource } from '@/services/docx/publication';
import { PublicationWordPackage } from '@/services/docx/publication/package';
import { MANUAL_TYPES, type ManualFrontMatter } from '@/data/techpub/manualFrontMatter';
import { instructionWordSource } from '../_helpers/publicationWordQualification';
import { publicationWordExportErrors } from '@/lib/publicationWordPreflight';

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
  it('keeps volume typography and CUI banners on every section, with Word-only Unicode intact', async () => {
    const document = volumeFixture();
    Object.assign(document.formData, {
      fontFamily: 'courier', fontSize: '11pt', classLevel: 'cui', cuiControlledBy: 'Example Command',
      cuiCategory: 'CTI', cuiDissemination: 'FEDCON', pocEmail: 'sample@example.usmc.mil',
    });
    document.paragraphs[0].text += ' Training label: 試験.';
    const blob = await renderPublicationDocx(document, { readAsset: noAsset, loadSeal: noAsset }, new AbortController().signal, referenceDate);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(await zip.file('word/styles.xml')!.async('string')).toContain('w:ascii="Courier New"');
    expect(await zip.file('word/styles.xml')!.async('string')).toContain('<w:sz w:val="22"/>');
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(text(xml)).toContain('Training label: 試験.');
    expect(text(xml)).toContain('Controlled by: Example Command');
    for (let section = 1; section <= 5; section++) {
      expect(await zip.file(`word/header${section}.xml`)!.async('string')).toContain('>CUI</w:t>');
      expect(await zip.file(`word/footer${section}.xml`)!.async('string')).toContain('>CUI</w:t>');
    }
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
  it.each(['MI', 'TI', 'SI', 'LI'] as const)('retains %s instruction identity and supported native typography', async type => {
    const { xml, zip } = await output(instructionWordSource(type));
    expect(text(xml)).toContain(`${type} 12345A-26/1`);
    expect(text(xml)).toContain('END OF INSTRUCTION');
    expect(text(xml).includes('GCSS-MC Recording')).toBe(type === 'MI');
    expect(await zip.file('word/styles.xml')!.async('string')).toContain('<w:sz w:val="24"/>');
    expect(xml).not.toContain('w:fmt="lowerRoman"');
    expect((xml.match(/w:start="1"/g) ?? [])).toHaveLength(1);
    for (const name of Object.keys(zip.files).filter(name => /^word\/footer\d+\.xml$/.test(name))) expect(await zip.file(name)!.async('string')).not.toContain('T-');
  });
  it('retains fixed table columns, references and appendix numbering in an instruction', async () => {
    const document = instructionWordSource();
    const id = 'A'.repeat(32);
    document.paragraphs[0].text = `Review {{PUBREF_T_${id}}} before use.`;
    document.paragraphs.push({ referenceId: id, level: 0, header: 'Major Items Affected', text: '', tableKey: 'majorItems' },
      { level: 0, appendix: true, header: 'Inspection record', text: 'APPENDIX INTRODUCTION' }, { level: 0, text: 'APPENDIX CONTENT' });
    document.publicationTables.majorItems = [{ values: { description: 'SUPPORT BRACKET', nsn: '1005-01-566-1100', tamcn: 'A02557G', id: '12345A' } }];
    const { xml } = await output(document);
    for (const marker of ['Description', 'NSN', 'TAMCN', 'I.D. No.', 'SUPPORT BRACKET', '1005-01-566-1100', 'APPENDIX INTRODUCTION', 'APPENDIX CONTENT']) expect(text(xml)).toContain(marker);
    expect(xml).toContain('<w:hyperlink w:anchor="publication_');
    expect(xml).toContain('w:bookmarkStart');
    expect(xml).toContain('A-');
    expect(text(xml)).not.toContain('{{PUBREF_');
  });
  it.each([0, 2])('preserves a general body table with %i header rows without inventing paragraph numbering', async headerRows => {
    const document = instructionWordSource();
    document.paragraphs.push({ level: 1, text: '', bodyTable: { rows: [['ALPHA CELL', 'BETA CELL'], ['GAMMA CELL', 'DELTA CELL']], headerRows } });
    const { xml } = await output(document);
    const tables = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g)!;
    const last = tables.at(-1)!;
    const content = text(`<root xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${last}</root>`);
    for (const marker of ['ALPHA CELL', 'BETA CELL', 'GAMMA CELL', 'DELTA CELL']) expect(content).toContain(marker);
    expect((last.match(/<w:tblHeader\/>/g) ?? []).length).toBe(headerRows);
    expect((last.match(/<w:b\/>/g) ?? []).length).toBe(headerRows * 2);
  });
  it('retains the extended cell and row settings in native publication Word output', async () => {
    const document = instructionWordSource();
    document.paragraphs.push({ level: 1, text: '', bodyTable: {
      rows: [['TABLEHEADER', 'DETAILHEADER'], ['TABLEBODY', 'DETAILBODY']], headerRows: 1,
      borders: 'columns', wrap: false, minimumRowHeight: 18, rowHeights: [null, 38],
    } });
    const { xml } = await output(document);
    const table = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g)!.at(-1)!;
    expect(table.match(/<w:noWrap\/><w:tcFitText\/>/g)).toHaveLength(4);
    expect(table.match(/<w:tcBorders><w:bottom w:val="single"/g)).toHaveLength(2);
    expect(table).toContain('<w:insideV w:val="single"');
    expect(table).toContain('<w:trHeight w:val="760" w:hRule="atLeast"/>');
    document.paragraphs.at(-1)!.bodyTable!.rows[1][0] = '[Insert table content]';
    await expect(output(document)).rejects.toThrow('Replace the remaining template prompts');
  });
  it('rejects invalid generic header counts and inapplicable imported content in front-matter profiles', async () => {
    const word = new PublicationWordPackage(new AbortController().signal);
    for (const headerRows of [-1, 1.5, 3]) expect(() => word.table(['Header'], [['Cell']], [10080], { headerRows })).toThrow('header count');
    const document = source();
    document.paragraphs.push({ level: 0, text: '', bodyTable: { rows: [['RETAIN THIS']], headerRows: 0 } });
    await expect(output(document)).rejects.toThrow('general body tables');
  });
  it('preserves unnumbered body images, numbered figures, source bytes and author alternative text', async () => {
    const document = instructionWordSource();
    const image = await seal();
    const ref = { id: 'owned-figure', name: 'drawing.png', type: 'image/png', size: image.byteLength };
    document.paragraphs.push({ level: 0, text: 'BODY CAPTION', figure: { fileRef: ref, type: 'image/png', placement: 'body', altText: 'Author supplied alternative text' } },
      { level: 0, text: 'NUMBERED CAPTION', figure: { fileRef: ref, type: 'image/png' } });
    const before = JSON.stringify(document);
    const blob = await renderPublicationDocx(document, { loadSeal: seal, readAsset: id => {
      expect(id).toBe(ref.id);
      return { ...ref, data: new Uint8Array(image).buffer };
    } }, new AbortController().signal, referenceDate);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('descr="Author supplied alternative text"');
    expect(text(xml)).toContain('BODY CAPTION');
    expect(text(xml)).toContain('Figure 1. NUMBERED CAPTION');
    expect(text(xml)).not.toContain('Figure 2.');
    expect(JSON.stringify(document)).toBe(before);
    expect(await zip.file('word/media/image2.png')!.async('uint8array')).toEqual(image);
  });
  it('renders volume citations beside bare URLs and inside other link labels', async () => {
    const document = volumeFixture();
    document.paragraphs[0].text = 'Review https://example.test/manual{{VOLREF_checks}} or [read {{VOLREF_checks}}](https://example.test/index).';
    const blob = await renderPublicationDocx(document, { readAsset: noAsset }, new AbortController().signal, referenceDate);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    const relationships = await zip.file('word/_rels/document.xml.rels')!.async('string');
    expect(xml).toMatch(/>https:\/\/example\.test\/manual<\/w:t><\/w:r><\/w:hyperlink>[^]*?<w:hyperlink w:anchor="[^"]+">/);
    expect(xml).toContain('>read 2.1.1</w:t>');
    expect(xml).not.toContain('{{VOLREF_');
    expect(relationships).toContain('Target="https://example.test/manual"');
    expect(relationships).toContain('Target="https://example.test/index"');
    expect(relationships).not.toContain('{{VOLREF_');
  });
  it('exports a legacy figure whose JPEG metadata is on the retained file reference', async () => {
    const document = volumeFixture();
    const image = Uint8Array.from(await readFile('tests/fixtures/images/business-figure-baseline.jpg'));
    const ref = { id: 'legacy-jpeg', name: 'drawing.jpg', type: 'image/jpeg', size: image.length };
    document.paragraphs[0].figure = { fileRef: ref };
    const blob = await renderPublicationDocx(document, {
      readAsset: () => ({ ...ref, data: image.buffer }),
    }, new AbortController().signal, referenceDate);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(await zip.file('word/media/image1.jpg')!.async('uint8array')).toEqual(image);
  });
  it('uppercases warning text while retaining a case-sensitive destination', async () => {
    const word = new PublicationWordPackage(new AbortController().signal, 12);
    word.text('Read https://example.test/CaseSensitive before work.', { uppercase: true });
    const zip = await JSZip.loadAsync(await (await word.finish({ title: 'TEST' })).arrayBuffer());
    expect(text(await zip.file('word/document.xml')!.async('string'))).toContain('READ HTTPS://EXAMPLE.TEST/CASESENSITIVE BEFORE WORK.');
    expect(await zip.file('word/_rels/document.xml.rels')!.async('string')).toContain('https://example.test/CaseSensitive');
  });
  it('rejects a publication with a PDF figure before loading any Word assets', async () => {
    const document = instructionWordSource();
    document.paragraphs.push({ level: 0, text: 'Vector drawing', figure: { name: 'drawing.pdf', type: 'application/pdf', fileRef: { id: 'pdf-figure', name: 'drawing.pdf', type: 'application/pdf', size: 1024 } } });
    expect(publicationWordExportErrors(document).join(' ')).toContain('PNG or JPEG');
    let loaded = false;
    await expect(renderPublicationDocx(document, { readAsset: noAsset, loadSeal: async () => { loaded = true; return seal(); } }, new AbortController().signal, referenceDate)).rejects.toThrow('Keep the original PDF separately');
    expect(loaded).toBe(false);
  });
  it.each([false, true])('keeps distinct graphic and caption markings on body images, including empty captions (%s)', async empty => {
    const document = instructionWordSource();
    Object.assign(document.formData, { classLevel: 'cui', cuiControlledBy: 'Example Command', cuiCategory: 'CTI', pocEmail: 'sample@example.usmc.mil', cuiDistStatement: 'C', distReason: 'Controlled Technical Information', distDate: '2026-10-01' });
    const bytes = await seal();
    const ref = { id: 'marked-image', name: 'drawing.png', type: 'image/png', size: bytes.byteLength };
    document.paragraphs.push({ level: 0, portionMarking: 'U', header: empty ? '' : 'Image heading', text: empty ? '' : 'Image caption', figure: { fileRef: ref, type: 'image/png', placement: 'body', portionMarking: 'CUI', altText: 'Marked body image' } });
    const blob = await renderPublicationDocx(document, { loadSeal: seal, readAsset: () => ({ ...ref, data: new Uint8Array(bytes).buffer }) }, new AbortController().signal, referenceDate);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    const image = xml.indexOf('descr="Marked body image"');
    expect(xml.indexOf('>(CUI)</w:t>')).toBeLessThan(image);
    expect(xml.indexOf(empty ? '>(U)</w:t>' : '(U) Image heading. ')).toBeGreaterThan(image);
    if (!empty) expect(text(xml)).toContain('(U) Image heading. Image caption');
    expect(text(xml)).not.toContain('(CUI) Image heading');
  });
  it('keeps table footnote links superscript and small fixed headers wide enough', async () => {
    const document = instructionWordSource(), id = 'B'.repeat(32);
    document.paragraphs.push({ level: 0, header: 'Materiel Required', text: '', referenceId: id, tableKey: 'materielRequired', tableFootnotes: [{ id: 'a', text: 'Quantity is per assembly.' }] });
    document.publicationTables.materielRequired = [{ values: { item: '1', description: `BOLT{{PUBREF_N_${id}_A}}`, pn: 'BR-100 (1AB23)', qty: '2' } }];
    const { xml } = await output(document);
    const table = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g)!.at(-1)!;
    expect(table).toContain('<w:vertAlign w:val="superscript"/>');
    expect(Number(/<w:tblGrid><w:gridCol w:w="(\d+)"/.exec(table)![1])).toBeGreaterThanOrEqual(720);
    expect(text(xml)).toContain('a  Quantity is per assembly.');
  });
  it('places instruction furniture at the outer edges with native even-page parts', async () => {
    const document = instructionWordSource();
    Object.assign(document.formData, { classLevel: 'cui', cuiControlledBy: 'Example Command', cuiCategory: 'CTI', cuiDissemination: 'FEDCON', pocEmail: 'sample@example.usmc.mil', cuiDistStatement: 'C', distReason: 'Controlled Technical Information', distDate: '2026-10-01' });
    const { zip, xml } = await output(document);
    const settings = await zip.file('word/settings.xml')!.async('string');
    expect(settings).toContain('<w:evenAndOddHeaders/>');
    expect(settings).not.toContain('updateFields');
    for (const [suffix, edge] of [['', 'right'], ['-even', 'left']]) {
      const header = await zip.file(`word/header2${suffix}.xml`)!.async('string');
      const footer = await zip.file(`word/footer2${suffix}.xml`)!.async('string');
      expect(header).toContain(`<w:jc w:val="${edge}"/>`);
      expect(footer).toContain(`<w:jc w:val="${edge}"/>`);
      expect(header).toContain('<w:sz w:val="20"/>');
      expect(header).not.toContain('<w:sz w:val="28"/>');
    }
    for (const section of xml.match(/<w:sectPr>[\s\S]*?<\/w:sectPr>/g)!) {
      expect(section).toContain('<w:headerReference w:type="even"');
      expect(section).toContain('<w:footerReference w:type="even"');
      expect(section.lastIndexOf('headerReference')).toBeLessThan(section.indexOf('footerReference'));
    }
    const manual = await output();
    expect(await manual.zip.file('word/settings.xml')!.async('string')).not.toContain('evenAndOddHeaders');
  });

  it('rejects conflicting rich blocks before loading or silently dropping either payload', async () => {
    const document = instructionWordSource();
    document.paragraphs.push({ level: 0, text: '', bodyTable: { rows: [['Retain this table']], headerRows: 0 }, figure: { placement: 'body', fileRef: { id: 'figure', name: 'drawing.png', type: 'image/png', size: 1 } } });
    let loaded = false;
    await expect(renderPublicationDocx(document, { readAsset: noAsset, loadSeal: async () => { loaded = true; return seal(); } }, new AbortController().signal, referenceDate).then(() => undefined)).rejects.toThrow('own native block');
    expect(loaded).toBe(false);
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

  it('keeps plain manual metadata literal while explicitly rich instruction prose stays styled', async () => {
    const manual = source();
    manual.formData.subject = 'CONTROLLER__REV__A';
    manual.formData.unitLine2 = 'Office__Branch__A';
    manual.formData.manualFrontMatter!.endItems[0].model = 'MODEL__REV__A';
    const manualOutput = await output(manual);
    for (const marker of ['CONTROLLER__REV__A', 'Office__Branch__A', 'MODEL__REV__A']) expect(text(manualOutput.xml)).toContain(marker);
    const instruction = instructionWordSource();
    instruction.formData.subject = 'INSPECT__REV__A';
    instruction.paragraphs[0].text = 'Use **rich** prose.';
    instruction.paragraphs.push({ level: 1, text: '', header: 'HEADER__REV__A' }, { level: 1, text: '', bodyTable: { rows: [['**RICH CELL**']], headerRows: 0 } });
    const rendered = await output(instruction), visible = text(rendered.xml);
    for (const marker of ['INSPECT__REV__A', 'HEADER__REV__A', 'Use rich prose.', 'RICH CELL']) expect(visible).toContain(marker);
    expect(visible).not.toContain('**rich**');
    expect(visible).not.toContain('**RICH CELL**');
  });

  it('retains a header-only appendix portion mark on its title and front-matter listing', async () => {
    const document = instructionWordSource('TI');
    Object.assign(document.formData, { classLevel: 'secret', cuiDistStatement: 'C', distReason: 'Controlled Technical Information', distDate: '2026-10-01',
      classificationBasis: 'derivative', classifiedBy: 'Example Classifier, Example Office', derivedFrom: 'Example source', declassifyOn: '20361030' });
    document.paragraphs.forEach(paragraph => { paragraph.portionMarking = 'U'; });
    document.paragraphs.push({ level: 0, appendix: true, header: 'Secret appendix title', text: '', portionMarking: 'S' });
    const visible = text((await output(document)).xml);
    expect(visible).toContain('(S) Appendix A: Secret appendix title');
    expect(visible).toContain('(S) APPENDIX A: SECRET APPENDIX TITLE');
  });

  it('preserves plain body-table header identifiers alongside rich caption prose', async () => {
    const document = instructionWordSource('TI');
    document.paragraphs.push({ level: 1, header: 'CIRCUIT__REV__A', text: 'Use **this** caption.', bodyTable: { rows: [['CELL']], headerRows: 0 } });
    const { xml } = await output(document);
    const visible = text(xml);
    expect(visible).toContain('CIRCUIT__REV__A. Use this caption.');
    expect(visible).not.toContain('**this**');
    expect(xml).toContain('<w:b/></w:rPr><w:t xml:space="preserve">this</w:t>');
  });

  it('keeps body-image and numbered-figure heading identifiers literal while styling their title prose', async () => {
    const document = instructionWordSource('TI'), bytes = await seal();
    const ref = { id: 'caption-image', name: 'drawing.png', type: 'image/png', size: bytes.byteLength };
    document.paragraphs.push({ level: 0, header: 'BODY__REV__A', text: 'Use **rich** prose.', figure: { fileRef: ref, type: 'image/png', placement: 'body' } },
      { level: 0, header: 'FIGURE__REV__A', text: 'Use **rich** prose.', figure: { fileRef: ref, type: 'image/png' } });
    const blob = await renderPublicationDocx(document, { loadSeal: seal, readAsset: () => ({ ...ref, data: new Uint8Array(bytes).buffer }) }, new AbortController().signal, referenceDate);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const visible = text(await zip.file('word/document.xml')!.async('string'));
    expect(visible).toContain('BODY__REV__A. Use rich prose.');
    expect(visible).toContain('Figure 1. FIGURE__REV__A. Use rich prose');
    expect(visible).not.toContain('**rich**');
  });

  it.each([false, true])('underlines only the counter in deep ordinary paragraph labels (headings: %s)', async headings => {
    const document = instructionWordSource('TI');
    for (let level = 1; level <= 7; level++) document.paragraphs.push({ level, ...(headings ? { header: `Depth ${level} content`, text: '' } : { text: `Depth ${level} content` }) });
    const dom = new DOMParser().parseFromString((await output(document)).xml, 'application/xml');
    const paragraphs = Array.from(dom.getElementsByTagName('w:p'));
    for (const [offset, counter] of ['1', 'a', '1', 'a'].entries()) {
      const paragraph = paragraphs.find(p => p.textContent?.includes(`Depth ${offset + 4} content`))!;
      const underlined = Array.from(paragraph.getElementsByTagName('w:r')).filter(run => run.getElementsByTagName('w:u').length);
      expect(underlined.map(run => run.textContent)).toEqual([counter]);
      expect(underlined[0].getElementsByTagName('w:b')).toHaveLength(headings ? 1 : 0);
      expect(paragraph.textContent).toMatch(new RegExp(`^${['1\\.', 'a\\.', '\\(1\\)', '\\(a\\)'][offset]}  Depth`));
    }
    const shallow = paragraphs.find(p => p.textContent?.includes('Depth 1 content'))!;
    const shallowCounter = Array.from(shallow.getElementsByTagName('w:r')).find(run => run.textContent?.trim())!;
    expect(shallowCounter.getElementsByTagName('w:b')).toHaveLength(headings ? 1 : 0);
    expect(dom.documentElement.textContent).not.toContain('\\uline');
  });

  it('retains the unpunctuated level-four I-Type step label', async () => {
    const document = instructionWordSource('TI');
    document.paragraphs.push({ level: 0, publicationSection: 'skill', header: 'Skill and Time Required', text: 'Equipment technician, 0.5 hours.' },
      { level: 0, publicationSection: 'procedures', header: 'Inspect the bracket', text: 'Follow the steps below.' },
      { level: 4, procedure: true, text: 'STEP ONE' }, { level: 4, procedure: true, text: 'STEP TWO' });
    const dom = new DOMParser().parseFromString((await output(document)).xml, 'application/xml');
    const steps = Array.from(dom.getElementsByTagName('w:p')).filter(p => p.textContent?.includes('STEP '));
    expect(steps.map(p => p.textContent)).toEqual(['1  STEP ONE', '2  STEP TWO']);
    expect(steps.map(p => Array.from(p.getElementsByTagName('w:r')).find(run => run.getElementsByTagName('w:u').length)?.textContent)).toEqual(['1', '2']);
  });

});
