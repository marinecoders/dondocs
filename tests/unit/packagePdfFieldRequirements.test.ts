import 'fake-indexeddb/auto';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { expect, it, vi } from 'vitest';
import { captureOriginalPackageMember } from '@/lib/actionPackageAssets';
import { createActionPackage, getPackageRevision, reviseActionPackage } from '@/lib/actionPackages';
import { inspectPackageRequirements } from '@/lib/packageRequirements';

vi.mock('react-pdf', async () => ({ pdfjs: await import('pdfjs-dist/legacy/build/pdf.mjs') }));
vi.mock('@/components/pdf/pdfConfig', async () => {
  const { GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  GlobalWorkerOptions.workerSrc = resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
  return { HARDENED_PDF_OPTIONS: { isEvalSupported: false } };
});

it('checks actual fields on a received PDF even when the recipe accepts any edition', async () => {
  const pdf = await PDFDocument.create(), page = pdf.addPage();
  const form = pdf.getForm();
  form.createTextField('Reason').addToPage(page);
  const name = form.createTextField('Name');
  name.addToPage(page);
  name.setText('Training Example');
  form.createCheckBox('Consent').addToPage(page);
  const member = await captureOriginalPackageMember({ name: 'training.pdf', data: new Uint8Array(await pdf.save()).buffer }, 'basic-letter', false);
  const record = await reviseActionPackage(await createActionPackage('Training verification'), [member]);
  const revision = getPackageRevision(record);
  const required = ['Name', 'Reason', 'Consent', 'Absent'];
  revision.requirements = { version: 1, items: required.map(field => ({ id: field, label: field, kind: 'document', memberId: member.id,
    operations: ['pdf'], condition: 'active', completion: { requiredPdfFields: [field] } })) };
  expect((await inspectPackageRequirements(revision, 'pdf')).items.map(item => item.state)).toEqual(['satisfied', 'missing', 'missing', 'missing']);
  expect((await inspectPackageRequirements(revision, 'portable')).ready).toBe(true);
});

it('checks the actual signing bytes and the captured return against the same checkbox rule', async () => {
  const { checkPackageSigningPrerequisites } = await import('@/lib/packageSigningPrerequisites');
  const pdf = await PDFDocument.create(), page = pdf.addPage();
  const consent = pdf.getForm().createCheckBox('Consent');
  consent.addToPage(page);
  const before = Uint8Array.from(await pdf.save()).buffer;
  consent.check();
  const after = Uint8Array.from(await pdf.save()).buffer;
  const member = await captureOriginalPackageMember({ name: 'consent.pdf', data: after }, 'basic-letter', false);
  const record = await reviseActionPackage(await createActionPackage('Consent check'), [member]);
  const revision = getPackageRevision(record);
  revision.requirements = { version: 1, items: [{ id: 'consent', label: 'Consent', kind: 'document',
    operations: ['pdf'], condition: 'active', memberId: member.id, completion: {
      pdfSelections: [{ field: 'Consent', label: 'Consent is required.', expected: true }],
    } }] };
  expect((await inspectPackageRequirements(revision, 'pdf')).ready).toBe(true);
  await expect(checkPackageSigningPrerequisites(revision, member.id, 'Approval', before)).rejects.toThrow('Consent is required.');
  await expect(checkPackageSigningPrerequisites(revision, member.id, 'Approval', after)).resolves.toBeUndefined();
  const rule = revision.requirements.items[0];
  if (rule.kind !== 'document' || !rule.completion?.pdfSelections) throw new Error('Missing test rule.');
  rule.completion.pdfSelections[0].expected = false;
  await expect(checkPackageSigningPrerequisites(revision, member.id, 'Approval', before)).resolves.toBeUndefined();
  await expect(checkPackageSigningPrerequisites(revision, member.id, 'Approval', after)).rejects.toThrow('Consent is required.');
});
