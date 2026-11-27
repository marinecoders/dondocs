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

it('checks for a real, empty text field in the revision being signed', async () => {
  const field = 'Decision date';
  const revision: PackageRevision = { id: 'revision', createdAt: 0, members: [], outputs: [], requirements: { version: 1, items: [{
    id: 'date', label: 'Pending decision', memberId: 'form', kind: 'document', operations: ['pdf'], condition: 'active',
    completion: { pdfSelections: [{ field, expected: null, label: 'Leave decision date empty.' }] },
  }] } };
  pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/build/pdf.worker.mjs');
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const check = async () => checkPackageSigningPrerequisites(revision, 'form', 'reviewer', Uint8Array.from(await pdf.save()).buffer);
  await expect(check()).rejects.toThrow('Leave decision date empty.');
  const date = pdf.getForm().createTextField(field);
  date.addToPage(page);
  await expect(check()).resolves.toBeUndefined();
  date.setText('2026-01-01');
  await expect(check()).rejects.toThrow('Leave decision date empty.');
});

it('requires every started row on the exact PDF while leaving unused rows optional', async () => {
  const alternatives = [['articleA', 'summaryA', 'findingA'], ['articleB', 'summaryB', 'findingB']];
  const revision: PackageRevision = { id: 'revision', createdAt: 0, members: [], outputs: [], requirements: { version: 1, items: [{
    id: 'findings', label: 'Findings', memberId: 'form', kind: 'document', operations: ['pdf'], condition: 'active',
    completion: { answerGroups: [{ label: 'Finish each allegation.', alternatives, eachStartedRow: true, beforeSignatures: ['authority'] }] },
  }] } };
  pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/build/pdf.worker.mjs');
  const check = async (fields: string[]) => checkPackageSigningPrerequisites(revision, 'form', 'authority', await answers(fields));
  await expect(check([])).rejects.toThrow('Finish each allegation.');
  await expect(check(alternatives[0])).resolves.toBeUndefined();
  await expect(check([...alternatives[0], 'findingB'])).rejects.toThrow('Finish each allegation.');
  await expect(check([...alternatives[0], 'articleB', 'summaryB'])).rejects.toThrow('Finish each allegation.');
  await expect(check(alternatives.flat())).resolves.toBeUndefined();
});

it('only enforces PDF rules and checks their assigned revision before signing', async () => {
  const document = { kind: 'document' as const, id: 'rows', label: 'Rows', memberId: 'form', condition: 'active' as const,
    completion: { answerGroups: [{ label: 'Finish the row.', alternatives: [['value']], eachStartedRow: true as const, beforeSignatures: ['authority'] }] } };
  const revision: PackageRevision = { id: 'revision', createdAt: 0, members: [], outputs: [],
    requirements: { version: 1, items: [{ ...document, operations: ['portable'] }] } };
  const bytes = await answers([]);
  const check = () => checkPackageSigningPrerequisites(revision, 'form', 'authority', bytes);
  await expect(check()).resolves.toBeUndefined();
  revision.requirements!.items = [{ ...document, operations: ['pdf'], memberRevisionId: 'previous' }];
  await expect(check()).rejects.toThrow('Review the assigned document revision');
});
