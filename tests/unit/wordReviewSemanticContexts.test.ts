import { afterAll, beforeAll, expect, it } from 'vitest';
import { XMLSerializer } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
import { wordDrawing, wordImportFixture, wordParagraph, wordRun } from '../_helpers/wordImportFixture';
import { readWordDocument } from '@/services/docx/import/readWord';
import { stampWordReviewIdentity, readWordReviewIdentity } from '@/services/docx/review/identity';
import { buildWordReviewHandoff, matchWordReviewHandoff } from '@/lib/wordReviewBaseline';
import { wordReviewStaticDigest } from '@/services/docx/review/staticContent';
import { wordChildren, wordDescendants, wordXml } from '@/services/docx/import/archive';
import { createBlankSession } from '@/stores/documentStore';
import type { ReviewRound } from '@/lib/reviewRounds';
installWordXmlDom();
const serializer = globalThis.XMLSerializer;
beforeAll(() => { globalThis.XMLSerializer = XMLSerializer as unknown as typeof globalThis.XMLSerializer; });
afterAll(() => { globalThis.XMLSerializer = serializer; });
const baseline = 'Keep baseline. Review the site.', revised = 'Keep newer text. Review the site.';
const linkRels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="link" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.test/original" TargetMode="External"/></Relationships>';
async function fixture(body: string, extra: Record<string, string> = {}, native = baseline) {
  const session = createBlankSession();session.paragraphs = [{ id: 'body', level: 0, text: native }];session.timestamp = 1;
  const round: ReviewRound = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`, label: 'Semantic contexts', createdAt: 1,
    sourceDocumentId: 'owner', ownerDocumentId: 'owner', baselineDigest: 'a'.repeat(64), baseline: { ts: 1, session } };
  const raw = await wordImportFixture(body, extra), imported = await readWordDocument(raw, 'issued.docx'), id = crypto.randomUUID();
  const plan = await buildWordReviewHandoff(round, imported, { id, createdAt: 2, docxSha256: imported.source.sha256 });round.wordHandoffs = [plan.receipt];
  const bytes = await stampWordReviewIdentity(raw, { handoffId: id, roundId: round.id, baselineDigest: round.baselineDigest }, plan.sourceIndexes);
  const match = async (bytes: Uint8Array) => matchWordReviewHandoff(round, await readWordReviewIdentity(bytes), await readWordDocument(bytes, 'return.docx'), 'owner');
  expect((await match(bytes))[0]).toMatchObject({ expected: native, proposed: native });return { bytes, match };
}
async function rewrite(bytes: Uint8Array, part: string, change: (xml: string) => string) {
  const zip = await JSZip.loadAsync(bytes);zip.file(part, change(await zip.file(part)!.async('string')));return zip.generateAsync({ type: 'uint8array' });
}
const linkedBody = () => `<w:p>${wordRun('1. Keep baseline. ')}<w:hyperlink r:id="link">${wordRun('Review the site.')}</w:hyperlink></w:p>`;
const table = (first: string, second: string) => `<w:tbl><w:tr><w:tc>${wordParagraph('Component A')}</w:tc><w:tc><w:p>${first}</w:p></w:tc></w:tr><w:tr><w:tc>${wordParagraph('Component B')}</w:tc><w:tc><w:p>${second}</w:p></w:tc></w:tr></w:tbl>`;

it('refuses a changed hyperlink destination with unchanged displayed text', async () => {
  const { bytes, match } = await fixture(linkedBody(), { 'word/_rels/document.xml.rels': linkRels });
  await expect(match(await rewrite(bytes, 'word/_rels/document.xml.rels', xml => xml.replace('/original', '/different')))).rejects.toThrow('protected hyperlink');
});
it('refuses an internal hyperlink anchor change without changing its visible wording', async () => {
  const linked = `<w:p>${wordRun('1. Keep baseline. ')}<w:hyperlink w:anchor="Original">${wordRun('Review the site.')}</w:hyperlink></w:p>`;
  const { bytes, match } = await fixture(linked);
  await expect(match(await rewrite(bytes, 'word/document.xml', xml => xml.replace('w:anchor="Original"', 'w:anchor="Different"')))).rejects.toThrow('protected hyperlink');
});
it('binds a hyperlink to its repeated phrase rather than only its paragraph and displayed text', async () => {
  const native = 'For Section A see here; for Section B see here.';
  const link = '<w:hyperlink r:id="link">' + wordRun('see here') + '</w:hyperlink>';
  const first = wordRun('1. For Section A ') + link + wordRun('; for Section B see here.');
  const second = wordRun('1. For Section A see here; for Section B ') + link + wordRun('.');
  const { bytes, match } = await fixture(`<w:p>${first}</w:p>`, { 'word/_rels/document.xml.rels': linkRels }, native);
  const moved = await rewrite(bytes, 'word/document.xml', xml => xml.replace(first, second));
  expect((await readWordDocument(moved, 'moved.docx')).plainText).toBe((await readWordDocument(bytes, 'issued.docx')).plainText);
  await expect(match(moved)).rejects.toThrow('protected hyperlink');
  const unchangedAssociation = await rewrite(bytes, 'word/document.xml', xml => xml.replace('For Section A ', 'For updated Section A '));
  expect((await match(unchangedAssociation))[0].proposed).toBe(native.replace('Section A', 'updated Section A'));
  const secondBinding = await fixture(`<w:p>${second}</w:p>`, { 'word/_rels/document.xml.rels': linkRels }, native);
  await expect(secondBinding.match(await rewrite(secondBinding.bytes, 'word/document.xml', xml => xml.replace(second, first)))).rejects.toThrow('protected hyperlink');
  expect((await secondBinding.match(await rewrite(secondBinding.bytes, 'word/document.xml', xml => xml.replace('For Section A ', 'For updated Section A '))))[0].proposed).toBe(native.replace('Section A', 'updated Section A'));
});
async function moveImageToSecondCell(bytes: Uint8Array, nested = false) {
  const zip = await JSZip.loadAsync(bytes), before = await zip.file('word/document.xml')!.async('string');
  const xml = wordXml(new TextEncoder().encode(before), 'test document');
  const target = wordDescendants(xml, 'tbl')[nested ? 1 : 0], rows = wordChildren(target, 'tr');
  const first = wordChildren(wordChildren(rows[0], 'tc')[1], 'p')[0], second = wordChildren(wordChildren(rows[1], 'tc')[1], 'p')[0];
  expect(wordDescendants(first, 'drawing')).toHaveLength(1);expect(wordDescendants(second, 'drawing')).toHaveLength(0);
  const run = wordDescendants(first, 'drawing')[0].parentNode;
  if (!run || run.parentNode !== first) throw new Error('The synthetic drawing is not owned by its expected cell paragraph.');
  second.appendChild(run);
  expect(wordDescendants(first, 'drawing')).toHaveLength(0);expect(wordDescendants(second, 'drawing')).toHaveLength(1);
  const after = new XMLSerializer().serializeToString(xml);expect(after).not.toBe(before);
  zip.file('word/document.xml', after);return zip.generateAsync({ type: 'uint8array' });
}
it('binds an actual moved image to its named table cell', async () => {
  const { bytes, match } = await fixture(wordParagraph('1. ' + baseline) + table(wordDrawing, ''));
  await expect(match(await moveImageToSecondCell(bytes))).rejects.toThrow('drawing');
});
it('binds nested table row/cell ownership while unsupported native layout remains a refusal', async () => {
  const nested = `<w:tbl><w:tr><w:tc>${table(wordDrawing, '')}</w:tc></w:tr></w:tbl>`;
  await expect(fixture(wordParagraph('1. ' + baseline) + nested)).rejects.toThrow('cannot be matched completely');
  const bytes = await wordImportFixture(wordParagraph('1. ' + baseline) + nested);
  expect(await wordReviewStaticDigest(await moveImageToSecondCell(bytes, true))).not.toBe(await wordReviewStaticDigest(bytes));
});
it('also retains header hyperlink anchors rather than comparing only the displayed header text', async () => {
  const bytes = await wordImportFixture(wordParagraph('1. ' + baseline), { 'word/header1.xml': '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:hyperlink w:anchor="Original">' + wordRun('Header link') + '</w:hyperlink></w:p></w:hdr>' });
  expect(await wordReviewStaticDigest(await rewrite(bytes, 'word/header1.xml', xml => xml.replace('w:anchor="Original"', 'w:anchor="Different"')))).not.toBe(await wordReviewStaticDigest(bytes));
});
it('allows ordinary surrounding text changes after hyperlink relationship and run rewrites', async () => {
  const { bytes, match } = await fixture(linkedBody(), { 'word/_rels/document.xml.rels': linkRels });
  const changed = await rewrite(await rewrite(bytes, 'word/document.xml', xml => xml.replace('1. Keep baseline. ', '1. Keep newer text. ')
    .replace('r:id="link"', 'r:id="renamedLink"').replace(wordRun('Review the site.'), wordRun('Review ') + wordRun('the site.'))),
  'word/_rels/document.xml.rels', xml => xml.replace('Id="link"', 'Id="renamedLink"'));
  expect((await match(changed))[0]).toMatchObject({ expected: baseline, proposed: revised });
});
it('allows body edits and split cell runs while the image remains in its original component cell', async () => {
  const { bytes, match } = await fixture(wordParagraph('1. ' + baseline) + table(wordDrawing, ''));
  const changed = await rewrite(await rewrite(bytes, 'word/document.xml', xml => xml.replace(baseline, revised)
    .replace(wordRun('Component A'), wordRun('Component ') + wordRun('A')).replace('r:embed="image1"', 'r:embed="renamedImage"')),
  'word/_rels/document.xml.rels', xml => xml.replace('Id="image1"', 'Id="renamedImage"'));
  expect((await match(changed))[0]).toMatchObject({ expected: baseline, proposed: revised });
});
