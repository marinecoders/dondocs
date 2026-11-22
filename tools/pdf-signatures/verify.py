"""Verify retained PDF bytes offline and emit a report bound to those bytes."""

import argparse
from datetime import datetime, timezone
from hashlib import sha256
from importlib.metadata import version
from io import BytesIO
import json
import logging
from pathlib import Path
import sys

from pyhanko.keys import load_certs_from_pemder_data
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign.validation import validate_pdf_signature, validate_pdf_timestamp
from pyhanko.sign.validation.status import SignatureCoverageLevel
from pyhanko_certvalidator import ValidationContext

MAX_PDF_BYTES = 20 * 1024 * 1024
MAX_REVOCATION_BYTES = 2 * 1024 * 1024
MAX_EVIDENCE_FILES = 32
MAX_SIGNATURES = 32
MAX_REVISIONS = 128
DETACHED_FORMATS = {"/adbe.pkcs7.detached", "/ETSI.CAdES.detached"}
TIMESTAMP_FORMAT = "/ETSI.RFC3161"


def read_bounded(path, maximum):
    with path.open("rb") as file:
        data = file.read(maximum + 1)
    if not data or len(data) > maximum:
        raise ValueError("An input file is empty or exceeds its size limit.")
    return data


def timestamp_report(status):
    if status is None:
        return None
    return {
        "time": status.timestamp.isoformat(),
        "signatureIntact": status.intact and status.valid,
        "trusted": status.trusted,
    }


def inspect_signature(signature, context, tsa_context):
    kind = str(signature.sig_object.get("/SubFilter"))
    report = {"field": signature.field_name, "format": kind}
    if kind not in DETACHED_FORMATS and kind != TIMESTAMP_FORMAT:
        return {**report, "state": "unsupported"}

    if kind == TIMESTAMP_FORMAT:
        status = validate_pdf_timestamp(signature, tsa_context)
        timestamp = timestamp_report(status)
        content_timestamp = None
    else:
        status = validate_pdf_signature(signature, context, tsa_context)
        timestamp = timestamp_report(status.timestamp_validity)
        content_timestamp = timestamp_report(status.content_timestamp_validity)

    timestamps = [item for item in (timestamp, content_timestamp) if item is not None]
    covers_revision = status.coverage in {
        SignatureCoverageLevel.ENTIRE_FILE, SignatureCoverageLevel.ENTIRE_REVISION,
    }
    invalid_signature = not status.intact or not status.valid or not covers_revision
    invalid_timestamp = any(not item["signatureIntact"] for item in timestamps)
    if invalid_signature or invalid_timestamp or status.docmdp_ok is False:
        state = "invalid"
    elif status.coverage == SignatureCoverageLevel.ENTIRE_REVISION and status.docmdp_ok is not True:
        state = "inconclusive"
    elif not status.trusted or any(not item["trusted"] for item in timestamps):
        state = "trust-not-established"
    elif kind != TIMESTAMP_FORMAT and not status.seed_value_ok:
        state = "invalid"
    else:
        state = "verified"

    return {
        **report,
        "state": state,
        "digestMatches": status.intact,
        "cryptographicSignatureValid": status.valid,
        "certificateSha256": sha256(status.signing_cert.dump()).hexdigest(),
        "certificateTrustedAtVerificationTime": status.trusted,
        "coverage": status.coverage.name.lower() if status.coverage is not None else None,
        "laterChanges": status.modification_level.name.lower() if status.modification_level is not None else None,
        "permittedChanges": status.docmdp_ok,
        "timestamp": timestamp,
        "contentTimestamp": content_timestamp,
        "signerReportedTime": status.signer_reported_dt.isoformat()
        if kind != TIMESTAMP_FORMAT and status.signer_reported_dt is not None else None,
    }


def verify_pdf(pdf, roots, timestamp_roots, crls=(), ocsps=(), require_revocation=False):
    """Use explicit trust anchors. The verifier never fetches external resources."""
    now = datetime.now(timezone.utc)
    evidence = {
        "moment": now,
        "allow_fetching": False,
        "crls": crls,
        "ocsps": ocsps,
        "revocation_mode": "require" if require_revocation else "soft-fail",
        "weak_hash_algos": {"md2", "md5", "sha1"},
    }
    context = ValidationContext(trust_roots=roots, **evidence)
    tsa_context = ValidationContext(trust_roots=timestamp_roots, **evidence)
    report = {
        "kind": "dondocs-pdf-signature-verification",
        "version": 1,
        "verifier": "pyHanko",
        "verifierVersion": version("pyhanko"),
        "fileSha256": sha256(pdf).hexdigest(),
        "checkedAt": now.isoformat(),
        "trustAnchorSha256": sorted({sha256(cert.dump()).hexdigest() for cert in roots}),
        "timestampTrustAnchorSha256": sorted({sha256(cert.dump()).hexdigest() for cert in timestamp_roots}),
        "revocationEvidenceSha256": sorted({sha256(data).hexdigest() for data in (*crls, *ocsps)}),
        "requireRevocationEvidence": require_revocation,
        "signatures": [],
    }
    reader = PdfFileReader(BytesIO(pdf), strict=True)
    if reader.security_handler is not None or reader.xrefs.total_revisions > MAX_REVISIONS:
        return {**report, "state": "unsupported"}
    signatures = reader.embedded_signatures
    if len(signatures) > MAX_SIGNATURES:
        return {**report, "state": "unsupported"}
    for signature in signatures:
        try:
            report["signatures"].append(inspect_signature(signature, context, tsa_context))
        except Exception:
            # Malformed and unsupported signatures cannot yield a positive result.
            report["signatures"].append({"field": signature.field_name, "state": "inconclusive"})
    report["state"] = "unsigned"
    if signatures:
        if any(result["state"] != "verified" for result in report["signatures"]):
            report["state"] = "review-required"
        elif all(result["format"] == TIMESTAMP_FORMAT for result in report["signatures"]):
            report["state"] = "timestamp-only"
        else:
            report["state"] = "verified"
    return report


def load_roots(paths):
    roots = []
    for path in paths:
        roots.extend(load_certs_from_pemder_data(read_bounded(path, MAX_REVOCATION_BYTES)))
        if len(roots) > MAX_EVIDENCE_FILES:
            raise ValueError("Supply at most 32 trust anchors in each trust list.")
    return roots


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--trust-root", action="append", type=Path, required=True)
    parser.add_argument("--timestamp-root", action="append", type=Path, default=[])
    parser.add_argument("--crl", action="append", type=Path, default=[], help="Local DER CRL")
    parser.add_argument("--ocsp", action="append", type=Path, default=[], help="Local DER OCSP response")
    parser.add_argument("--require-revocation", action="store_true")
    args = parser.parse_args()
    logging.disable(logging.CRITICAL)
    try:
        if any(len(paths) > MAX_EVIDENCE_FILES for paths in (args.trust_root, args.timestamp_root, args.crl, args.ocsp)):
            raise ValueError("Supply at most 32 inputs for each evidence type.")
        report = verify_pdf(
            read_bounded(args.pdf, MAX_PDF_BYTES),
            load_roots(args.trust_root),
            load_roots(args.timestamp_root),
            [read_bounded(path, MAX_REVOCATION_BYTES) for path in args.crl],
            [read_bounded(path, MAX_REVOCATION_BYTES) for path in args.ocsp],
            args.require_revocation,
        )
    except Exception:
        print("Could not verify this PDF or load the supplied verification policy.", file=sys.stderr)
        return 2
    print(json.dumps(report, indent=2, ensure_ascii=True))
    return 0 if report["state"] == "verified" else 1


if __name__ == "__main__":
    sys.exit(main())
