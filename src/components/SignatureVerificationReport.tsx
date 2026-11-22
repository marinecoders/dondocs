import { useRef, useState } from 'react';
import { readSignatureVerificationReport, type SignatureVerificationReport as Report } from '@/lib/signatureVerificationReport';

const reportLabels: Record<Report['state'], string> = {
  verified: 'Signatures passed under the supplied verifier policy',
  unsigned: 'No signatures found',
  'timestamp-only': 'Document timestamp evidence only',
  unsupported: 'Unsupported PDF or signature structure',
  'review-required': 'One or more signatures need review',
};

const signatureLabels: Record<Report['signatures'][number]['state'], string> = {
  verified: 'Passed',
  invalid: 'Invalid',
  inconclusive: 'Inconclusive',
  'trust-not-established': 'Certificate or timestamp trust could not be established',
  unsupported: 'Unsupported signature format',
};

export function SignatureVerificationReport({ readPdf }: { readPdf: () => Uint8Array }) {
  const [report, setReport] = useState<Report>();
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const generation = useRef(0);
  async function open(file: File) {
    const request = ++generation.current;
    setReport(undefined);
    setError('');
    setReading(true);
    try {
      const result = await readSignatureVerificationReport(file, readPdf);
      if (request === generation.current) setReport(result);
    } catch (cause) {
      if (request === generation.current) setError(cause instanceof Error ? cause.message : 'The verification report could not be read.');
    } finally {
      if (request === generation.current) setReading(false);
    }
  }

  return <details className="space-y-2 rounded border p-3 text-sm">
    <summary className="cursor-pointer font-medium">Review a signature verification report</summary>
    <p className="text-xs text-muted-foreground">Run the DonDocs offline verifier on the unchanged return with your approved trust roots. DonDocs matches the report to the PDF bytes. Results are supplied by the imported file and require you to trust its source. Signer authority and approval are separate.</p>
    <label className="block">Verification report (JSON)
      <input className="mt-1 block w-full" type="file" accept=".json,application/json" onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) void open(file);
      }} />
    </label>
    {reading && <p role="status">Matching the report to the retained PDF…</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {report && <div className="space-y-2">
      <p role="status"><strong>Imported report</strong> · {reportLabels[report.state]}</p>
      <p className="text-xs">{report.verifier} {report.verifierVersion} · {report.checkedAt} · {report.requireRevocationEvidence ? 'Revocation evidence required' : 'Revocation evidence optional'}</p>
      <p className="break-all text-xs">PDF SHA-256: {report.fileSha256}</p>
      {!!report.signatures.length && <ul className="space-y-2">
        {report.signatures.map((signature, index) => <li className="rounded border p-2" key={index}>
          <p className="break-words font-medium">{signature.field || `Signature ${index + 1}`} · {signatureLabels[signature.state]}</p>
          {signature.coverage && <p>Coverage: {signature.coverage.replaceAll('_', ' ')}</p>}
          {signature.laterChanges && <p>Later changes: {signature.laterChanges.replaceAll('_', ' ')}</p>}
          {signature.permittedChanges != null && <p>Change policy: {signature.permittedChanges ? 'permitted' : 'failed'}</p>}
          {signature.certificateRevoked && <p>Certificate revoked</p>}
          {signature.certificateTrustProblem && <p className="break-words">Certificate finding: {signature.certificateTrustProblem}</p>}
          {signature.certificateSha256 && <p className="break-all text-xs">Certificate SHA-256: {signature.certificateSha256}</p>}
          {([['Timestamp', signature.timestamp], ['Content timestamp', signature.contentTimestamp]] as const).map(([label, timestamp]) => timestamp &&
            <p key={label}>{label}: {timestamp.time} · {timestamp.revoked ? 'revoked' : !timestamp.signatureIntact ? 'invalid' : timestamp.trusted ? 'trusted by the verifier' : 'trust unestablished'}</p>)}
          {signature.signerReportedTime && <p>Signer-reported time: {signature.signerReportedTime}</p>}
        </li>)}
      </ul>}
      <details>
        <summary className="cursor-pointer">Trust and revocation evidence</summary>
        {([
          ['Signer trust anchors', report.trustAnchorSha256],
          ['Timestamp trust anchors', report.timestampTrustAnchorSha256],
          ['Revocation evidence', report.revocationEvidenceSha256],
        ] as const).map(([label, values]) => <div className="mt-2 text-xs" key={label}>
          <p className="font-medium">{label} ({values.length})</p>
          <ul>{values.map(digest => <li className="break-all" key={digest}>{digest}</li>)}</ul>
        </div>)}
      </details>
    </div>}
  </details>;
}
