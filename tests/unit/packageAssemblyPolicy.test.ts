import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createBlankSession } from '@/stores/documentStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { captureOriginalPackageMember, capturePackageMember } from '@/lib/actionPackageAssets';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage } from '@/lib/actionPackages';
import { preparePackageAssembly, assemblePackage } from '@/lib/actionPackageAssembly';
import { resolveExportDeploymentPolicy, type PolicyResolution } from '@/lib/exportDeploymentPolicy';
import { idbGetAllAttachments } from '@/lib/documentsDb';
import { extractPdfText } from '@/lib/pdfText';
import * as classification from '@/config/classification';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('react-pdf', async () => ({ pdfjs: await import('pdfjs-dist/legacy/build/pdf.mjs') }));
vi.mock('@/components/pdf/pdfConfig', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
  return { HARDENED_PDF_OPTIONS: { isEvalSupported: false, useSystemFonts: true } };
});
const secret = resolveExportDeploymentPolicy({ hostname: 'test.smil.mil', environment: null, runtime: { status: 'absent' } });
const unclassified = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
let currentPolicy: PolicyResolution = secret;
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: async () => currentPolicy, getExportDeploymentPolicySync: () => currentPolicy }));
beforeAll(() => { Object.assign(globalThis, { DOMMatrix, ImageData, Path2D }); });
beforeEach(() => { currentPolicy = secret; });
async function markedPdf() {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText('SECRET\nSYNTHETIC TEST CONTENT\nSECRET', { x: 54, y: 700, size: 12, font });
  const bytes = new Uint8Array(await pdf.save()).buffer;
  expect(await extractPdfText(bytes.slice(0))).toContain('SECRET'); return bytes;
}
it('rechecks deployment before assembling a previously reviewed marked PDF', async () => {
  const member = await captureOriginalPackageMember({ name: 'Synthetic marked.pdf', data: await markedPdf() }, 'basic-letter', false);
  const record = await reviseActionPackage(await createActionPackage(`Marked original ${crypto.randomUUID()}`), [member]);
  const prepared = await preparePackageAssembly(record, record.currentRevisionId, secret);
  expect(prepared.readiness.findings.filter(finding => finding.severity === 'error')).toEqual([]);
  currentPolicy = unclassified;
  await expect(assemblePackage(prepared, { compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true })).rejects.toThrow(/policy|deployment|settings/i);
  expect(getPackageRevision((await listActionPackages()).find(value => value.id === record.id)!).outputs).toEqual([]);
});
it('rechecks deployment after an actual marked PDF render and before persisting output', async () => {
  const base = createBlankSession(), bytes = await markedPdf();
  const snapshot = { ...base, endItems: [], publicationTables: {}, formData: { ...base.formData, classLevel: 'secret' as const, subject: 'SYNTHETIC MARKED TEST', from: 'Training Office', to: 'Training Director', sigLast: 'Example', unitLine1: 'FICTIONAL UNIT', date: '17 Nov 26' }, paragraphs: [{ id: 'synthetic', text: 'Synthetic test content.', level: 0 }] };
  const member = await capturePackageMember(captureDocumentRevision({ documentId: 'synthetic-marked', epoch: 0, editSequence: 0, capturedAt: 1 }, snapshot), 'Marked native', 'basic-letter');
  const record = await reviseActionPackage(await createActionPackage(`Marked native ${crypto.randomUUID()}`), [member]);
  const prepared = await preparePackageAssembly(record, record.currentRevisionId, secret), attachments = await idbGetAllAttachments();
  expect(prepared.readiness.findings.filter(finding => finding.severity === 'error')).toEqual([]);
  await expect(assemblePackage(prepared, { compile: async () => { currentPolicy = unclassified; return new Uint8Array(bytes); }, convertDocx: vi.fn(), waitForReady: async () => true })).rejects.toThrow(/policy|deployment|settings/i);
  expect(getPackageRevision((await listActionPackages()).find(value => value.id === record.id)!).outputs).toEqual([]);
  expect((await idbGetAllAttachments())?.length).toBe(attachments?.length);
});

it('keeps the final synchronous policy guard inside the package compare-and-swap transaction', async () => {
  const member = await captureOriginalPackageMember({ name: 'Marked CAS.pdf', data: await markedPdf() }, 'basic-letter', false);
  const record = await reviseActionPackage(await createActionPackage(`Marked CAS ${crypto.randomUUID()}`), [member]);
  const prepared = await preparePackageAssembly(record, record.currentRevisionId, secret);
  let checks = 0;
  const guard = vi.spyOn(classification, 'getExportDeploymentPolicySync').mockImplementation(() => {
    if (++checks === 4) currentPolicy = unclassified;
    return currentPolicy;
  });
  try {
    await expect(assemblePackage(prepared, { compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true })).rejects.toThrow(/package changed/);
    expect(checks).toBe(4);
    expect(getPackageRevision((await listActionPackages()).find(value => value.id === record.id)!).outputs).toEqual([]);
  } finally { guard.mockRestore(); }
});
