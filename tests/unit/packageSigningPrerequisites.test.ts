import { expect, it, vi } from 'vitest';
import type { PackageRevision } from '@/lib/actionPackages';
import { checkPackageSigningPrerequisites } from '@/lib/packageSigningPrerequisites';
import { readAnsweredPdfFields } from '@/services/forms/readRequiredPdfFields';
vi.mock('@/services/forms/readRequiredPdfFields', () => ({ readAnsweredPdfFields: vi.fn() }));

it('allows each signer when their own applicable row is complete', async () => {
  const revision: PackageRevision = { id: 'revision', createdAt: 0, members: [], outputs: [], requirements: { version: 1, items: [{
    id: 'people', label: 'People', memberId: 'form', kind: 'document', operations: ['pdf'], condition: 'active',
    completion: { answerGroups: [{ label: 'Complete one person.', alternatives: [['name1', 'date1'], ['name2', 'date2']], beforeSignatures: ['reviewer'] }] },
  }] } };
  const bytes = new ArrayBuffer(0);
  await checkPackageSigningPrerequisites(revision, 'form', 'applicant', bytes);
  expect(readAnsweredPdfFields).not.toHaveBeenCalled();
  vi.mocked(readAnsweredPdfFields).mockResolvedValue(new Set(['name1', 'date2']));
  await expect(checkPackageSigningPrerequisites(revision, 'form', 'reviewer', bytes)).rejects.toThrow('Complete one person.');
  vi.mocked(readAnsweredPdfFields).mockResolvedValue(new Set(['name2', 'date2']));
  await expect(checkPackageSigningPrerequisites(revision, 'form', 'reviewer', bytes)).resolves.toBeUndefined();
});
