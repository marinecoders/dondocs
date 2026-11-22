# Verify a returned PDF locally

Download the unchanged returned PDF from the Signing workspace. Install Python
3.11 or later and uv, then run from the repository root:

```sh
uv sync --project tools/pdf-signatures --locked
uv run --project tools/pdf-signatures --locked --offline python tools/pdf-signatures/verify.py \
  returned.pdf --trust-root signer-roots.pem --timestamp-root timestamp-roots.pem
```

Use trust anchors from your organization's approved trust store. Never import a
certificate from the returned PDF as a trust anchor. The verifier leaves the
PDF untouched and does not query endpoints from the file or its certificates.

The JSON report identifies the exact PDF, trust anchors, verification time and
verifier version. It evaluates supported detached PDF/CMS signatures and RFC
3161 timestamps, separates signer-reported time from trusted timestamp evidence,
and checks later changes against the PDF's certification policy. A signature
over a prior revision can pass only if its later changes are permitted. Unknown
formats or inconclusive differences require review.

Add local DER CRLs with `--crl` and OCSP responses with `--ocsp`. Use
`--require-revocation` when policy requires revocation evidence. A confirmed revocation is reported
as invalid and includes the verifier's trust finding. Without this
switch a passing check may lack revocation evidence. The verifier validates trust
at the current verification time. Archived long-term validation and an
organization's determination of signer authority remain separate.

The process exits 0 when all supported signatures pass under the supplied
policy and at least one document signer is verified. It exits 1 for unsigned
PDFs, timestamp-only PDFs or signatures requiring review, and 2 when it cannot
read the inputs. A document timestamp supplies evidence about time. Reports contain signature field names and certificate
fingerprints. Handle them with the associated source material.
