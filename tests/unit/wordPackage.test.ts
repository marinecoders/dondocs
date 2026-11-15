import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { capturePackageMember, captureOriginalPackageMember, retainPackageAsset } from '@/lib/actionPackageAssets';
import { type ActionPackage, type PackageMember } from '@/lib/actionPackages';
import { buildPortableActionPackage, parsePortableActionPackage } from '@/lib/actionPackageTransfer';
import * as packageTransfer from '@/lib/actionPackageTransfer';
import { persistAttachment } from '@/lib/attachments';
import { buildDraftFileFromSnapshot, parseDraftFile } from '@/lib/draftFile';
import { idbDeleteAttachment, idbPutAttachment } from '@/lib/documentsDb';
import { portableResourceDigest } from '@/lib/portableResources';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { acknowledgeWordPackage, prepareWordPackage, renderWordPackage, wordPackageFilename, MAX_WORD_PACKAGE_BYTES, MAX_WORD_DOCUMENT_BYTES } from '@/services/exports/wordPackage';
import type { DocumentSnapshot } from '@/stores/historyStore';
import { prepareSessionState } from '@/stores/documentStore';
import type { CorrespondenceRendererPorts } from '@/services/exports/correspondence';

const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
async function pdf() { const doc = await PDFDocument.create();doc.addPage().drawText('Original supporting file');return new Uint8Array(await doc.save()).buffer; }
async function fixture(extra: Partial<DocumentSnapshot> = {}) {
  const original = await pdf();
  const snapshot: DocumentSnapshot = { documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'CAPTURED LETTER', sigFirst: 'Alex', sigLast: 'Example' }, paragraphs: [{ text: 'Captured paragraph with Reference (a).', level: 0 }],
    references: [{ letter: 'a', title: 'Training guidance', url: 'https://example.test/guidance' }],
    enclosures: [{ title: 'Training annex', file: { name: '../../Annexe résumé.pdf', size: original.byteLength, data: original } }],
    copyTos: [], distributions: [], endItems: [], publicationTables: {}, ...extra };
  const main = await capturePackageMember(captureDocumentRevision({ documentId: '1234567890', epoch: 0, editSequence: 1, capturedAt: 1_794_600_000_000 }, snapshot), 'Lettre résumé', 'basic-letter');
  const support = await captureOriginalPackageMember({ name: 'CON.pdf', data: original }, 'enclosure', true);
  const record: ActionPackage = { kind: 'dondocs-action-package-record', version: 1, id: 'package_1234567890', name: 'Synthetic action', archived: false, sequence: 1,
    currentRevisionId: 'revision_saved', revisions: [{ id: 'revision_saved', createdAt: 1_794_600_000_000, members: [main, support], outputs: [] }] };
  return { record, main, support, original };
}
const ports: CorrespondenceRendererPorts = {
  compile: async () => { throw new Error('Word does not compile PDF.'); },
  convertDocx: async latex => { const zip = new JSZip();zip.file('word/document.xml', `<w:document>${latex}</w:document>`);return new Blob([new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))]); },
};

it('delivers one editable main document and every separate unchanged original with a measured digest manifest', async () => {
  const { record, original, main } = await fixture();
  const prepared = await prepareWordPackage(record, record.currentRevisionId, policy);
  expect(prepared.privacy.found).toBe(false); // Internal numeric identities are not content.
  await expect(renderWordPackage(prepared, ports)).rejects.toThrow('approve');
  acknowledgeWordPackage(prepared);
  const result = await renderWordPackage(prepared, ports);
  const zip = await JSZip.loadAsync(await result.blob.arrayBuffer(), { checkCRC32: true });
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  expect(manifest).toMatchObject({ completeness: 'complete', revisionId: 'revision_saved', mainDocument: 'members/001/Lettre résumé.docx' });
  expect(manifest.members[0]).toMatchObject({ order: 1, role: 'basic-letter', revisionId: main.revisionId, label: 'Lettre résumé', editableInWord: true });
  expect(manifest.members[1]).toMatchObject({ order: 2, role: 'enclosure', signedOriginal: true, editableInWord: false });
  expect(manifest.files.filter((file: { kind: string }) => file.kind === 'original')).toHaveLength(2);
  for (const file of manifest.files) {
    const bytes = await zip.file(file.path)!.async('uint8array');
    expect(bytes.byteLength).toBe(file.size);
    expect(await portableResourceDigest(new Uint8Array(bytes).buffer)).toBe(file.sha256);
    if (file.kind === 'original') expect(new Uint8Array(bytes)).toEqual(new Uint8Array(original));
  }
  const payloads = Object.values(zip.files).filter(file => !file.dir && !['README.txt', 'manifest.json'].includes(file.name));
  expect(manifest.measured.fileCount).toBe(payloads.length);
  expect(manifest.measured.fileBytes).toBe(manifest.files.reduce((total: number, file: { size: number }) => total + file.size, 0));
  expect(await zip.file('README.txt')!.async('string')).toContain('PDF signing fields do not become editable Word content');
  expect(Object.keys(zip.files).every(path => !path.includes('..') && !path.includes('\\'))).toBe(true);
  expect(Object.keys(zip.files).some(path => path.endsWith('.json') && path !== 'manifest.json')).toBe(false);
});

it('keeps captured Word content and original bytes through source deletion and package changes during conversion', async () => {
  const { record, main, support, original } = await fixture();
  const prepared = await prepareWordPackage(record, record.currentRevisionId, policy);
  acknowledgeWordPackage(prepared);
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const convertDocx = vi.fn(async (latex: string) => { await gate;return ports.convertDocx(latex, {}); });
  const result = renderWordPackage(prepared, { ...ports, convertDocx });
  await vi.waitFor(() => expect(convertDocx).toHaveBeenCalledOnce());
  await idbDeleteAttachment(main.draft.id);await idbDeleteAttachment(support.kind === 'original' ? support.original.id : '');
  record.name = 'New name';record.revisions[0].members = [];
  finish();
  const delivered = await result, zip = await JSZip.loadAsync(await delivered.blob.arrayBuffer());
  expect(delivered.manifest.packageName).toBe('Synthetic action');
  expect(delivered.manifest.members).toHaveLength(2);
  const docx = await JSZip.loadAsync(await zip.file(delivered.manifest.mainDocument)!.async('uint8array'));
  expect(await docx.file('word/document.xml')!.async('string')).toContain('Captured paragraph');
  const separate = delivered.manifest.files.find(file => file.kind === 'original')!;
  expect(await zip.file(separate.path)!.async('uint8array')).toEqual(new Uint8Array(original));
});

it.each(['missing', 'corrupt'] as const)('blocks claimed complete delivery for a %s saved required original', async failure => {
  const { record, support } = await fixture();
  if (support.kind !== 'original') throw new Error('Expected original');
  if (failure === 'missing') await idbDeleteAttachment(support.original.id);
  else await idbPutAttachment({ ...support.original, data: new Uint8Array(support.original.size).buffer });
  await expect(prepareWordPackage(record, record.currentRevisionId, policy)).rejects.toThrow(/Missing|corrupt/);
});

it('blocks missing declared enclosures and unreadable originals even when their stored digest matches', async () => {
  const { record } = await fixture({ enclosures: [{ title: 'Missing annex' }] });
  await expect(prepareWordPackage(record, record.currentRevisionId, policy)).rejects.toThrow('required enclosure');
  const valid = await fixture();
  const bytes = new TextEncoder().encode('not a PDF').buffer;
  const invalid: PackageMember = { id: 'invalid', revisionId: 'invalid_revision', kind: 'original', label: 'Broken PDF', role: 'enclosure', required: true, signedOriginal: false, original: await retainPackageAsset('broken.pdf', 'application/pdf', bytes) };
  valid.record.revisions[0].members.push(invalid);
  await expect(prepareWordPackage(valid.record, valid.record.currentRevisionId, policy)).rejects.toThrow();
});

it('suppresses the archive after cancellation during Word conversion and rejects a copied approval handle', async () => {
  const { record } = await fixture();
  const prepared = await prepareWordPackage(record, record.currentRevisionId, policy);
  expect(() => acknowledgeWordPackage({ ...prepared })).toThrow();
  acknowledgeWordPackage(prepared);
  let finish!: () => void;
  const convertDocx = vi.fn(async () => { await new Promise<void>(resolve => { finish = resolve; });return new Blob(['word']); });
  const controller = new AbortController(), result = renderWordPackage(prepared, { ...ports, convertDocx }, controller.signal);
  const rejected = expect(result).rejects.toThrow(/cancelled|abort/i);
  await vi.waitFor(() => expect(convertDocx).toHaveBeenCalledOnce());
  controller.abort();finish();await rejected;
  const cancelled = new AbortController();cancelled.abort();
  await expect(prepareWordPackage(record, record.currentRevisionId, policy, cancelled.signal)).rejects.toMatchObject({ name: 'AbortError' });
});

it('blocks unsupported Word formats and policy without adding format claims', async () => {
  const { record } = await fixture({ docType: 'i_type' });
  await expect(prepareWordPackage(record, record.currentRevisionId, policy)).rejects.toThrow('editable package');
  const valid = await fixture();
  await expect(prepareWordPackage(valid.record, valid.record.currentRevisionId, { status: 'not-ready', message: 'Policy loading' })).rejects.toThrow('Policy loading');
});

it('scans included names and content while leaving comments, hidden fields and old revisions outside Word delivery', async () => {
  const { record } = await fixture({ formData: { subject: 'Visible', seniorCommandName: 'SSN 222-33-4444' },
    reviewComments: { version: 1, threads: [{ id: crypto.randomUUID(), anchor: { kind: 'document' }, resolved: false, messages: [{ id: crypto.randomUUID(), author: 'Hidden reviewer', text: 'SSN 333-44-5555', createdAt: '2026-11-14T00:00:00Z' }] }] } });
  record.name = 'SSN 123-45-6789';
  const historical = structuredClone(record.revisions[0]);historical.id = 'revision_old';historical.members[0].label = 'Removed private member';historical.members[0].revisionId = 'removed_member_revision';
  record.revisions.unshift(historical);record.revisions[1].parentId = historical.id;
  const prepared = await prepareWordPackage(record, record.currentRevisionId, policy);
  expect(prepared.privacy.findings.filter(finding => finding.type === 'SSN').map(finding => finding.value)).toEqual(['123-45-6789']);
  acknowledgeWordPackage(prepared);
  const result = await renderWordPackage(prepared, ports), zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
  const text = (await Promise.all(Object.values(zip.files).filter(file => !file.dir && !file.name.endsWith('.pdf')).map(file => file.async('string')))).join('\n');
  expect(text).not.toContain('Removed private member');expect(text).not.toContain('Hidden reviewer');expect(text).not.toContain('333-44-5555');
});

it('generates extractable filenames without collapsing Unicode labels or allowing path traversal', () => {
  expect(wordPackageFilename('../../résumé.pdf')).toBe('résumé.pdf');
  expect(wordPackageFilename('folder\\CON.pdf')).toBe('_CON.pdf');
  expect(wordPackageFilename('..')).toBe('document');
  expect(wordPackageFilename('A:B?.pdf. ')).toBe('A_B_.pdf');
  expect(new TextEncoder().encode(wordPackageFilename('演習😀'.repeat(80))).byteLength).toBeLessThanOrEqual(160);
  expect(wordPackageFilename('\u202epdf.exe')).toBe('_pdf.exe');
  expect(wordPackageFilename('Training \ud800 😀')).toBe('Training _ 😀');
});

it.each(['COM¹.pdf', 'COM².pdf', 'COM³.pdf', 'LPT¹.pdf', 'LPT².pdf', 'LPT³.pdf'])('makes the Windows device filename %s extractable', name => {
  expect(wordPackageFilename(name)).toBe(`_${name}`);
});

it.each(['.pdf', '.PNG', '.jpeg', '.docx'])('preserves the %s extension when truncating a long Unicode filename', extension => {
  const name = wordPackageFilename(`${'演習😀'.repeat(20)}${extension}`);
  expect(name.endsWith(extension)).toBe(true);
  expect(new TextEncoder().encode(name).byteLength).toBeLessThanOrEqual(160);
});

it('keeps a long original filename recognizable as a PDF in the generated archive', async () => {
  const { record, original } = await fixture();
  const name = `${'演習😀'.repeat(20)}.pdf`;
  record.revisions[0].members.push(await captureOriginalPackageMember({ name, data: original }, 'supporting-document', false));
  const prepared = await prepareWordPackage(record, record.currentRevisionId, policy);acknowledgeWordPackage(prepared);
  const result = await renderWordPackage(prepared, ports);
  const file = result.manifest.files.find(file => file.name === name)!;
  expect(file.path.endsWith('.pdf')).toBe(true);
  expect(new TextEncoder().encode(file.path.split('/').at(-1)!).byteLength).toBeLessThanOrEqual(160);
  const zip = await JSZip.loadAsync(await result.blob.arrayBuffer(), { checkCRC32: true });
  expect(await zip.file(file.path)!.async('uint8array')).toEqual(new Uint8Array(original));
});

it.each(['base64', 'data-url'] as const)('retains a captured %s PNG signature in the Word document and original sidecar', async encoding => {
  const { docxImageFixture } = await import('../_helpers/docxImageFixture');
  const images = await docxImageFixture();
  const encoded = images.signature.toString('base64');
  const { record } = await fixture({ docType: 'business_letter', enclosures: [], formData: {
    subject: 'SIGNED TRAINING LETTER', sigFirst: 'Alex', sigLast: 'Example', signatureType: 'image',
    signatureImage: { name: 'signature.png', size: images.signature.length,
      data: encoding === 'data-url' ? `data:image/png;base64,${encoded}` : encoded },
  } });
  const prepared = await prepareWordPackage(record, record.currentRevisionId, policy);
  acknowledgeWordPackage(prepared);
  const convertDocx = vi.fn(ports.convertDocx);
  const delivered = await renderWordPackage(prepared, { ...ports, convertDocx });
  const zip = await JSZip.loadAsync(await delivered.blob.arrayBuffer(), { checkCRC32: true });
  const signature = delivered.manifest.files.find(file => file.purpose.startsWith('Unchanged visual signature'))!;
  expect(await zip.file(signature.path)!.async('uint8array')).toEqual(new Uint8Array(images.signature));
  expect(signature.sha256).toBe(await portableResourceDigest(new Uint8Array(images.signature).buffer));
  expect(convertDocx.mock.calls[0][1].mediaFiles?.['signature.png']).toEqual(new Uint8Array(images.signature));
});

it('serializes the normalized signature byte size before package capture without changing the source', async () => {
  const sharp = (await import('sharp')).default;
  const { docxImageFixture } = await import('../_helpers/docxImageFixture');
  const images = await docxImageFixture();
  const upload = await sharp(images.signature).jpeg().toBuffer();
  const normalized = await sharp(upload).png().toBuffer();
  expect(normalized.length).not.toBe(upload.length);
  const signatureImage = { name: 'uploaded-signature.jpg', size: upload.length, data: normalized.toString('base64') };
  const { record } = await fixture({ docType: 'business_letter', enclosures: [], formData: {
    subject: 'NORMALIZED SIGNATURE', sigFirst: 'Alex', sigLast: 'Example', signatureType: 'image', signatureImage,
  } });
  expect(signatureImage.size).toBe(upload.length);
  const prepared = await prepareWordPackage(record, record.currentRevisionId, policy);
  acknowledgeWordPackage(prepared);
  const delivered = await renderWordPackage(prepared, ports);
  const zip = await JSZip.loadAsync(await delivered.blob.arrayBuffer(), { checkCRC32: true });
  const signature = delivered.manifest.files.find(file => file.purpose.startsWith('Unchanged visual signature'))!;
  expect(signature.size).toBe(normalized.length);
  expect(await zip.file(signature.path)!.async('uint8array')).toEqual(new Uint8Array(normalized));
});

it('rejects untrusted portable paths before they can enter a Word delivery', async () => {
  const { record } = await fixture(), before = structuredClone(record);
  const json = JSON.parse(await buildPortableActionPackage(record));
  json.portableResources.entries[0].path = '../outside.pdf';
  await expect(parsePortableActionPackage(JSON.stringify(json))).rejects.toThrow('manifest');
  expect(record).toEqual(before);
});
it('blocks a corrupt figure during package capture before any Word delivery can be prepared', async () => {
  const bytes = new TextEncoder().encode('corrupt PNG').buffer;
  const fileRef = await persistAttachment({ name: 'figure.png', size: bytes.byteLength, type: 'image/png' }, bytes);
  await expect(fixture({ docType: 'business_letter', paragraphs: [{ text: 'Broken figure', level: 0, figure: { fileRef, name: 'figure.png', type: 'image/png' } }] })).rejects.toThrow(/PNG/);
});
it('uses captured original PDF text for the shared marking policy and privacy review', async () => {
  const pdfText = await import('@/lib/pdfText');
  const scan = vi.spyOn(pdfText, 'extractPdfText').mockResolvedValue('SSN 123-45-6789');
  try {
    const { record, original } = await fixture();
    const prepared = await prepareWordPackage(record, record.currentRevisionId, policy);
    expect(scan).toHaveBeenCalledTimes(2);
    for (const [bytes] of scan.mock.calls) expect(new Uint8Array(bytes)).toEqual(new Uint8Array(original));
    expect(prepared.privacy.findings.some(finding => finding.type === 'SSN' && finding.value === '123-45-6789')).toBe(true);
    expect(prepared.reviews.some(entry => entry.member === 'CON.pdf')).toBe(true);
    scan.mockResolvedValue('SECRET');
    await expect(prepareWordPackage(record, record.currentRevisionId, policy)).rejects.toThrow('outside this deployment');
  } finally { scan.mockRestore(); }
});

it('keeps case-insensitive and sanitized filename collisions in distinct ordered archive paths', async () => {
  const bytes = await pdf();
  const { record } = await fixture({ enclosures: [
    { title: 'First annex', file: { name: '../../same:name.pdf', size: bytes.byteLength, data: bytes } },
    { title: 'Second annex', file: { name: 'same?name.pdf', size: bytes.byteLength, data: bytes } },
  ] });
  record.revisions[0].members.push(await captureOriginalPackageMember({ name: 'con.PDF', data: bytes }, 'supporting-document', false));
  record.revisions[0].members.push(await captureOriginalPackageMember({ name: 'COM¹.pdf', data: bytes }, 'supporting-document', false));
  const prepared = await prepareWordPackage(record, record.currentRevisionId, policy);acknowledgeWordPackage(prepared);
  const result = await renderWordPackage(prepared, ports), paths = result.manifest.files.map(file => file.path);
  expect(new Set(paths.map(path => path.toLowerCase())).size).toBe(paths.length);
  expect(paths).toContain('members/001/original/enclosure-001-same_name.pdf');
  expect(paths).toContain('members/001/original/enclosure-002-same_name.pdf');
  expect(paths).toContain('members/002/original/_CON.pdf');expect(paths).toContain('members/003/original/_con.PDF');
  expect(paths).toContain('members/004/original/_COM¹.pdf');
  expect(result.manifest.members.map(member => member.order)).toEqual([1, 2, 3, 4]);
});

it('checks emitted native text against deployment policy before Word package approval', async () => {
  const { record } = await fixture({ formData: { subject: 'Visible training letter', classLevel: 'unclassified' },
    paragraphs: [{ text: 'SECRET', level: 0 }] });
  await expect(prepareWordPackage(record, record.currentRevisionId, policy)).rejects.toThrow(/outside this deployment/);
});

it('rejects native PDF figures at Word review with raster guidance while preserving the editable source', async () => {
  const { record, main, original } = await fixture({ docType: 'business_letter', enclosures: [] });
  const figure = await persistAttachment({ name: 'drawing.pdf', type: 'application/pdf', size: original.byteLength }, original);
  const draft = await buildDraftFileFromSnapshot({ ...prepareSessionState(main.session, true), paragraphs: [{ text: 'Original vector drawing', level: 0,
    figure: { name: 'drawing.pdf', type: 'application/pdf', fileRef: figure } }] }, main.source!.capturedAt);
  main.session = parseDraftFile(draft, false, true).session;
  main.draft = await retainPackageAsset('native-pdf-figure.json', 'application/json', new TextEncoder().encode(JSON.stringify(draft)).buffer);
  const before = structuredClone(record);
  await expect(prepareWordPackage(record, record.currentRevisionId, policy)).rejects.toThrow(/PDF figures.*PNG\/JPEG.*editable package/);
  expect(record).toEqual(before);
});

it('keeps hidden native markings outside Word policy review and accepts permitted emitted markings', async () => {
  const { record } = await fixture({ formData: { subject: 'Visible training letter', classLevel: 'unclassified', seniorCommandName: 'SECRET' },
    reviewComments: { version: 1, threads: [{ id: crypto.randomUUID(), anchor: { kind: 'document' }, resolved: false,
      messages: [{ id: crypto.randomUUID(), author: 'Hidden reviewer', text: 'SECRET', createdAt: '2026-11-14T00:00:00Z' }] }] } });
  const prepared = await prepareWordPackage(record, record.currentRevisionId, policy);acknowledgeWordPackage(prepared);
  const result = await renderWordPackage(prepared, ports), archive = await JSZip.loadAsync(await result.blob.arrayBuffer());
  const docx = await JSZip.loadAsync(await archive.file(result.manifest.mainDocument)!.async('uint8array'));
  expect(await docx.file('word/document.xml')!.async('string')).not.toContain('SECRET');
  const marked = await fixture({ formData: { subject: 'SECRET', classLevel: 'secret' } });
  const allowed = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: { maxLevel: 'secret',
    allowedLevels: ['unclassified', 'cui', 'confidential', 'secret'] }, runtime: { status: 'absent' } });
  await expect(prepareWordPackage(marked.record, marked.record.currentRevisionId, allowed)).resolves.toMatchObject({ revisionId: marked.record.currentRevisionId });
});

it('keeps every generated manifest path resolvable after ZIP encoding of malformed Unicode labels', async () => {
  const { record, main } = await fixture();main.label = 'Training \ud800 letter';record.name = 'Training \udfff action';
  const prepared = await prepareWordPackage(record, record.currentRevisionId, policy);acknowledgeWordPackage(prepared);
  const result = await renderWordPackage(prepared, ports), zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  for (const file of manifest.files) expect(zip.file(file.path), file.path).not.toBeNull();
  expect(zip.file(manifest.mainDocument)).not.toBeNull();
});

it('omits retained inactive figure originals from clean Word delivery', async () => {
  const { docxImageFixture } = await import('../_helpers/docxImageFixture');const images = await docxImageFixture();
  const fileRef = await persistAttachment({ name: 'SSN 123-45-6789.png', type: 'image/png', size: images.figure.length }, new Uint8Array(images.figure).buffer);
  const { record } = await fixture({ docType: 'naval_letter', paragraphs: [{ text: 'Ordinary body text.', level: 0,
    figure: { name: 'SSN 123-45-6789.png', type: 'image/png', fileRef } }] });
  const before = structuredClone(record), prepared = await prepareWordPackage(record, record.currentRevisionId, policy);
  expect(prepared.privacy.found).toBe(false);acknowledgeWordPackage(prepared);
  const result = await renderWordPackage(prepared, ports), zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
  expect(result.manifest.files.some(file => file.name === 'SSN 123-45-6789.png')).toBe(false);
  expect(Object.keys(zip.files).some(path => path.includes('figure-'))).toBe(false);
  expect(record).toEqual(before);
});

it.each(['attached', 'missing'] as const)('omits %s inactive enclosure sidecars without blocking or disclosing them', async kind => {
  const original = await pdf();
  const { record } = await fixture({ documentMode: 'compliant', docType: 'business_letter', enclosures: [{ title: 'Inactive retained annex',
    ...(kind === 'attached' ? { file: { name: 'SSN 123-45-6789.pdf', size: original.byteLength, data: original } } : {}) }] });
  const before = structuredClone(record), prepared = await prepareWordPackage(record, record.currentRevisionId, policy);
  expect(prepared.privacy.found).toBe(false);acknowledgeWordPackage(prepared);
  const result = await renderWordPackage(prepared, ports), zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
  expect(result.manifest.files.filter(file => file.kind === 'original').map(file => file.name)).toEqual(['CON.pdf']);
  expect(Object.keys(zip.files).some(path => path.includes('enclosure-'))).toBe(false);
  expect(record).toEqual(before);
});

it.each([7, 9])('counts all %i original occurrences against the expanded Word budget before approval', async count => {
  const { record, main, support } = await fixture({ enclosures: [] });
  if (support.kind !== 'original') throw new Error('Expected original');
  record.revisions[0].members = [main, ...Array.from({ length: count }, (_, index) => ({
    ...structuredClone(support), id: `repeated_original_${index}`, revisionId: `repeated_revision_${index}`,
  }))];
  const before = structuredClone(record), parse = packageTransfer.parsePortableActionPackage;
  const boundary = vi.spyOn(packageTransfer, 'parsePortableActionPackage').mockImplementation(async json => {
    const captured = await parse(json);
    // Validate real shared-resource input first, then model 25 MiB decoded pages
    // without allocating hundreds of MiB in the rejection control.
    const data = captured.resources.get(`assets/${support.original.id}`)!.data;
    Object.defineProperty(data, 'byteLength', { value: MAX_WORD_PACKAGE_BYTES / 8 });
    return captured;
  });
  try {
    if (count > 8) await expect(prepareWordPackage(record, record.currentRevisionId, policy)).rejects.toThrow(/200 MB/);
    else await expect(prepareWordPackage(record, record.currentRevisionId, policy)).resolves.toMatchObject({ revisionId: record.currentRevisionId });
    expect(boundary).toHaveBeenCalledOnce();expect(record).toEqual(before);
  } finally { boundary.mockRestore(); }
});

it('includes rendered DOCX bytes with originals in the cumulative delivery budget', async () => {
  const { record, main, support } = await fixture({ enclosures: [] });
  record.revisions[0].members = [...Array.from({ length: 9 }, (_, index) => ({
    ...structuredClone(main), id: `word_member_${index}`, revisionId: `word_revision_${index}`,
    role: index === 0 ? 'basic-letter' as const : 'supporting-document' as const,
  })), support];
  const prepared = await prepareWordPackage(record, record.currentRevisionId, policy);acknowledgeWordPackage(prepared);
  const convertDocx = vi.fn(async (...args: Parameters<typeof ports.convertDocx>) => {
    const blob = await ports.convertDocx(...args);
    // Exercise real rendering/assembly with a 25 MiB size model and tiny bytes.
    Object.defineProperty(blob, 'size', { value: MAX_WORD_DOCUMENT_BYTES });
    return blob;
  });
  await expect(renderWordPackage(prepared, { ...ports, convertDocx })).rejects.toThrow(/200 MB/);
  expect(convertDocx).toHaveBeenCalledTimes(8);
});
