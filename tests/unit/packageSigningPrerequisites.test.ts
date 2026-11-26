import { PDFDocument } from 'pdf-lib';
import { pdfjs } from 'react-pdf';
import { expect, it } from 'vitest';
import type { PackageRevision } from '@/lib/actionPackages';
import { checkPackageSigningPrerequisites } from '@/lib/packageSigningPrerequisites';
async function answers(names: string[]) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  for (const name of names) {
    const field = pdf.getForm().createTextField(name);
    field.addToPage(page);
    field.setText('Example');
  }
  return new Uint8Array(await pdf.save()).buffer;
}

it('allows each signer when their own applicable row is complete', async () => {
  const revision: PackageRevision = { id: 'revision', createdAt: 0, members: [], outputs: [], requirements: { version: 1, items: [{
    id: 'people', label: 'People', memberId: 'form', kind: 'document', operations: ['pdf'], condition: 'active',
    completion: { answerGroups: [{ label: 'Complete one person.', alternatives: [['name1', 'date1'], ['name2', 'date2']], beforeSignatures: ['reviewer'] }] },
  }] } };
  pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/build/pdf.worker.mjs');
  const bytes = await answers(['name1', 'date2']);
  await checkPackageSigningPrerequisites(revision, 'form', 'applicant', bytes);
  await expect(checkPackageSigningPrerequisites(revision, 'form', 'reviewer', bytes)).rejects.toThrow('Complete one person.');
  await expect(checkPackageSigningPrerequisites(revision, 'form', 'reviewer', await answers(['name2', 'date2']))).resolves.toBeUndefined();
});
