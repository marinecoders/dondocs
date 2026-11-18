import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { maintenanceFixture } from '../_helpers/packageTemplateMaintenance';
import { prepareConditionalPackage, applyPreparedConditionalPackage, conditionalPackageAnswers, packageTemplateInstanceKey, undoConditionalPackage } from '@/lib/packageConditional';
import { captureOriginalPackageMember, capturePackageMember } from '@/lib/actionPackageAssets';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage } from '@/lib/actionPackages';
import { updatePackageInformation } from '@/lib/packageInformation';
import { applyPreparedPackageUpdate, preparePackageUpdate, undoPackageUpdate } from '@/lib/packageUpdates';
import { resolveExportDeploymentPolicy, type PolicyResolution } from '@/lib/exportDeploymentPolicy';
import { extractPdfText } from '@/lib/pdfText';
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
it('checks actual unchanged original PDF text before publishing a full-revision Undo under a stricter policy', async () => {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText('SECRET\nSYNTHETIC UNDO TEST ONLY\nSECRET', { x: 54, y: 700, size: 12, font });
  const bytes = new Uint8Array(await pdf.save()).buffer; expect(await extractPdfText(bytes.slice(0))).toContain('SECRET');
  const original = await captureOriginalPackageMember({ name: 'Synthetic restricted source.pdf', data: bytes }, 'basic-letter', false);
  const source = await updatePackageInformation(await reviseActionPackage(await createActionPackage(`Original Undo ${crypto.randomUUID()}`), [original]),
    { version: 1, participants: [], facts: [{ id: 'public', label: 'Public fact', kind: 'text', value: 'Before', source: { kind: 'entered' } }] });
  const information = structuredClone(getPackageRevision(source).information!); information.facts[0].value = 'After';
  const prepared = await preparePackageUpdate(source, information, undefined, {}, secret), applied = await applyPreparedPackageUpdate(prepared, secret, true);
  currentPolicy = unclassified;
  await expect(undoPackageUpdate(applied.undo, unclassified)).rejects.toThrow('configured levels');
  expect((await listActionPackages()).find(record => record.id === applied.record.id)).toEqual(applied.record);
});

it('refuses to restore an edited native PDF enclosure removed by a conditional branch under a stricter policy', async () => {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText('SECRET\nSYNTHETIC CONDITIONAL UNDO ONLY\nSECRET', { x: 54, y: 700, size: 12, font });
  const data = new Uint8Array(await pdf.save()).buffer; expect(await extractPdfText(data.slice(0))).toContain('SECRET');
  const template = maintenanceFixture(); template.program.questions.push({ id: 'include', label: 'Include second member', kind: 'boolean', required: true });
  template.members.push({ ...structuredClone(template.members[0]), key: 'extra', label: 'Edited supporting document', role: 'supporting-document', required: false,
    when: { op: 'equals', questionId: 'include', value: true } });
  let record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template, name: 'Conditional Undo source', answers: { version: 1, values: { subject: 'Public training subject', include: true }, groups: {} } }, secret), secret, true)).record;
  const revision = getPackageRevision(record), extra = revision.members[1]; if (extra.kind !== 'native') throw new Error('Expected native member');
  const session = structuredClone(extra.session); session.enclosures = [{ title: 'Retained synthetic enclosure', file: { name: 'Synthetic retained.pdf', size: data.byteLength, data } }];
  const edited = await capturePackageMember(captureDocumentRevision({ documentId: 'synthetic-private-source', epoch: 0, editSequence: 1, capturedAt: 1 }, session), extra.label, extra.role, extra);
  record = await reviseActionPackage(record, [revision.members[0], edited]);
  const off = conditionalPackageAnswers(record); off.values.include = false;
  const applied = await applyPreparedConditionalPackage(await prepareConditionalPackage({ template, answers: off, record,
    memberChoices: { [packageTemplateInstanceKey('extra')]: 'remove' } }, secret), secret, true);
  expect(getPackageRevision(applied.record).members).toHaveLength(1); currentPolicy = unclassified;
  await expect(undoConditionalPackage(applied.undo!, unclassified)).rejects.toThrow('configured levels');
  expect((await listActionPackages()).find(item => item.id === applied.record.id)).toEqual(applied.record);
});
