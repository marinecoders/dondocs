import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { XMLSerializer as XmlSerializer } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { crc32 } from 'node:zlib';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
import { wordDrawing, wordImportFixture, wordParagraph, wordRun } from '../_helpers/wordImportFixture';
import { readWordDocument } from '@/services/docx/import/readWord';
import { readWordReviewIdentity, stampWordReviewIdentity } from '@/services/docx/review/identity';
import { buildWordReviewHandoff, matchWordReviewHandoff } from '@/lib/wordReviewBaseline';
import { parseReviewRound, type ReviewRound } from '@/lib/reviewRounds';
import type { SerializedSession } from '@/stores/documentStore';
installWordXmlDom();
const serializer = globalThis.XMLSerializer;
beforeAll(() => { globalThis.XMLSerializer = XmlSerializer as unknown as typeof XMLSerializer; });
afterAll(() => { globalThis.XMLSerializer = serializer; });
async function fixture(image = false, header = false, tableImage = false) {
  const session: SerializedSession = { documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter',
    formType: 'navmc_10274', formData: { subject: 'SYNTHETIC REVIEW', from: 'Example sender' },
    paragraphs: [{ id: 'first', level: 0, text: 'First baseline paragraph' }, { id: 'second', level: 0, text: 'Second baseline paragraph' }],
    references: [], enclosures: [], copyTos: [], distributions: [], timestamp: 1 };
  const round: ReviewRound = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`, label: 'Synthetic Word review', createdAt: 1,
    sourceDocumentId: 'owner', ownerDocumentId: 'owner', baselineDigest: 'a'.repeat(64), baseline: { ts: 1, session } };
  const original = await wordImportFixture(wordParagraph('From: Example sender') + wordParagraph('1. First baseline paragraph') + wordParagraph('2. Second baseline paragraph') + (image ? `<w:p>${wordDrawing}</w:p>` : '') + (tableImage ? `<w:tbl><w:tr><w:tc><w:p>${wordDrawing}</w:p></w:tc></w:tr></w:tbl>` : ''), header ? { 'word/header1.xml': `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${wordParagraph('EXACT HEADER')}<w:p><w:fldSimple w:instr="PAGE">${wordRun('1')}</w:fldSimple></w:p></w:hdr>` } : {});
  const imported = await readWordDocument(original, 'review.docx'), id = crypto.randomUUID();
  const plan = await buildWordReviewHandoff(round, imported, { id, createdAt: 2, docxSha256: imported.source.sha256 });
  const bytes = await stampWordReviewIdentity(original, { handoffId: id, roundId: round.id, baselineDigest: round.baselineDigest }, plan.sourceIndexes);
  round.wordHandoffs = [plan.receipt];
  return { round: parseReviewRound(round), bytes, receipt: plan.receipt };
}
async function match(round: ReviewRound, bytes: Uint8Array, owner = 'owner') {
  return matchWordReviewHandoff(round, await readWordReviewIdentity(bytes), await readWordDocument(bytes, 'returned.docx'), owner);
}
async function rewrite(bytes: Uint8Array, map: (text: string) => string) {
  const zip = await JSZip.loadAsync(bytes);zip.file('word/document.xml', map(await zip.file('word/document.xml')!.async('string')));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

describe('authoritative Word review baseline matching', () => {
  it('maps an actual stamped DOCX to its issued local paragraph identities', async () => {
    const { round, bytes } = await fixture(), before = structuredClone(round);
    expect(await match(round, bytes)).toEqual([
      { paragraphId: 'first', sourceIndex: 1, plainPrefixLength: 3, expected: 'First baseline paragraph', proposed: 'First baseline paragraph' },
      { paragraphId: 'second', sourceIndex: 2, plainPrefixLength: 3, expected: 'Second baseline paragraph', proposed: 'Second baseline paragraph' },
    ]);
    expect(round).toEqual(before);
  });
  it('requires a local issued receipt and the actual owner, never merely matching Word IDs', async () => {
    const { round, bytes } = await fixture();
    await expect(match({ ...round, wordHandoffs: undefined }, bytes)).rejects.toThrow('authoritative');
    await expect(match(round, bytes, 'other-document')).rejects.toThrow('owned by the open');
    const changed = await JSZip.loadAsync(bytes);
    changed.file('customXml/dondocs-word-review.xml', (await changed.file('customXml/dondocs-word-review.xml')!.async('string')).replace(round.wordHandoffs![0].id, crypto.randomUUID()));
    await expect(match(round, await changed.generateAsync({ type: 'uint8array' }))).rejects.toThrow('authoritative');
  });
  it('converts changed returned body text into proposals against the local baseline', async () => {
    const { round, bytes } = await fixture();
    const changed = await rewrite(bytes, xml => xml.replace('First baseline paragraph', 'First proposed paragraph'));
    expect((await match(round, changed))[0]).toMatchObject({ paragraphId: 'first', expected: 'First baseline paragraph', proposed: 'First proposed paragraph' });
    expect(round.baseline.session.paragraphs[0].text).toBe('First baseline paragraph');
  });
  it('uses actual Word tracked text only when its complete before view matches the issued baseline', async () => {
    const { round, bytes } = await fixture();
    const revise = (before: string) => rewrite(bytes, xml => xml.replace(wordRun('1. First baseline paragraph'), wordRun('1. First ') + `<w:del w:id="1" w:author="Reviewer"><w:r><w:delText>${before}</w:delText></w:r></w:del><w:ins w:id="2" w:author="Reviewer">${wordRun('reviewed')}</w:ins>` + wordRun(' paragraph')));
    expect((await match(round, await revise('baseline')))[0].proposed).toBe('First reviewed paragraph');
    await expect(match(round, await revise('forged'))).rejects.toThrow('tracked-edit baseline differs');
  });
  it('rejects unmapped field changes, changed numbering and structural additions', async () => {
    const { round, bytes } = await fixture();
    await expect(match(round, await rewrite(bytes, xml => xml.replace('Example sender', 'Changed sender')))).rejects.toThrow('unmapped field');
    await expect(match(round, await rewrite(bytes, xml => xml.replace('1. First', '9. First')))).rejects.toThrow('printed paragraph label');
    await expect(match(round, await rewrite(bytes, xml => xml.replace('<w:sectPr', wordParagraph('Unmapped addition') + '<w:sectPr')))).rejects.toThrow('paragraph boundaries');
  });
  it('fingerprints owned image bytes while permitting a harmless package media rename', async () => {
    const { round, bytes } = await fixture(true);
    expect(await match(round, bytes)).toHaveLength(2);
    const renamed = await JSZip.loadAsync(bytes), image = await renamed.file('word/media/test.png')!.async('uint8array');
    renamed.file('word/media/renamed.png', image);renamed.remove('word/media/test.png');
    renamed.file('word/_rels/document.xml.rels', (await renamed.file('word/_rels/document.xml.rels')!.async('string')).replace('media/test.png', 'media/renamed.png'));
    expect(await match(round, await renamed.generateAsync({ type: 'uint8array' }))).toHaveLength(2);
    const changed = await JSZip.loadAsync(bytes);
    const chunk = new Uint8Array(18), view = new DataView(chunk.buffer);view.setUint32(0, 6);
    chunk.set(new TextEncoder().encode('tEXtk\0test'), 4);view.setUint32(14, crc32(chunk.subarray(4, 14)));
    changed.file('word/media/test.png', Uint8Array.from([...image.subarray(0, -12), ...chunk, ...image.subarray(-12)]));
    await expect(match(round, await changed.generateAsync({ type: 'uint8array' }))).rejects.toThrow('drawing or header/footer');
  });
  it('blocks changed header text while allowing Word run splitting and cached page-field refreshes', async () => {
    const { round, bytes } = await fixture(false, true), zip = await JSZip.loadAsync(bytes);
    const header = await zip.file('word/header1.xml')!.async('string');
    zip.file('word/header1.xml', header.replace('EXACT HEADER', 'CHANGED HEADER'));
    await expect(match(round, await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow('header/footer');
    zip.file('word/header1.xml', header.replace(wordRun('EXACT HEADER'), wordRun('EXACT ') + wordRun('HEADER')).replace(wordRun('1'), wordRun('99')));
    expect(await match(round, await zip.generateAsync({ type: 'uint8array' }))).toHaveLength(2);
    zip.file('word/header1.xml', header.replace('PAGE', 'NUMPAGES'));
    await expect(match(round, await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow('header/footer');
  });
  it('does not silently discard tracked edits to unmapped native fields', async () => {
    const { round, bytes } = await fixture();
    const returned = await rewrite(bytes, xml => xml.replace(wordRun('From: Example sender'), wordRun('From: ') + '<w:del w:id="4"><w:r><w:delText>Example sender</w:delText></w:r></w:del><w:ins w:id="5">' + wordRun('Changed sender') + '</w:ins>'));
    await expect(match(round, returned)).rejects.toThrow('unmapped field or structural block');
  });
  it('rejects incomplete tracked content rather than interpreting the before view as no change', async () => {
    const { round, bytes } = await fixture();
    const returned = await rewrite(bytes, xml => xml.replace(wordRun('1. First baseline paragraph'), '<w:moveFrom w:id="7">' + wordRun('1. First baseline paragraph') + '</w:moveFrom>'));
    await expect(match(round, returned)).rejects.toThrow('unsupported or unassessed tracked changes');
  });
  it('requires manual review for unsupported top-level Word alternatives', async () => {
    const { round, bytes } = await fixture();
    const changed = await rewrite(bytes, xml => xml.replace('<w:sectPr', '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="x">' + wordParagraph('Unmatched new body paragraph') + '</mc:Choice></mc:AlternateContent><w:sectPr'));
    await expect(match(round, changed)).rejects.toThrow('unsupported body');
  });
  it('does not ignore image-byte changes inside an otherwise unchanged layout table', async () => {
    const { round, bytes } = await fixture(false, false, true), zip = await JSZip.loadAsync(bytes), image = await zip.file('word/media/test.png')!.async('uint8array');
    const chunk = new Uint8Array(18), view = new DataView(chunk.buffer);view.setUint32(0, 6);chunk.set(new TextEncoder().encode('tEXtk\0test'), 4);view.setUint32(14, crc32(chunk.subarray(4, 14)));
    zip.file('word/media/test.png', Uint8Array.from([...image.subarray(0, -12), ...chunk, ...image.subarray(-12)]));
    await expect(match(round, await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow();
  });
  it('honors cancellation without mutating retained authority', async () => {
    const { round, bytes } = await fixture(), controller = new AbortController();controller.abort();
    await expect(matchWordReviewHandoff(round, await readWordReviewIdentity(bytes), await readWordDocument(bytes, 'returned.docx'), 'owner', controller.signal)).rejects.toThrow();
    expect(round.wordHandoffs).toHaveLength(1);
  });
  it('rejects forged retained prefixes even in an otherwise valid native round', async () => {
    const { round } = await fixture(), forged = structuredClone(round);
    const binding = forged.wordHandoffs![0].blocks.find(block => block.kind === 'paragraph')!;
    if (binding.kind !== 'paragraph') throw new Error('Missing test binding.');
    binding.prefix = 'SECRET\n';
    expect(() => parseReviewRound(forged)).toThrow('saved review baseline is invalid');
  });
});
