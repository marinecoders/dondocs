import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { captureOriginalPackageMember } from '@/lib/actionPackageAssets';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage } from '@/lib/actionPackages';
import { preparePackageAssembly } from '@/lib/actionPackageAssembly';
import { updatePackageInformation } from '@/lib/packageInformation';
import { preparePackageUpdate, applyPreparedPackageUpdate, undoPackageUpdate } from '@/lib/packageUpdates';
import { preparePackageScan, preparePackageScanCorrection, savePreparedPackageScan, reviewPackageScanSources } from '@/lib/packageScans';
import { resolveExportDeploymentPolicy, type PolicyResolution } from '@/lib/exportDeploymentPolicy';
import { extractPdfText } from '@/lib/pdfText';
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('react-pdf', async () => ({ pdfjs: await import('pdfjs-dist/legacy/build/pdf.mjs') }));
vi.mock('@/components/pdf/pdfConfig', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
  return { HARDENED_PDF_OPTIONS: { isEvalSupported: false, useSystemFonts: true } };
});
vi.mock('@/lib/scannedImport', () => ({ recognizeScannedFile: vi.fn(async () => [{ page: 1, text: 'Synthetic recognized words without the source banner.', confidence: 90 }]) }));
const secret = resolveExportDeploymentPolicy({ hostname: 'test.smil.mil', environment: null, runtime: { status: 'absent' } });
const unclassified = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
let currentPolicy: PolicyResolution = secret;
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: async () => currentPolicy, getExportDeploymentPolicySync: () => currentPolicy }));
beforeAll(() => { Object.assign(globalThis, { DOMMatrix, ImageData, Path2D }); });
beforeEach(() => { currentPolicy = secret; });
it('reviews retained scan source bytes even after the source member leaves the selected revision', async () => {
  const document = await PDFDocument.create(), font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([612, 792]).drawText('SECRET\nSYNTHETIC SOURCE TEST ONLY\nSECRET', { x: 54, y: 700, font, size: 12 });
  const bytes = new Uint8Array(await document.save()).buffer;
  expect(await extractPdfText(bytes.slice(0))).toContain('SECRET');
  const source = await captureOriginalPackageMember({ name: 'Captured scan.pdf', data: bytes }, 'basic-letter', false);
  let record = await reviseActionPackage(await createActionPackage(`Retained scan ${crypto.randomUUID()}`), [source]);
  const scan = await preparePackageScan(record, source.id, secret);
  record = await savePreparedPackageScan(await preparePackageScanCorrection(scan, scan.scan.pages.map(page => page.text), secret), secret, true);
  const replacement = await PDFDocument.create(); replacement.addPage([612, 792]);
  const next = await captureOriginalPackageMember({ name: 'Current public.pdf', data: new Uint8Array(await replacement.save()).buffer }, 'basic-letter', false);
  if (next.kind !== 'original') throw new Error('Expected a preserved PDF member.');
  record = await reviseActionPackage(record, [next]); currentPolicy = unclassified;
  expect(getPackageRevision(record).scans!.items[0].source.sha256).not.toBe(next.original.sha256);
  const portable = await preparePackageAssembly(record, record.currentRevisionId, unclassified, { includeRetainedDraftText: true });
  expect(portable.readiness.findings).toContainEqual(expect.objectContaining({ severity: 'error', message: expect.stringContaining('configured levels') }));
});


for (const restricted of [true, false]) it(`${restricted ? 'rejects restricted' : 'permits public'} removed scan source bytes during a full-revision shared-value Undo`, async () => {
  const document = await PDFDocument.create(), font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([612, 792]).drawText(`${restricted ? 'SECRET' : 'PUBLIC'}\nSYNTHETIC UNDO SOURCE ONLY\n${restricted ? 'SECRET' : 'PUBLIC'}`, { x: 54, y: 700, font, size: 12 });
  const bytes = new Uint8Array(await document.save()).buffer;
  expect(await extractPdfText(bytes.slice(0))).toContain(restricted ? 'SECRET' : 'PUBLIC');
  const source = await captureOriginalPackageMember({ name: 'Retained old source.pdf', data: bytes }, 'basic-letter', false);
  let record = await reviseActionPackage(await createActionPackage(`Retained Undo scan ${crypto.randomUUID()}`), [source]);
  const scan = await preparePackageScan(record, source.id, secret);
  record = await savePreparedPackageScan(await preparePackageScanCorrection(scan, scan.scan.pages.map(page => page.text), secret), secret, true);
  const publicDocument = await PDFDocument.create(); publicDocument.addPage([612, 792]);
  const current = await captureOriginalPackageMember({ name: 'Current public source.pdf', data: new Uint8Array(await publicDocument.save()).buffer }, 'basic-letter', false);
  record = await updatePackageInformation(await reviseActionPackage(record, [current]), { version: 1, participants: [], facts: [
    { id: 'public', label: 'Public value', kind: 'text', value: 'Before', source: { kind: 'entered' } }] });
  const information = structuredClone(getPackageRevision(record).information!); information.facts[0].value = 'After';
  const applied = await applyPreparedPackageUpdate(await preparePackageUpdate(record, information, undefined, {}, secret), secret, true);
  currentPolicy = unclassified;
  if (restricted) {
    await expect(undoPackageUpdate(applied.undo, unclassified)).rejects.toThrow('configured levels');
    expect((await listActionPackages()).find(item => item.id === applied.record.id)).toEqual(applied.record);
  } else {
    const restored = await undoPackageUpdate(applied.undo, unclassified), revision = getPackageRevision(restored);
    expect(revision.information).toEqual(getPackageRevision(record).information);
    expect(revision.scans).toEqual(getPackageRevision(record).scans);
    expect(revision.members).toEqual(getPackageRevision(record).members);
    expect(revision.parentId).toBe(applied.record.currentRevisionId);
  }
});


it('authenticates supplied scan bytes, validates every page count, and rejects cancellation before source review', async () => {
  const document = await PDFDocument.create(); document.addPage([612, 792]);
  const bytes = new Uint8Array(await document.save()).buffer;
  const source = await captureOriginalPackageMember({ name: 'Public source geometry.pdf', data: bytes }, 'basic-letter', false);
  const record = await reviseActionPackage(await createActionPackage(`Source geometry ${crypto.randomUUID()}`), [source]);
  const prepared = await preparePackageScan(record, source.id, secret), scan = prepared.scan;
  const wrong = bytes.slice(0); new Uint8Array(wrong)[0] ^= 1;
  await expect(reviewPackageScanSources({ version: 1, items: [scan] }, secret, { readAsset: async () => wrong })).rejects.toThrow('captured bytes');
  const alteredPages = { ...structuredClone(scan), pages: [...scan.pages, { ...scan.pages[0], page: 2 }] };
  await expect(reviewPackageScanSources({ version: 1, items: [alteredPages] }, secret, { readAsset: async () => bytes })).rejects.toThrow('pages do not match');
  const conflicting = { ...alteredPages, id: 'different-scan-id' };
  await expect(reviewPackageScanSources({ version: 1, items: [scan, conflicting] }, secret, { readAsset: async () => bytes })).rejects.toThrow('page count');
  const controller = new AbortController(), reviewOriginal = vi.fn();
  await expect(reviewPackageScanSources({ version: 1, items: [scan] }, secret, { signal: controller.signal, reviewOriginal,
    readAsset: async () => { controller.abort(); return bytes; } })).rejects.toThrow();
  expect(reviewOriginal).not.toHaveBeenCalled();
});
