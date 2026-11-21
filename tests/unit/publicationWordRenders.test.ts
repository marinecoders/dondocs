// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { inspectPublicationWordRender, publicationWordPageSizes } from '../../scripts/publication-word-renders';

const xml = '<w:document xmlns:w="urn:test"><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr><w:sectPr><w:pgSz w:w="15840" w:h="15840"/></w:sectPr></w:document>';
const input = () => ({ renderer: 'microsoft-word' as const, metadata: 'Creator: Word\nProducer: macOS\n',
  boundingBoxes: '<doc><page width="612" height="792"><word xMin="54" yMin="54" xMax="125" yMax="65">REQUIRED</word><word xMin="54" yMin="70" xMax="100" yMax="81">CONTENT</word></page></doc>',
  markers: ['REQUIRED CONTENT'], pageSizes: publicationWordPageSizes(xml) });

describe('publication target-renderer measurements', () => {
  it('accepts searchable required content and every declared source page geometry', () => {
    expect(publicationWordPageSizes(xml)).toEqual([{ width: 612, height: 792 }, { width: 792, height: 792 }]);
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
    expect(() => publicationWordPageSizes('<w:document xmlns:w="urn:test"/>')).toThrow('invalid page geometry');
  });
});
