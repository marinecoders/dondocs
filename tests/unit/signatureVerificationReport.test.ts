import { describe, expect, it } from 'vitest';
import { MAX_SIGNATURE_REPORT_BYTES, readSignatureVerificationReport } from '@/lib/signatureVerificationReport';
import { signingDigest } from '@/lib/signingWorkspace';

const pdf = new TextEncoder().encode('%PDF-test');
const report = {
  kind: 'dondocs-pdf-signature-verification',
  version: 1,
  verifier: 'pyHanko',
  verifierVersion: '0.32.0',
  checkedAt: '2026-11-21T10:15:07.872130+00:00',
  trustAnchorSha256: ['a'.repeat(64)],
  timestampTrustAnchorSha256: [],
  revocationEvidenceSha256: [],
  requireRevocationEvidence: false,
  signatures: [],
  state: 'unsigned',
};

async function reportFile(overrides: Record<string, unknown> = {}) {
  return new File([JSON.stringify({
    ...report, fileSha256: await signingDigest(pdf), ...overrides,
  })], 'verification.json');
}

describe('offline signature report review', () => {
  it('reads the supported verifier format, keeping its time and trust settings', async () => {
    const payload = await readSignatureVerificationReport(await reportFile(), () => pdf);
    expect(payload).toMatchObject(report);
  });

  it('binds a report to the retained bytes even when another PDF has the same length', async () => {
    const otherPdf = new TextEncoder().encode('%PDF-TEST');
    await expect(readSignatureVerificationReport(await reportFile(), () => otherPdf))
      .rejects.toThrow('different PDF bytes');
  });

  it('rejects unsupported, malformed and oversized files before requesting the PDF', async () => {
    const getPdf = () => { throw new Error('unexpected PDF read'); };
    await expect(readSignatureVerificationReport(await reportFile({ version: 2 }), getPdf))
      .rejects.toThrow('version 1');
    await expect(readSignatureVerificationReport(new File(['{'], 'bad.json'), getPdf))
      .rejects.toThrow('read as JSON');
    await expect(readSignatureVerificationReport(new File([' '.repeat(MAX_SIGNATURE_REPORT_BYTES + 1)], 'large.json'), getPdf))
      .rejects.toThrow('256 KB');
  });

  it('does not present a passing summary for an unsigned or inconclusive report', async () => {
    await expect(readSignatureVerificationReport(await reportFile({ state: 'verified' }), () => pdf))
      .rejects.toThrow('version 1');
    await expect(readSignatureVerificationReport(await reportFile({
      state: 'verified', signatures: [{ state: 'inconclusive', field: 'Signature1' }],
    }), () => pdf)).rejects.toThrow('version 1');
  });

  it('retains certificate and timestamp findings separately', async () => {
    const signature = {
      state: 'invalid',
      field: 'Signature1',
      format: '/ETSI.CAdES.detached',
      certificateSha256: 'f'.repeat(64),
      certificateRevoked: true,
      coverage: 'entire_revision',
      laterChanges: 'form_filling',
      permittedChanges: true,
      timestamp: {
        time: '2026-11-21T09:15:07Z',
        signatureIntact: true,
        trusted: false,
        trustProblem: 'no-trust-anchor',
        revoked: false,
      },
    };
    const payload = await readSignatureVerificationReport(await reportFile({
      state: 'review-required', signatures: [signature],
    }), () => pdf);
    expect(payload.signatures).toEqual([signature]);
  });
});

it('requires coherent evidence for a passing signature and separates document timestamps', async () => {
  const signature = {
    field: 'Synthetic signer', state: 'verified', format: '/ETSI.CAdES.detached',
    digestMatches: true, cryptographicSignatureValid: true, certificateSha256: 'b'.repeat(64),
    certificateTrustedAtVerificationTime: true, certificateRevoked: false,
    coverage: 'entire_revision', permittedChanges: true,
  };
  const load = async (findings: object, state = 'verified') => readSignatureVerificationReport(
    await reportFile({ state, signatures: [{ ...signature, ...findings }] }), () => pdf,
  );
  await expect(load({})).resolves.toMatchObject({ state: 'verified' });
  for (const findings of [{ digestMatches: false }, { certificateRevoked: true }, { permittedChanges: null }, { format: '/unrecognized' }]) {
    await expect(load(findings)).rejects.toThrow('version 1');
  }
  const timestamp = { time: '2026-11-21T10:15:07Z', signatureIntact: true, trusted: true, revoked: false, trustProblem: null };
  await expect(load({ format: '/ETSI.RFC3161', timestamp }, 'timestamp-only')).resolves.toMatchObject({ state: 'timestamp-only' });
  await expect(load({ format: '/ETSI.RFC3161', timestamp })).rejects.toThrow('version 1');
});
