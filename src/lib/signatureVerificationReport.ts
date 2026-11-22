import { z } from 'zod';
import { signingDigest } from './signingWorkspace';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const dateTime = z.iso.datetime({ offset: true });
const trustProblem = z.string().max(200).nullable();
const timestamp = z.object({
  time: dateTime,
  signatureIntact: z.boolean(),
  trusted: z.boolean(),
  trustProblem,
  revoked: z.boolean(),
}).strict();
const documentTimestamp = '/ETSI.RFC3161';
const supportedFormats = new Set(['/adbe.pkcs7.detached', '/ETSI.CAdES.detached', documentTimestamp]);

const signature = z.object({
  field: z.string().max(2000),
  format: z.string().max(120).optional(),
  state: z.enum(['verified', 'invalid', 'inconclusive', 'trust-not-established', 'unsupported']),
  digestMatches: z.boolean().optional(),
  cryptographicSignatureValid: z.boolean().optional(),
  certificateSha256: sha256.optional(),
  certificateTrustedAtVerificationTime: z.boolean().optional(),
  certificateTrustProblem: trustProblem.optional(),
  certificateRevoked: z.boolean().optional(),
  coverage: z.string().max(120).nullish(),
  laterChanges: z.string().max(120).nullish(),
  permittedChanges: z.boolean().nullish(),
  timestamp: timestamp.nullish(),
  contentTimestamp: timestamp.nullish(),
  signerReportedTime: dateTime.nullish(),
}).strict().refine(value => {
  if (value.state !== 'verified') return true;
  const timestamps = [value.timestamp, value.contentTimestamp].filter(item => item != null);
  return !!value.format && supportedFormats.has(value.format)
    && value.digestMatches === true && value.cryptographicSignatureValid === true
    && !!value.certificateSha256 && value.certificateTrustedAtVerificationTime === true && value.certificateRevoked === false
    && (value.coverage === 'entire_file' || value.coverage === 'entire_revision' && value.permittedChanges === true)
    && value.permittedChanges !== false && (value.format !== documentTimestamp || !!value.timestamp)
    && timestamps.every(item => item.signatureIntact && item.trusted && !item.revoked);
});
const report = z.object({
  kind: z.literal('dondocs-pdf-signature-verification'),
  version: z.literal(1),
  verifier: z.literal('pyHanko'),
  verifierVersion: z.string().min(1).max(80),
  fileSha256: sha256,
  checkedAt: dateTime,
  trustAnchorSha256: z.array(sha256).max(32),
  timestampTrustAnchorSha256: z.array(sha256).max(32),
  revocationEvidenceSha256: z.array(sha256).max(64),
  requireRevocationEvidence: z.boolean(),
  signatures: z.array(signature).max(32),
  state: z.enum(['verified', 'unsigned', 'timestamp-only', 'unsupported', 'review-required']),
}).strict().refine(value => {
  const signatures = value.signatures;
  if (!signatures.length) return value.state === 'unsigned' || value.state === 'unsupported';
  if (signatures.some(item => item.state !== 'verified')) return value.state === 'review-required';
  return value.state === (signatures.every(item => item.format === documentTimestamp) ? 'timestamp-only' : 'verified');
});

export type SignatureVerificationReport = z.infer<typeof report>;
export const MAX_SIGNATURE_REPORT_BYTES = 256 * 1024;

export async function readSignatureVerificationReport(
  file: File, readPdf: () => Uint8Array,
): Promise<SignatureVerificationReport> {
  if (!file.size || file.size > MAX_SIGNATURE_REPORT_BYTES) {
    throw new Error('Choose a verification JSON report between 1 byte and 256 KB.');
  }
  let value: unknown;
  try {
    value = JSON.parse(await file.text());
  } catch {
    throw new Error('The verification report could not be read as JSON.');
  }
  const parsed = report.safeParse(value);
  if (!parsed.success) throw new Error('Choose a version 1 report from the DonDocs offline signature verifier.');
  if (parsed.data.fileSha256 !== await signingDigest(readPdf())) {
    throw new Error('This verification report belongs to different PDF bytes.');
  }
  return parsed.data;
}
