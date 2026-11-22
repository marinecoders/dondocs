// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { inspectPublicationWordNavigation, inspectPublicationWordRender, publicationWordPageSizes } from '../../scripts/publication-word-renders';

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
  const source = `<z:document xmlns:z="${ns}"><z:body><z:p><z:hyperlink z:anchor="publication_1"/>
    <z:fldSimple z:instr=" PAGEREF publication_1 \\h "/></z:p><z:p>
    <z:bookmarkStart z:name="publication_1" z:id="1"/><z:bookmarkEnd z:id="1"/></z:p></z:body></z:document>`;

  it('binds the contents link and its field to the actual named bookmark', () => {
    expect(inspectPublicationWordNavigation(source)).toEqual({ bookmarks: 1, internalLinks: 1, pageReferences: 1 });
  });

  it('rejects different existing destinations for a contents link and its page reference', () => {
    const extra = '<z:bookmarkStart z:name="publication_2" z:id="2"/><z:bookmarkEnd z:id="2"/>';
    const withSecond = source.replace('</z:body>', extra + '</z:body>');
    expect(() => inspectPublicationWordNavigation(withSecond.replace('PAGEREF publication_1', 'PAGEREF publication_2')))
      .toThrow('link and its Word PAGEREF field disagree');
    expect(() => inspectPublicationWordNavigation(source.replace('<z:hyperlink z:anchor="publication_1"/>', '')))
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
