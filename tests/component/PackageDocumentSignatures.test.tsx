import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PackageMember, PackageRevision } from '@/lib/actionPackages';
import { portableResourceDigest } from '@/lib/portableResources';
import { connectSigningCompanion, disconnectSigningCompanion, hasInspectedSignature, inspectOfficialPdf } from '@/services/forms/signingBridge';
import { PackageDocumentSignatures } from '@/components/PackageDocumentSignatures';

const bytes = Uint8Array.of(1, 2, 3);
const base: PackageRevision = { id: 'revision', createdAt: 1, members: [], outputs: [], requirements: {
  version: 1, items: [{ kind: 'document', label: 'Required signatures', id: 'sign', memberId: 'form', condition: 'active',
    operations: ['pdf'], completion: { signatureFields: ['Authority', 'Witness'], signatureLabels: { Witness: 'Duty officer' } } }],
} };
function member(sha256: string): PackageMember {
  return { id: 'form', revisionId: 'formRev', kind: 'original', label: 'Sample original', role: 'supporting-document',
    required: true, signedOriginal: true, original: { id: 'asset', sha256, type: 'application/pdf', name: 'sample.pdf', size: bytes.length } };
}
afterEach(() => vi.unstubAllGlobals());

it('requires a local inspection before reporting trust or field locks', () => {
  render(<PackageDocumentSignatures revision={base} member={member('b'.repeat(64))} disabled={false} onHandoff={vi.fn()} />);
  fireEvent.click(screen.getByText('Signatures'));
  expect(screen.getByText(/Original marked signed/)).toBeVisible();
  expect(screen.getByText(/Authority · Required · Requires inspection/)).toBeVisible();
  expect(screen.queryByText(/trusted chain/)).toBeNull();
});

it('shows trusted, outstanding and locked fields for the inspected bytes alone', async () => {
  const sha256 = await portableResourceDigest(bytes.buffer);
  const fields = [
    { name: 'Authority', label: 'Authority', signed: true, locked: true, trusted: true, lockAction: '', lockFields: [] },
    { name: 'Witness', label: 'Witness', signed: false, locked: false, trusted: null, lockAction: 'All', lockFields: [] },
    { name: 'Closed', label: 'Closed', signed: false, locked: true, trusted: null, lockAction: '', lockFields: [] },
  ];
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(Response.json({ token: 'a'.repeat(43), expiresIn: 900, maxAgeSeconds: 14_400 }))
    .mockResolvedValueOnce(Response.json({ formId: 'demo', edition: '1', sha256, fields }))
    .mockResolvedValueOnce(Response.json({})));
  const signal = new AbortController().signal;
  const inspection = await inspectOfficialPdf(bytes, await connectSigningCompanion(signal), signal);
  await disconnectSigningCompanion(signal);
  inspection.fields[2].locked = false;
  const onField = vi.fn();
  render(<PackageDocumentSignatures revision={base} member={member(sha256)} disabled={false} onField={onField} onHandoff={vi.fn()} />);
  fireEvent.click(screen.getByText('Signatures'));
  expect(screen.getByText(/Authority · Required · Signed · trusted chain/)).toBeVisible();
  expect(screen.getByText(/Closed · Available field · Locked/)).toBeVisible();
  expect(screen.getByText('Signing locks all fields.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Review signature field: Duty officer' }));
  expect(onField).toHaveBeenCalledWith('Witness');
  expect(hasInspectedSignature(sha256, 'Authority')).toBe(true);
  expect(hasInspectedSignature('b'.repeat(64), 'Authority')).toBe(false);
});

it('keeps a manually accepted content difference distinct from signature verification', () => {
  const sha = 'c'.repeat(64), source = member(sha);
  const revision = { ...base, signing: { handoffs: [{ id: 'handoff', target: { kind: 'member', id: source.id, revisionId: source.revisionId },
    sourceSha256: sha, signers: [], returns: [{ id: 'returned', memberId: 'returned-member', returnedAsset: { sha256: 'a'.repeat(64) }, assessment: 'different' }] }] } } as unknown as PackageRevision;
  render(<PackageDocumentSignatures revision={revision} member={source} disabled={false} onHandoff={vi.fn()} />);
  fireEvent.click(screen.getByText('Signatures'));
  expect(screen.getByText('Content differs from the handoff. Association accepted manually.')).toBeVisible();
  expect(screen.queryByText(/Signed · trusted chain/)).toBeNull();
});
