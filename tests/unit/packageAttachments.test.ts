import 'fake-indexeddb/auto';
import { preparePackageDelivery, copyPreparedPackageDeliveryProjection, readPreparedPackageDeliveryAsset } from '@/lib/packageDelivery';
import { beforeEach, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { WORD_IMAGE } from '../_helpers/wordImportFixture';
import { actionPackageSchema, createActionPackage, getPackageRevision, listActionPackages, packageAssets, renameActionPackage, reviseActionPackage } from '@/lib/actionPackages';
import { captureOriginalPackageMember, readPackageAsset } from '@/lib/actionPackageAssets';
import { preparePackageAttachment, applyPreparedPackageAttachment } from '@/lib/packageAttachments';
import { inspectPackageAttachment, renderPackageAttachment } from '@/lib/packageAttachmentCapabilities';
import { buildPortableActionPackage, parsePortableActionPackage } from '@/lib/actionPackageTransfer';
import { preparePackageAssembly, assemblePackage } from '@/lib/actionPackageAssembly';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as classification from '@/config/classification';
import { useUIStore } from '@/stores/uiStore';
import { idbGetAllAttachments } from '@/lib/documentsDb';
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
const file = (text = 'Synthetic supporting evidence', name = 'evidence.txt') => ({ name, data: new TextEncoder().encode(text).buffer });
beforeEach(() => {
  vi.restoreAllMocks(); useUIStore.setState({ storageHealth: 'ok' });
  vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy);
  vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy);
});
async function packageWithPdf() {
  const pdf = await PDFDocument.create(); pdf.addPage([612, 792]);
  return reviseActionPackage(await createActionPackage(`Supporting ${crypto.randomUUID()}`), [await captureOriginalPackageMember({ name: 'Synthetic main.pdf', data: new Uint8Array(await pdf.save()).buffer }, 'basic-letter', false)]);
}
it('adds reviewed preserved bytes in a new child revision and portable resources', async () => {
  const before = await packageWithPdf(), incoming = file(), prepared = await preparePackageAttachment(before, incoming, policy);
  new Uint8Array(incoming.data).fill(32);
  const record = await applyPreparedPackageAttachment(prepared, policy, true), revision = getPackageRevision(record), member = revision.members.at(-1)!;
  expect(member).toMatchObject({ kind: 'attachment', role: 'supporting-document', signedOriginal: false });
  if (member.kind !== 'attachment') throw new Error('Expected attachment');
  expect(new TextDecoder().decode(await readPackageAsset(member.original))).toBe('Synthetic supporting evidence');
  expect(record.revisions.slice(0, -1)).toEqual(before.revisions); expect(revision.parentId).toBe(before.currentRevisionId);
  expect(packageAssets(record)).toContainEqual(member.original);
  const portable = await parsePortableActionPackage(await buildPortableActionPackage(record));
  expect(portable.record.revisions[0].members.at(-1)).toEqual(member);
});
it('uses qualified text conversion in real assembly and preserves source text', async () => {
  const record = await applyPreparedPackageAttachment(await preparePackageAttachment(await packageWithPdf(), file('First line\nSecond line'), policy), policy, true);
  const prepared = await preparePackageAssembly(record, record.currentRevisionId, policy);
  expect(prepared.readiness.state).toBe('ready');
  const retained = await assemblePackage(prepared, { compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true });
  const output = getPackageRevision(retained).outputs[0];
  expect((await PDFDocument.load(await readPackageAsset(output.asset))).getPageCount()).toBe(2);
  expect(output.boundaries.map(item => item.pageCount)).toEqual([1, 1]);
});
it('keeps CSV evidence portable while honestly blocking unsupported PDF conversion', async () => {
  const record = await applyPreparedPackageAttachment(await preparePackageAttachment(await packageWithPdf(), file('Name,Unit\nAlex Example,Fictional unit', 'evidence.csv'), policy), policy, true);
  const pdf = await preparePackageAssembly(record, record.currentRevisionId, policy), portable = await preparePackageAssembly(record, record.currentRevisionId, policy, { includeRetainedDraftText: true });
  expect(pdf.readiness.findings.some(item => item.severity === 'error' && item.message.includes('no qualified PDF conversion'))).toBe(true);
  expect(portable.readiness.findings.filter(item => item.severity === 'error')).toEqual([]);
  const member = getPackageRevision(record).members.at(-1)!;
  if (member.kind !== 'attachment') throw new Error('Expected attachment');
  await expect(renderPackageAttachment(member.original, await readPackageAsset(member.original))).rejects.toThrow('no qualified');
});
it('requires acknowledgement, an owning package, source freshness and actual parent CAS', async () => {
  const before = await packageWithPdf(), prepared = await preparePackageAttachment(before, file(), policy);
  await expect(applyPreparedPackageAttachment(prepared, policy, false)).rejects.toThrow('Review the exact');
  await expect(applyPreparedPackageAttachment(prepared, policy, true, undefined, () => false)).rejects.toThrow('no longer current');
  await expect(preparePackageAttachment({ ...before, archived: true }, file(), policy)).rejects.toThrow('owning package');
  const assets = await idbGetAllAttachments();
  const current = await renameActionPackage(before, 'Changed owning package');
  await expect(applyPreparedPackageAttachment(prepared, policy, true)).rejects.toThrow();
  expect((await listActionPackages()).find(item => item.id === before.id)).toEqual(current);
  expect(await idbGetAllAttachments()).toEqual(assets);
});
it('preserves prior package when aborted or policy becomes stricter after preparation', async () => {
  const before = await packageWithPdf(), prepared = await preparePackageAttachment(before, file(), policy), controller = new AbortController(); controller.abort();
  await expect(applyPreparedPackageAttachment(prepared, policy, true, controller.signal)).rejects.toThrow();
  vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue({ status: 'not-ready', message: 'Deployment changed' });
  await expect(applyPreparedPackageAttachment(prepared, policy, true)).rejects.toThrow('no longer current');
  expect((await listActionPackages()).find(item => item.id === before.id)).toEqual(before);
});
it('rejects forged prepared values, executable extensions, incompatible MIME, malformed bytes and invalid roles', async () => {
  const before = await packageWithPdf(), prepared = await preparePackageAttachment(before, file(), policy);
  await expect(applyPreparedPackageAttachment({ ...prepared }, policy, true)).rejects.toThrow('Prepare');
  await expect(inspectPackageAttachment(file('<script/>', 'evidence.html'))).rejects.toThrow('Supported evidence');
  await expect(inspectPackageAttachment({ ...file(), type: 'image/png' })).rejects.toThrow('does not match');
  await expect(inspectPackageAttachment(file('not a PNG', 'evidence.png'))).rejects.toThrow();
  const saved = await applyPreparedPackageAttachment(prepared, policy, true), forged = structuredClone(saved);
  forged.revisions.at(-1)!.members.at(-1)!.role = 'basic-letter';
  expect(actionPackageSchema.safeParse(forged).success).toBe(false);
});
it('reviews all retained lines before persisting and refuses marked supporting text', async () => {
  const before = await packageWithPdf();
  await expect(preparePackageAttachment(before, file('Synthetic opening\nSECRET\nRetained text'), policy)).rejects.toThrow();
  expect((await listActionPackages()).find(item => item.id === before.id)).toEqual(before);
});
it('preserves unsupported Unicode text without claiming PDF coverage', async () => {
  const inspection = await inspectPackageAttachment(file('Synthetic multilingual: 日本語'));
  expect(inspection.text).toContain('日本語'); expect(inspection.canRenderPdf).toBe(false);
});
it('inventories hidden Office XML, rejects active embeddings, and bounds archive inspection', async () => {
  const zip = new JSZip(); zip.file('[Content_Types].xml', '<Types/>'); zip.file('word/document.xml', '<document><p>Synthetic visible text</p></document>');
  zip.file('word/comments.xml', '<comments><text>Retained comment text</text></comments>');
  const bytes = await zip.generateAsync({ type: 'arraybuffer' }), inspection = await inspectPackageAttachment({ name: 'evidence.docx', data: bytes });
  expect(inspection.canRenderPdf).toBe(false); expect(inspection.text).toContain('Retained comment text');
  zip.file('word/embeddings/oleObject.bin', 'opaque');
  await expect(inspectPackageAttachment({ name: 'evidence.docx', data: await zip.generateAsync({ type: 'arraybuffer' }) })).rejects.toThrow('embedded files');
  await expect(inspectPackageAttachment({ name: 'evidence.xlsx', data: bytes })).rejects.toThrow('valid XLSX');
});

it('validates complete image bytes, renders a real PDF derivative and preserves the exact image', async () => {
  const bytes = Uint8Array.from(atob(WORD_IMAGE), character => character.charCodeAt(0)).buffer;
  const prepared = await preparePackageAttachment(await packageWithPdf(), { name: 'synthetic.png', type: 'image/png', data: bytes }, policy);
  expect(prepared.canRenderPdf).toBe(true);
  const record = await applyPreparedPackageAttachment(prepared, policy, true), member = getPackageRevision(record).members.at(-1)!;
  if (member.kind !== 'attachment') throw new Error('Expected attachment');
  expect(await readPackageAsset(member.original)).toEqual(bytes);
  expect((await PDFDocument.load(await renderPackageAttachment(member.original, bytes))).getPageCount()).toBe(1);
});

it.each(['recipient', 'editable'] as const)('preserves selected evidence through a private %s delivery projection', async purpose => {
  const original = await applyPreparedPackageAttachment(await preparePackageAttachment(await packageWithPdf(), file('Exact scoped evidence', 'evidence.csv'), policy), policy, true);
  const selected = getPackageRevision(original).members.at(-1)!;
  const prepared = await preparePackageDelivery(original, original.currentRevisionId, { label: 'Evidence only', purpose, memberIds: [selected.id] }, policy);
  const scoped = copyPreparedPackageDeliveryProjection(prepared), revision = getPackageRevision(scoped), included = revision.members[0];
  expect(revision.members).toHaveLength(1); expect(included.kind).toBe('attachment'); expect(scoped.reviewRounds).toBeUndefined();
  if (included.kind !== 'attachment') throw new Error('Expected original-format evidence');
  expect(new TextDecoder().decode(await readPreparedPackageDeliveryAsset(prepared, included.original))).toBe('Exact scoped evidence');
  expect(included.original.type).toBe('text/csv');
  const excluded = getPackageRevision(original).members[0]; if (excluded.kind === 'native') throw new Error('Expected original PDF');
  await expect(readPreparedPackageDeliveryAsset(prepared, excluded.original)).rejects.toThrow('outside');
});
it('rejects renamed Office macro and active-content parts declared by their package types', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types><Override PartName="/word/renamed.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>');
  zip.file('word/document.xml', '<document><p>Synthetic main document.</p></document>');
  zip.file('word/renamed.bin', 'Synthetic inert macro fixture.');
  await expect(inspectPackageAttachment({ name: 'renamed.docx', data: await zip.generateAsync({ type: 'arraybuffer' }) })).rejects.toThrow(/macros|active|unsupported/);
});
it('includes XML parts declared under non-XML names in retained-content policy checks', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/hidden.bin" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>');
  zip.file('word/document.xml', '<document><p>Synthetic visible main text.</p></document>');
  zip.file('word/hidden.bin', '<comments><text>(S) Restricted synthetic retained comment.</text></comments>');
  const incoming = { name: 'retained.docx', data: await zip.generateAsync({ type: 'arraybuffer' }) };
  expect((await inspectPackageAttachment(incoming)).text).toContain('(S) Restricted synthetic retained comment.');
  await expect(preparePackageAttachment(await packageWithPdf(), incoming, policy)).rejects.toThrow(/markings|levels/);
});
it('joins split Word runs within each retained paragraph before checking markings', async () => {
  const zip = new JSZip(); zip.file('[Content_Types].xml', '<Types/>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Unclassified synthetic opening.</w:t></w:r></w:p><w:p><w:r><w:t>(</w:t></w:r><w:r><w:t>S</w:t></w:r><w:r><w:t>) Restricted synthetic paragraph.</w:t></w:r></w:p></w:body></w:document>');
  const incoming = { name: 'split-runs.docx', data: await zip.generateAsync({ type: 'arraybuffer' }) };
  expect((await inspectPackageAttachment(incoming)).text).toContain('(S) Restricted synthetic paragraph.');
  await expect(preparePackageAttachment(await packageWithPdf(), incoming, policy)).rejects.toThrow(/markings|levels/);
});

it.each(['shared', 'inline'] as const)('joins %s spreadsheet rich-text runs before checking retained markings', async kind => {
  const zip = new JSZip(), namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('xl/workbook.xml', `<workbook xmlns="${namespace}"/>`);
  const runs = '<r><t>(</t></r><r><t>S</t></r><r><t>) Restricted synthetic evidence.</t></r>';
  if (kind === 'shared') zip.file('xl/sharedStrings.xml', `<sst xmlns="${namespace}"><si>${runs}</si></sst>`);
  else zip.file('xl/worksheets/sheet1.xml', `<worksheet xmlns="${namespace}"><sheetData><row><c t="inlineStr"><is>${runs}</is></c></row></sheetData></worksheet>`);
  const incoming = { name: 'split-runs.xlsx', data: await zip.generateAsync({ type: 'arraybuffer' }) };
  expect((await inspectPackageAttachment(incoming)).text).toContain('(S) Restricted synthetic evidence.');
  await expect(preparePackageAttachment(await packageWithPdf(), incoming, policy)).rejects.toThrow(/markings|levels/);
});

it('joins retained DrawingML chart runs before checking spreadsheet markings', async () => {
  const zip = new JSZip(); zip.file('[Content_Types].xml', '<Types/>');
  zip.file('xl/workbook.xml', '<workbook/>');
  zip.file('xl/drawings/drawing1.xml', '<a:txBody xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>(</a:t></a:r><a:r><a:t>S</a:t></a:r><a:r><a:t>) Restricted synthetic chart.</a:t></a:r></a:p></a:txBody>');
  const incoming = { name: 'chart-runs.xlsx', data: await zip.generateAsync({ type: 'arraybuffer' }) };
  expect((await inspectPackageAttachment(incoming)).text).toContain('(S) Restricted synthetic chart.');
  await expect(preparePackageAttachment(await packageWithPdf(), incoming, policy)).rejects.toThrow(/markings|levels/);
});
