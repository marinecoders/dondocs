import 'fake-indexeddb/auto';
import { PDFDocument } from 'pdf-lib';
import { expect, it } from 'vitest';
import { captureOriginalPackageMember, readPackageAsset } from '@/lib/actionPackageAssets';
import { createActionPackage, getPackageRevision, reviseActionPackage } from '@/lib/actionPackages';
import { buildPortableActionPackage, parsePortableActionPackage } from '@/lib/actionPackageTransfer';
import { createSemanticInterchange, openSemanticInterchange, semanticInterchangeSchema } from '@/lib/semanticInterchange';
import { reviewPayloadDigest } from '@/lib/reviewRounds';

function draft() {
  return {
    version: '1.1', documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'Synthetic action' }, references: [{ letter: 'a', title: 'Training reference' }],
    enclosures: [], copyTos: [], paragraphs: [
      { id: 'a', text: 'First paragraph', level: 0 },
      { id: 'b', text: 'Subparagraph', level: 1 },
      { id: 'c', text: 'Second paragraph', level: 0 },
    ],
  };
}

it('indexes naval paragraphs and preserves the portable draft and author assertions', async () => {
  const source = draft();
  const encoded = await createSemanticInterchange(source, '1.3.219', {
    lifecycle: 'issued', issuanceReferences: ['Training memo 1'],
  });
  expect(encoded.source).toEqual({ kind: 'draft', docType: 'naval_letter', documentId: null, revisionId: null });
  expect(encoded.paragraphIndex).toEqual([
    { id: 'a', level: 0, designator: '1.' }, { id: 'b', level: 1, designator: 'a.' },
    { id: 'c', level: 0, designator: '2.' },
  ]);
  const opened = await openSemanticInterchange(JSON.parse(JSON.stringify(encoded)));
  expect(opened.payload).toEqual(source);
  expect(opened.authorAssertions?.lifecycle).toBe('issued');
  expect(semanticInterchangeSchema().capabilities).toMatchObject({
    import: [1], lifecycleEvidence: 'author-asserted', verification: 'integrity-only',
  });
});

it('rejects an unknown version, changed bytes, or a rehashed false index', async () => {
  const encoded = await createSemanticInterchange(draft(), '1.3.219');
  await expect(openSemanticInterchange({ ...encoded, version: 2 })).rejects.toThrow('unsupported');
  const { integrity, ...value } = encoded;
  const forged = { ...value, paragraphIndex: value.paragraphIndex.map(row => ({ ...row, designator: '12.' })) };
  await expect(openSemanticInterchange({ ...forged, integrity })).rejects.toThrow('digest does not match');
  await expect(openSemanticInterchange({ ...forged, integrity: { ...integrity, digest: await reviewPayloadDigest(forged) } }))
    .rejects.toThrow('index does not match');
});

it('retains the exact selected revision and original PDF bytes', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const originalBytes = Uint8Array.from(await pdf.save());
  const original = await captureOriginalPackageMember({ name: 'original.pdf', data: originalBytes.buffer }, 'supporting-document', false);
  if (original.kind !== 'original') throw new Error('Expected an original PDF member.');
  const record = await reviseActionPackage(await createActionPackage('Synthetic package'), [original]);
  const source = JSON.parse(await buildPortableActionPackage(record));
  const encoded = await createSemanticInterchange(source, '1.3.219');
  expect(encoded.source).toMatchObject({ kind: 'package', documentId: record.id, revisionId: record.currentRevisionId });
  const opened = await openSemanticInterchange(JSON.parse(JSON.stringify(encoded)));
  const parsed = await parsePortableActionPackage(JSON.stringify(opened.payload));
  expect(parsed.record.revisions).toHaveLength(1);
  expect(getPackageRevision(parsed.record).members[0]).toEqual(original);
  expect(parsed.resources.get(`assets/${original.original.id}`)?.data).toEqual(await readPackageAsset(original.original));
  expect(new Uint8Array(parsed.resources.get(`assets/${original.original.id}`)!.data)).toEqual(originalBytes);
});

it('binds author assertion whitespace and rejects properties discarded by the JSON schema parser', async () => {
  const value = await createSemanticInterchange(draft(), '1.3.219', {
    lifecycle: 'issued', issuanceReferences: [' Ref A '],
  });
  expect(value.authorAssertions?.issuanceReferences).toEqual([' Ref A ']);
  await expect(openSemanticInterchange({
    ...value, authorAssertions: { ...value.authorAssertions, issuanceReferences: ['Ref A'] },
  })).rejects.toThrow('digest');
  const extra = JSON.parse('{"__proto__":{"ignored":true}}');
  await expect(openSemanticInterchange({ ...value, payload: { ...value.payload, ...extra } })).rejects.toThrow('unsupported JSON property');
  await expect(createSemanticInterchange({ ...draft(), ...extra }, '1.3.219')).rejects.toThrow('unsupported JSON property');
  await expect(openSemanticInterchange({ ...value, source: { ...value.source, ...extra } })).rejects.toThrow('unsupported JSON property');
});

it('snapshots the draft and its assertions before the first asynchronous validation step', async () => {
  const source = draft();
  const author = { lifecycle: 'draft', issuanceReferences: ['Original'] };
  const sealed = createSemanticInterchange(source, '1.3.219', author);
  source.paragraphs[0].text = 'Later edit';
  author.issuanceReferences[0] = 'Edited later';
  const result = await openSemanticInterchange(await sealed);
  expect(result.payload).toMatchObject({ paragraphs: [expect.objectContaining({ text: 'First paragraph' }), expect.anything(), expect.anything()] });
  expect(result.authorAssertions?.issuanceReferences).toEqual(['Original']);
});
