import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { crc32 } from 'node:zlib';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
import { WORD_IMAGE, WORD_NS, wordDrawing, wordImportFixture, wordParagraph, wordRun } from '../_helpers/wordImportFixture';
import { wordReviewStaticDigest } from '@/services/docx/review/staticContent';
installWordXmlDom();
const wrap = (body: string) => `<w:hdr xmlns:w="${WORD_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">${body}</w:hdr>`;
async function changed(bytes: Uint8Array, part: string, rewrite: (xml: string) => string) {
  const zip = await JSZip.loadAsync(bytes);zip.file(part, rewrite(await zip.file(part)!.async('string')));return zip.generateAsync({ type: 'uint8array' });
}

describe('Word review header/footer content bindings', () => {
  it('binds the actual section reference and type rather than an unused relationship pool', async () => {
    const bytes = await wordImportFixture(wordParagraph('Body'), { 'word/header1.xml': wrap(wordParagraph('Original header')) });
    const original = await wordReviewStaticDigest(bytes);
    expect(await wordReviewStaticDigest(await changed(bytes, 'word/document.xml', xml => xml.replace(/<w:headerReference[^>]*\/>/, '')))).not.toBe(original);
    expect(await wordReviewStaticDigest(await changed(bytes, 'word/document.xml', xml => xml.replace('w:type="default"', 'w:type="first"')))).not.toBe(original);
    const zip = await JSZip.loadAsync(bytes);zip.file('word/renamed-header.xml', await zip.file('word/header1.xml')!.async('uint8array'));zip.remove('word/header1.xml');
    zip.file('word/_rels/document.xml.rels', (await zip.file('word/_rels/document.xml.rels')!.async('string')).replace('Target="header1.xml"', 'Target="renamed-header.xml"'));
    expect(await wordReviewStaticDigest(await zip.generateAsync({ type: 'uint8array' }))).toBe(original);
  });
  it('retains DOCPROPERTY cached content and normalizes only explicit pagination cache values', async () => {
    const body = `<w:p><w:fldSimple w:instr="DOCPROPERTY Title">${wordRun('Original title')}</w:fldSimple><w:fldSimple w:instr="PAGE">${wordRun('1')}</w:fldSimple></w:p>`;
    const bytes = await wordImportFixture(wordParagraph('Body'), { 'word/header1.xml': wrap(body) }), original = await wordReviewStaticDigest(bytes);
    expect(await wordReviewStaticDigest(await changed(bytes, 'word/header1.xml', xml => xml.replace('Original title', 'Different title')))).not.toBe(original);
    expect(await wordReviewStaticDigest(await changed(bytes, 'word/header1.xml', xml => xml.replace(wordRun('1'), wordRun('99'))))).toBe(original);
    expect(await wordReviewStaticDigest(await changed(bytes, 'word/header1.xml', xml => xml.replace(wordRun('1'), wordRun('SECRET'))))).not.toBe(original);
  });
  it('rejects body fields even if their cached text equals the reviewed native paragraph', async () => {
    const bytes = await wordImportFixture('<w:p><w:fldSimple w:instr="DOCPROPERTY DifferentSource">' + wordRun('Unchanged native text') + '</w:fldSimple></w:p>');
    await expect(wordReviewStaticDigest(bytes)).rejects.toThrow('Body Word fields require manual review');
  });
  it('binds each image occurrence to its actual resource, permitting harmless relationship-ID rewrites', async () => {
    const image = Uint8Array.from(atob(WORD_IMAGE), char => char.charCodeAt(0)), chunk = new Uint8Array(18), view = new DataView(chunk.buffer);
    view.setUint32(0, 6);chunk.set(new TextEncoder().encode('tEXtk\0test'), 4);view.setUint32(14, crc32(chunk.subarray(4, 14)));
    const second = Uint8Array.from([...image.subarray(0, -12), ...chunk, ...image.subarray(-12)]);
    const bytes = await wordImportFixture(wordParagraph('Body'), {
      'word/header1.xml': wrap(`<w:p>${wordDrawing.replace('image1', 'first')}${wordDrawing.replace('image1', 'second')}</w:p>`),
      'word/_rels/header1.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="first" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/first.png"/><Relationship Id="second" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/second.png"/></Relationships>',
      'word/media/first.png': image, 'word/media/second.png': second,
    });
    const original = await wordReviewStaticDigest(bytes);
    expect(await wordReviewStaticDigest(await changed(bytes, 'word/header1.xml', xml => xml.replace('A green test square', 'A different meaningful description')))).not.toBe(original);
    expect(await wordReviewStaticDigest(await changed(bytes, 'word/header1.xml', xml => xml.replace('r:embed="first"', 'r:embed="TEMP"').replace('r:embed="second"', 'r:embed="first"').replace('r:embed="TEMP"', 'r:embed="second"')))).not.toBe(original);
    const renamed = await changed(await changed(bytes, 'word/header1.xml', xml => xml.replace('r:embed="first"', 'r:embed="renamed"')), 'word/_rels/header1.xml.rels', xml => xml.replace('Id="first"', 'Id="renamed"'));
    expect(await wordReviewStaticDigest(renamed)).toBe(original);
  });
});
