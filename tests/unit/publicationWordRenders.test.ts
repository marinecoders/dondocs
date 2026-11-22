// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { inspectPrintedContentsLabels, inspectPublicationContentsDestinations, inspectPublicationWordNavigation, inspectPublicationWordRender, publicationWordPageSizes } from '../../scripts/publication-word-renders';

const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr><w:sectPr><w:pgSz w:w="15840" w:h="15840"/></w:sectPr></w:document>';
const input = () => ({ renderer: 'microsoft-word' as const, metadata: 'Creator: Word\nProducer: macOS\n',
  boundingBoxes: '<doc><page width="612" height="792"><word xMin="54" yMin="54" xMax="125" yMax="65">REQUIRED</word><word xMin="54" yMin="70" xMax="100" yMax="81">CONTENT</word></page></doc>',
  markers: ['REQUIRED CONTENT'], pageSizes: publicationWordPageSizes(xml) });

describe('publication target-renderer measurements', () => {
  it('accepts searchable required content and every declared source page geometry', () => {
    expect(publicationWordPageSizes(xml.replaceAll('w:', 'other:').replace('xmlns:w=', 'xmlns:other='))).toEqual([{ width: 612, height: 792 }, { width: 792, height: 792 }]);
    expect(inspectPublicationWordRender(input())).toEqual({ pages: 1, words: 2 });
    expect(inspectPublicationWordRender({ ...input(), boundingBoxes: input().boundingBoxes.replace('width="612"', 'width="792"') }).pages).toBe(1);
    expect(inspectPublicationWordRender({ ...input(), boundingBoxes: input().boundingBoxes.replace('REQUIRED', 'MODEL-').replace('CONTENT', 'WIDE'), markers: ['MODEL-WIDE'] }).words).toBe(2);
  });

  it('keeps LibreOffice evidence separate from Microsoft Word evidence', () => {
    const metadata = 'Creator: Writer\nProducer: LibreOfficeDev 26.8\n';
    expect(() => inspectPublicationWordRender({ ...input(), metadata })).toThrow('does not identify microsoft-word');
    expect(inspectPublicationWordRender({ ...input(), renderer: 'libreoffice', metadata }).pages).toBe(1);
    expect(() => inspectPublicationWordRender({ ...input(), renderer: 'libreoffice' })).toThrow('does not identify libreoffice');
    expect(inspectPublicationWordRender({ ...input(), metadata: 'Creator: Microsoft® Word for Mac\n' }).pages).toBe(1);
  });

  it('rejects missing content, unresolved references and empty renders', () => {
    expect(() => inspectPublicationWordRender({ ...input(), markers: ['MISSING'] })).toThrow('lost required content');
    expect(() => inspectPublicationWordRender({ ...input(), boundingBoxes: input().boundingBoxes.replace('REQUIRED', 'MEASUREMENT-10'), markers: ['MEASUREMENT-1'] })).toThrow('lost required content');
    expect(() => inspectPublicationWordRender({ ...input(), boundingBoxes: input().boundingBoxes.replace('REQUIRED', '{{PUBREF_X}}') })).toThrow('unresolved cross-reference');
    expect(() => inspectPublicationWordRender({ ...input(), boundingBoxes: '<doc/>' })).toThrow('no measured pages');
    expect(() => inspectPublicationWordRender({ ...input(), boundingBoxes: '<doc><page width="612" height="792"/></doc>' })).toThrow('no searchable text');
  });

  it('rejects incorrect paper, clipped text and non-finite bounds', () => {
    expect(() => inspectPublicationWordRender({ ...input(), boundingBoxes: input().boundingBoxes.replace('width="612"', 'width="595"') })).toThrow('printed geometry');
    for (const coordinate of ['xMax="613.1"', 'xMax="NaN"', 'xMax="2"']) {
      expect(() => inspectPublicationWordRender({ ...input(), boundingBoxes: input().boundingBoxes.replace('xMax="125"', coordinate) })).toThrow('invalid bounds');
    }
    expect(() => inspectPublicationWordRender({ ...input(), boundingBoxes: input().boundingBoxes.replace('xMax="125"', '') })).toThrow('invalid bounds');
    expect(() => publicationWordPageSizes('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>')).toThrow('invalid page geometry');
  });
});

describe('publication Word navigation', () => {
  const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const source = `<z:document xmlns:z="${ns}"><z:body><z:p><z:pPr><z:pStyle z:val="Heading1"/></z:pPr><z:r><z:t>TABLE OF CONTENTS</z:t></z:r></z:p><z:p><z:hyperlink z:anchor="publication_1"><z:r><z:t>PREFACE</z:t></z:r></z:hyperlink>
    <z:fldSimple z:instr=" PAGEREF publication_1 \\h \\* roman "/></z:p><z:p>
    <z:bookmarkStart z:name="publication_1" z:id="1"/><z:bookmarkEnd z:id="1"/></z:p></z:body></z:document>`;

  it('binds the contents link and its field to the actual named bookmark', () => {
    expect(inspectPublicationWordNavigation(source)).toEqual({ bookmarks: 1, internalLinks: 1, pageReferences: 1,
      contentsEntries: [{ section: 'TABLE OF CONTENTS', label: 'PREFACE', format: 'roman' }] });
  });

  it('rejects different existing destinations for a contents link and its page reference', () => {
    const extra = '<z:bookmarkStart z:name="publication_2" z:id="2"/><z:bookmarkEnd z:id="2"/>';
    const withSecond = source.replace('</z:body>', extra + '</z:body>');
    expect(() => inspectPublicationWordNavigation(withSecond.replace('PAGEREF publication_1', 'PAGEREF publication_2')))
      .toThrow('link and its Word PAGEREF field disagree');
    expect(() => inspectPublicationWordNavigation(source.replace('<z:hyperlink z:anchor="publication_1"><z:r><z:t>PREFACE</z:t></z:r></z:hyperlink>', '')))
      .toThrow('link and its Word PAGEREF field disagree');
  });

  it('fails on missing targets, invalid fields or reused bookmark identities', () => {
    expect(() => inspectPublicationWordNavigation(source.replace('anchor="publication_1"', 'anchor="missing"'))).toThrow('unresolved Word bookmark');
    expect(() => inspectPublicationWordNavigation(source.replace('PAGEREF publication_1', 'PAGEREF 123'))).toThrow('malformed Word PAGEREF');
    expect(() => inspectPublicationWordNavigation(source.replace('<z:bookmarkEnd z:id="1"/>', ''))).toThrow('unmatched Word bookmark start');
    const extra = '<z:bookmarkStart z:name="PUBLICATION_1" z:id="2"/><z:bookmarkEnd z:id="2"/>';
    expect(() => inspectPublicationWordNavigation(source.replace('</z:body>', extra + '</z:body>'))).toThrow('duplicate Word bookmark');
  });
});

describe('publication printed contents', () => {
  const entries = [
    { section: 'TABLE OF CONTENTS', label: 'PREFACE', format: 'roman' },
    { section: 'LIST OF TABLES', label: 'Table 1. Inventory', format: 'decimal' },
  ] as const;

  it('reads the renderer output rather than assuming it obeys PAGEREF', () => {
    const before = 'TABLE OF CONTENTS\nPREFACE.................3\n\nLIST OF TABLES\nTable 1. Inventory . . . . . 9';
    expect(inspectPrintedContentsLabels(before, entries).map(row => row.result)).toEqual(['wrong-format', 'matches-format']);
    const corrected = before.replace('...3', '...iii');
    expect(inspectPrintedContentsLabels(corrected, entries).map(row => row.result)).toEqual(['matches-format', 'matches-format']);
  });

  it('flags unresolved fields and duplicate labels for inspection', () => {
    expect(inspectPrintedContentsLabels('TABLE OF CONTENTS\nPREFACE.......\nPREFACE........i', entries).map(row => row.result))
      .toEqual(['ambiguous', 'missing']);
    expect(inspectPrintedContentsLabels('TABLE OF CONTENTS\nPREFACE.......Error! Bookmark not defined.', entries)[0].result).toBe('wrong-format');
    expect(inspectPrintedContentsLabels('TABLE OF CONTENTS\nPREFACE........ii', [entries[0], entries[0]]).map(row => row.result))
      .toEqual(['ambiguous', 'ambiguous']);
  });

  it('keeps later body rows and rows under another heading out of the contents section', () => {
    const listing = 'TABLE OF CONTENTS\nAUTHENTICATION.......i\n\nPREFACE.......iv\f'
      + 'PREFACE........vi\n\nLIST OF TABLES\nPREFACE.........ix\nTable 1. Inventory.......9';
    expect(inspectPrintedContentsLabels(listing, entries).map(row => row.result)).toEqual(['missing', 'matches-format']);
  });

  it.each(['direct', 'action'] as const)('compares the printed value with the footer on the %s PDF link target', async kind => {
    const pdf = await PDFDocument.create();
    const contents = pdf.addPage([612, 792]);
    const target = pdf.addPage([612, 792]);
    const destination = pdf.context.register(pdf.context.obj([target.ref, 'Fit']));
    const link = pdf.context.register(pdf.context.obj({ Subtype: 'Link', Rect: [54, 670, 115, 688],
      ...(kind === 'direct' ? { Dest: destination } : { A: { S: 'GoTo', D: destination } }),
    }));
    contents.node.set(PDFName.of('Annots'), pdf.context.obj([link]));
    const heading = '<line><word>TABLE OF CONTENTS</word></line>';
    const row = '<line xMin="54" xMax="558" yMin="107" yMax="119"><word>PREFACE........iii</word></line>';
    const bounds = `<doc><page>${heading}${row}</page>`
      + '<page><line yMin="753" yMax="765"><word>iv</word></line></page></doc>';
    const rows = inspectPrintedContentsLabels('TABLE OF CONTENTS\nPREFACE........iii', [entries[0]]);
    expect(rows[0]).toMatchObject({ printedPage: 1 });
    expect(await inspectPublicationContentsDestinations(await pdf.save(), bounds, rows)).toEqual([
      { ...rows[0], destinationCheck: 'differs', destinationPage: 2, destinationLabel: 'iv' },
    ]);
    expect(await inspectPublicationContentsDestinations(await pdf.save(), bounds.replace('>iv<', '>iii<'), rows))
      .toEqual([{ ...rows[0], destinationCheck: 'matches', destinationPage: 2, destinationLabel: 'iii' }]);
    target.node.set(PDFName.of('Annots'), pdf.context.obj([link]));
    const otherPage = `<doc><page>${heading}</page><page>${heading}${row}<line yMin="753" yMax="765"><word>iii</word></line></page></doc>`;
    expect(await inspectPublicationContentsDestinations(await pdf.save(), otherPage, rows))
      .toEqual([{ ...rows[0], destinationCheck: 'unresolved' }]);
    expect(await inspectPublicationContentsDestinations(await pdf.save(), bounds.replace('TABLE OF CONTENTS', 'LIST OF TABLES'), rows))
      .toEqual([{ ...rows[0], destinationCheck: 'unresolved' }]);
    const external = pdf.context.register(pdf.context.obj({ Subtype: 'Link', Rect: [54, 670, 115, 688],
      A: { S: 'URI' } }));
    contents.node.set(PDFName.of('Annots'), pdf.context.obj([link, external]));
    expect(await inspectPublicationContentsDestinations(await pdf.save(), bounds, rows))
      .toEqual([{ ...rows[0], destinationCheck: 'unresolved' }]);
    contents.node.delete(PDFName.of('Annots'));
    expect(await inspectPublicationContentsDestinations(await pdf.save(), bounds, rows))
      .toEqual([{ ...rows[0], destinationCheck: 'unresolved' }]);
  });
});
