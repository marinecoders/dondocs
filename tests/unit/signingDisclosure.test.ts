import { beforeEach, expect, it, vi } from 'vitest';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { reviewSigningDisclosure, signingRecordDisclosure } from '@/lib/signingDisclosure';
import { uint8ArrayToBase64 } from '@/lib/encoding';

const mocks = vi.hoisted(() => ({ text: vi.fn() }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: mocks.text }));
const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
const bytes = new TextEncoder().encode('%PDF-1.7\nSynthetic retained bytes');
beforeEach(() => { mocks.text.mockReset();mocks.text.mockResolvedValue('TRAINING TEXT'); });
it('checks PDF text and metadata against the current deployment limits', async () => {
  mocks.text.mockResolvedValue('SECRET');
  await expect(reviewSigningDisclosure({ pdfs: [{ bytes, label: 'Original.pdf' }] }, policy)).rejects.toThrow('outside this deployment');
  mocks.text.mockClear();
  await expect(reviewSigningDisclosure({ pdfs: [], metadata: { title: 'SECRET' } }, policy)).rejects.toThrow('outside this deployment');
  expect(mocks.text).not.toHaveBeenCalled();
});
it('reports privacy findings and unreadable text without claiming complete inspection', async () => {
  mocks.text.mockResolvedValueOnce('SSN 123-45-6789').mockRejectedValueOnce(new Error('Unreadable text layer'));
  const review = await reviewSigningDisclosure({ pdfs: [{ bytes, label: 'First.pdf' }, { bytes, label: 'Second.pdf' }] }, policy);
  expect(review.privacy.found).toBe(true);expect(review.privacy.summary.ssn).toBeGreaterThan(0);
  expect(review.notices.some(value => value.includes('could not be inspected'))).toBe(true);
});
it('separates retained PDF bytes from metadata, including recoverable records with bad digests', () => {
  const input = { source: { data: uint8ArrayToBase64(bytes), filename: 'Original.pdf', pages: [], sha256: 'damaged' }, title: 'Training record' };
  const disclosure = signingRecordDisclosure(input);
  expect(disclosure.pdfs).toEqual([{ bytes, label: 'Original.pdf' }]);
  expect(JSON.stringify(disclosure.metadata)).not.toContain(input.source.data);
  expect(input.source.data).toBe(uint8ArrayToBase64(bytes));
});
it('suppresses cancelled reviews before any PDF inspection', async () => {
  await expect(reviewSigningDisclosure({ pdfs: [{ bytes, label: 'Original.pdf' }] }, policy, () => false)).rejects.toThrow('cancelled');
  expect(mocks.text).not.toHaveBeenCalled();
});
