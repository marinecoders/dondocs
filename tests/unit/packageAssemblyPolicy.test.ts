import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createBlankSession } from '@/stores/documentStore';
import { composeBasicLetterId } from '@/lib/endorsement';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { captureOriginalPackageMember, capturePackageMember } from '@/lib/actionPackageAssets';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage } from '@/lib/actionPackages';
import { preparePackageAssembly, preparePackagePdfOutput, assemblePackage } from '@/lib/actionPackageAssembly';
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

it('ignores hidden letter citations when a coordination page is assembled', async () => {
  const base = createBlankSession(undefined, 'coordination_page');
  const snapshot = { ...base, endItems: [], publicationTables: {},
    formData: { ...base.formData, classLevel: 'unclassified' as const, coordinationEntries: [
      { office: 'Operations', contact: '', phone: '', date: '', position: 'Concur' },
    ] },
    paragraphs: [{ id: 'retained-letter', text: 'See enclosure (99).', level: 0 }],
  };
  const document = captureDocumentRevision({ documentId: 'coordination', epoch: 0, editSequence: 0, capturedAt: 1 }, snapshot);
  const coordination = await capturePackageMember(document, 'Coordination page', 'coordination-sheet');
  const main = await captureOriginalPackageMember({ name: 'Main document.pdf', data: await markedPdf() }, 'basic-letter', false);
  const record = await reviseActionPackage(await createActionPackage(`Coordination ${crypto.randomUUID()}`), [main, coordination]);
  const prepared = await preparePackageAssembly(record, record.currentRevisionId, secret);
  expect(prepared.readiness.findings.filter(finding => finding.severity === 'error')).toEqual([]);
  const doc = await PDFDocument.create();
  doc.addPage().drawText('COORDINATION PAGE');
  const bytes = await doc.save();
  const assembled = await assemblePackage(prepared, { compile: async () => bytes, convertDocx: vi.fn(), waitForReady: async () => true });
  expect(getPackageRevision(assembled).outputs[0]?.boundaries.map(b => b.startPage)).toEqual([1, 2]);
});

it('continues endorsement numbering from the rendered staff paper', async () => {
  const bytes = await markedPdf();
  const doc = await PDFDocument.create();
  doc.addPage().drawText('SYNTHETIC OUTPUT');
  const rendered = await doc.save();
  const visibleEnclosure = new Uint8Array(rendered).buffer;
  const source = createBlankSession(undefined, 'information_paper');
  const snapshot = { ...source, endItems: [], publicationTables: {}, formData: {
    ...source.formData, officeCode: 'ADMIN', date: '17 Nov 26', subject: 'Staff briefing', preparedBy: 'Example Author',
  }, paragraphs: [{ text: 'Staff briefing content.', level: 0 }], enclosures: [{
    title: 'Retained letter attachment', file: { data: bytes, name: 'retained.pdf', size: bytes.byteLength },
  }] };
  const main = await capturePackageMember(captureDocumentRevision({ documentId: 'staff-paper', epoch: 0, editSequence: 0, capturedAt: 1 }, snapshot), 'Staff briefing', 'basic-letter');
  const endorsement = createBlankSession(undefined, 'new_page_endorsement');
  Object.assign(endorsement.formData, { endorsementOrdinal: 'FIRST', basicLetterId: composeBasicLetterId(snapshot),
    from: 'Training Office', to: 'Training Director', subject: 'Staff briefing', sigLast: 'Example', unitLine1: 'FICTIONAL UNIT', startingEnclosureNumber: 1 });
  const end = await capturePackageMember(captureDocumentRevision({ documentId: 'endorsement', epoch: 0, editSequence: 0, capturedAt: 1 }, {
    ...endorsement, endItems: [], publicationTables: {}, references: [], paragraphs: [{ text: 'See enclosure (1).', level: 0 }],
    enclosures: [{ title: 'Visible enclosure', file: { data: visibleEnclosure, name: 'visible.pdf', size: visibleEnclosure.byteLength } }],
  }), 'Endorsement', 'endorsement');
  const record = await reviseActionPackage(await createActionPackage(`Staff briefing ${crypto.randomUUID()}`), [main, end]);
  const prepared = await preparePackageAssembly(record, record.currentRevisionId, secret);
  expect(prepared.readiness.findings.filter(finding => finding.severity === 'error')).toEqual([]);
  const assembled = await assemblePackage(prepared, { compile: async () => rendered, convertDocx: vi.fn(), waitForReady: async () => true });
  const boundaries = getPackageRevision(assembled).outputs[0]?.boundaries;
  expect(boundaries?.map(boundary => [boundary.startPage, boundary.firstPageLabel, boundary.pageCount])).toEqual([[1, '1', 1], [2, '2', 2]]);
});

it('rechecks deployment and package revision between a real PDF preview and delivery', async () => {
  const member = await captureOriginalPackageMember({ name: 'Preview.pdf', data: await markedPdf() }, 'basic-letter', false);
  const record = await reviseActionPackage(await createActionPackage('Reviewed output'), [member]);
  const signal = new AbortController().signal;
  const prepared = await preparePackageAssembly(record, record.currentRevisionId, secret);
  const output = await preparePackagePdfOutput(prepared, { compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true }, signal);
  expect((await PDFDocument.load(await output.blob.arrayBuffer())).getPageCount()).toBe(output.pages);
  const stored = async () => getPackageRevision((await listActionPackages(record.id))[0]);
  expect((await stored()).outputs).toHaveLength(0);
  currentPolicy = unclassified;
  await expect(output.deliver(signal)).rejects.toThrow(/deployment|policy|settings/i);
  currentPolicy = secret;
  await reviseActionPackage(record, [{ ...member, label: 'Updated original' }]);
  await expect(output.deliver(signal)).rejects.toThrow(/changed after preparation/);
  expect((await stored()).outputs).toHaveLength(0);
});
