import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { XMLSerializer as XmlSerializer } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
import { wordImportFixture, wordParagraph } from '../_helpers/wordImportFixture';
import { readWordReviewIdentity, stampWordReviewIdentity } from '@/services/docx/review/identity';
import { readWordDocument } from '@/services/docx/import/readWord';
installWordXmlDom();
const originalSerializer = globalThis.XMLSerializer;
beforeAll(() => { globalThis.XMLSerializer = XmlSerializer as unknown as typeof XMLSerializer; });
afterAll(() => { globalThis.XMLSerializer = originalSerializer; });
const locator = { handoffId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', roundId: 'review_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', baselineDigest: 'a'.repeat(64) };
const source = () => wordImportFixture(wordParagraph('First baseline paragraph') + wordParagraph('Second baseline paragraph'));
const stamped = async () => stampWordReviewIdentity(await source(), locator, [0, 1]);
async function mutate(part: string, map: (text: string) => string) {
  const zip = await JSZip.loadAsync(await stamped()); zip.file(part, map(await zip.file(part)!.async('string')));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

describe('Word review matching evidence', () => {
  it('round-trips actual DOCX metadata/bookmarks without changing baseline text', async () => {
    const bytes = await source(), before = bytes.slice(), output = await stampWordReviewIdentity(bytes, locator, [0, 1]);
    expect(bytes).toEqual(before);
    expect(await readWordReviewIdentity(output)).toEqual({ locator, markers: [{ ordinal: 0, sourceIndex: 0 }, { ordinal: 1, sourceIndex: 1 }] });
    const parsed = await readWordDocument(output, 'review.docx');
    expect(parsed.blocks.map(block => block.paragraph.text)).toEqual(['First baseline paragraph', 'Second baseline paragraph']);
  });
  it('owns Node buffers and caller metadata before asynchronous reads', async () => {
    const bytes = Buffer.from(await source()), input = { ...locator }, indexes = [0, 1];
    const pending = stampWordReviewIdentity(bytes, input, indexes);
    bytes.fill(0); input.roundId = 'changed'; indexes.reverse();
    expect((await readWordReviewIdentity(await pending)).locator).toEqual(locator);
  });
  it('requires unambiguous complete bookmark evidence', async () => {
    await expect(readWordReviewIdentity(await source())).rejects.toThrow('intact DonDocs review identity');
    await expect(readWordReviewIdentity(await mutate('word/document.xml', text => text.replace('DDReview_1', 'DDReview_0')))).rejects.toThrow('duplicated');
    await expect(readWordReviewIdentity(await mutate('word/document.xml', text => text.replace('DDReview_1', 'DDReview_2')))).rejects.toThrow('incomplete');
    await expect(stampWordReviewIdentity(await stamped(), locator, [0, 1])).rejects.toThrow('already');
  });
  it('does not treat a changed but syntactically valid locator as local authority', async () => {
    const changed = await readWordReviewIdentity(await mutate('customXml/dondocs-word-review.xml', text => text.replace(locator.handoffId, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')));
    expect(changed.locator.handoffId).not.toBe(locator.handoffId);
    // The reader only returns evidence. Issued-receipt/owner matching belongs
    // to the native round adapter, not editable Word metadata.
    expect(Object.keys(changed)).toEqual(['locator', 'markers']);
  });
  it('rejects modified payloads, ambiguous parts and unsupported relationships', async () => {
    await expect(readWordReviewIdentity(await mutate('customXml/dondocs-word-review.xml', text => text.replace('/>', '>extra</review>')))).rejects.toThrow('modified');
    await expect(readWordReviewIdentity(await mutate('word/_rels/document.xml.rels', text => text.replace('Target="../customXml/dondocs-word-review.xml"', 'Target="https://example.invalid/review.xml" TargetMode="External"')))).rejects.toThrow('intact');
    await expect(readWordReviewIdentity(await mutate('[Content_Types].xml', text => text.replace('PartName="/customXml/dondocs-word-review.xml" ContentType="application/xml"', 'PartName="/customXml/dondocs-word-review.xml" ContentType="text/plain"')))).rejects.toThrow('content type');
  });
  it('accepts an internally renamed custom XML part without trusting its filename', async () => {
    const zip = await JSZip.loadAsync(await stamped()), part = 'customXml/dondocs-word-review.xml';
    zip.file('customXml/item42.xml', await zip.file(part)!.async('uint8array')); zip.remove(part);
    zip.file('word/_rels/document.xml.rels', (await zip.file('word/_rels/document.xml.rels')!.async('string')).replace('../'+part, '../customXml/item42.xml'));
    zip.file('[Content_Types].xml', (await zip.file('[Content_Types].xml')!.async('string')).replace('/'+part, '/customXml/item42.xml'));
    expect((await readWordReviewIdentity(await zip.generateAsync({ type: 'uint8array' }))).locator).toEqual(locator);
  });
  it('bounds inputs and binding complexity before changing package bytes', async () => {
    await expect(stampWordReviewIdentity(new Uint8Array(20 * 1024 * 1024 + 1), locator, [0])).rejects.toThrow('20 MB');
    await expect(stampWordReviewIdentity(await source(), locator, [1, 0])).rejects.toThrow('document order');
    const controller = new AbortController();controller.abort();
    await expect(stampWordReviewIdentity(await source(), locator, [0], controller.signal)).rejects.toThrow();
  });
  it('rejects a paragraph join that retains two apparent baseline markers', async () => {
    const joined = await mutate('word/document.xml', text => text.replace('</w:p><w:p>', ''));
    await expect(readWordReviewIdentity(joined)).rejects.toThrow('ambiguous');
  });
  it.each(['duplicate', 'nondecimal', 'end-before-start', 'non-review-collision'] as const)('rejects actual malformed bookmark evidence: %s', async kind => {
    const changed = await mutate('word/document.xml', text => {
      if (kind === 'duplicate') return text.replaceAll('w:id="2"', 'w:id="1"');
      if (kind === 'nondecimal') return text.replaceAll('w:id="2"', 'w:id="not-a-number"');
      if (kind === 'non-review-collision') return text.replace('<w:p>', '<w:p><w:bookmarkStart w:id="1" w:name="OtherBookmark"/><w:bookmarkEnd w:id="1"/>');
      const start = /<w:bookmarkStart[^>]*w:id="1"[^>]*\/>/.exec(text)![0];
      const end = /<w:bookmarkEnd[^>]*w:id="1"[^>]*\/>/.exec(text)![0];
      return text.replace(start, 'START_PLACEHOLDER').replace(end, start).replace('START_PLACEHOLDER', end);
    });
    await expect(readWordReviewIdentity(changed)).rejects.toThrow(/bookmark/);
  });
  it('uses the same bounded decimal identity range when stamping and reading', async () => {
    const original = await JSZip.loadAsync(await source());
    const xml = await original.file('word/document.xml')!.async('string');
    original.file('word/document.xml', xml.replace('<w:p>', '<w:p><w:bookmarkStart w:id="1000000000" w:name="NativeBookmark"/><w:bookmarkEnd w:id="1000000000"/>'));
    const bytes = await stampWordReviewIdentity(await original.generateAsync({ type: 'uint8array' }), locator, [0, 1]);
    expect((await readWordReviewIdentity(bytes)).markers).toHaveLength(2);
    original.file('word/document.xml', xml.replace('<w:p>', '<w:p><w:bookmarkStart w:id="2147483647" w:name="NativeBookmark"/><w:bookmarkEnd w:id="2147483647"/>'));
    await expect(stampWordReviewIdentity(await original.generateAsync({ type: 'uint8array' }), locator, [0, 1])).rejects.toThrow('range is exhausted');
  });

});
