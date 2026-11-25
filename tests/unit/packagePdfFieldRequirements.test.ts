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
