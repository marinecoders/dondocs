import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { capturePackageMember, captureOriginalPackageMember, retainPackageAsset } from '@/lib/actionPackageAssets';
import { type ActionPackage, type PackageMember } from '@/lib/actionPackages';
import { buildPortableActionPackage, parsePortableActionPackage } from '@/lib/actionPackageTransfer';
import { persistAttachment } from '@/lib/attachments';
import { idbDeleteAttachment, idbPutAttachment } from '@/lib/documentsDb';
import { portableResourceDigest } from '@/lib/portableResources';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { acknowledgeWordPackage, prepareWordPackage, renderWordPackage, wordPackageFilename } from '@/services/exports/wordPackage';
import type { DocumentSnapshot } from '@/stores/historyStore';
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
  const prepared = await prepareWordPackage(record, record.currentRevisionId, policy);acknowledgeWordPackage(prepared);
  const result = await renderWordPackage(prepared, ports), paths = result.manifest.files.map(file => file.path);
  expect(new Set(paths.map(path => path.toLowerCase())).size).toBe(paths.length);
  expect(paths).toContain('members/001/original/enclosure-001-same_name.pdf');
  expect(paths).toContain('members/001/original/enclosure-002-same_name.pdf');
  expect(paths).toContain('members/002/original/_CON.pdf');expect(paths).toContain('members/003/original/_con.PDF');
  expect(result.manifest.members.map(member => member.order)).toEqual([1, 2, 3]);
});
