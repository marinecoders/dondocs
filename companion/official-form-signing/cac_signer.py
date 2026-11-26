"""pyHanko signer backed by a local CAC helper, with native consent."""

import asyncio
import json
import subprocess
from base64 import b64decode
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path

from asn1crypto import pem, x509
from pyhanko.sign import signers
from pyhanko_certvalidator import CertificateValidator, ValidationContext
from pyhanko_certvalidator.errors import ValidationError
from pyhanko_certvalidator.registry import SimpleCertificateStore


# DoD Root CAs 3 through 6. DER certificates matched to the published DoD
# thumbprints before deriving these SHA-256 pins. Only these roots are anchors.
# https://dl.dod.cyber.mil/wp-content/uploads/pki-pke/pdf/unclass-dod_approved_external_pkis_master_document.pdf
DOD_ROOT_PINS = frozenset({
    "b107b33f453e5510f68e513110c6f6944bacc263df0137f821c1b3c2f8f863d2",
    "559a5189452b13f8233f0022363c06f26e3c517c1d4b77445035959df3244f74",
    "1f4ede9dc2a241f6521bf518424acd49ebe84420e69daf5bac57af1f8ee294a9",
    "2a5e41aca93df7cc496d2369b7a0a037045d502f1abaaf76975fc07c6660cf93",
})


class CACError(Exception):
    pass


def dod_validation_context(bundle, system_chain=()):
    try:
        with Path(bundle).open("rb") as source:
            data = source.read(4_000_001)
        if len(data) > 4_000_000:
            raise ValueError("DoD CA bundle is too large")
        certificates = [
            x509.Certificate.load(der)
            for kind, _, der in pem.unarmor(data, multiple=True)
            if kind == "CERTIFICATE"
        ]
        # System-provided certificates can help build the path, but cannot
        # become trust roots by appearing in the card's chain.
        roots = [cert for cert in certificates if cert.sha256.hex() in DOD_ROOT_PINS]
        if not roots:
            raise ValueError("No configured DoD trust anchors")
        intermediates = [cert for cert in certificates if cert not in roots]
        return ValidationContext(
            trust_roots=roots,
            other_certs=[*intermediates, *system_chain],
            allow_fetching=False,
            revocation_mode="soft-fail",
        )
    except (OSError, ValueError) as error:
        raise CACError("The local DoD CA bundle could not be verified.") from error


def eligible_certificate(row):
    certificate = x509.Certificate.load(b64decode(row["certificate"], validate=True))
    usage = certificate.key_usage_value
    validity = certificate["tbs_certificate"]["validity"]
    now = datetime.now(timezone.utc)
    if (usage and {"digital_signature", "non_repudiation"} <= usage.native
        and validity["not_before"].native <= now <= validity["not_after"].native):
        return certificate
    return None


class CACSigner(signers.Signer):
    def __init__(self, helper, field, revision, ca_bundle, fingerprint):
        self.helper = [helper] if isinstance(helper, (str, Path)) else helper
        self.field = field
        self.revision = revision
        try:
            result = subprocess.run([*self.helper, "list"], capture_output=True, check=True, timeout=15)
            candidates = {}
            for row in json.loads(result.stdout):
                certificate = eligible_certificate(row)
                if certificate and certificate.public_key.algorithm == "rsa":
                    observed = sha256(certificate.dump()).hexdigest()
                    if row["fingerprint"] != observed:
                        raise ValueError("Certificate fingerprint mismatch")
                    candidates[observed] = (row, certificate)
        except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
            raise CACError("Could not read the CAC signing certificate from the local companion.") from error
        if fingerprint not in candidates:
            raise CACError("No document-signing certificate found. Insert your CAC and try again.")
        self.fingerprint = fingerprint
        identity, certificate = candidates[fingerprint]
        system_chain = [x509.Certificate.load(b64decode(der, validate=True)) for der in identity["chain"]]
        self.validation_context = dod_validation_context(ca_bundle, system_chain)
        validator = CertificateValidator(certificate, validation_context=self.validation_context)
        try:
            path = asyncio.run(validator.async_validate_usage({"digital_signature", "non_repudiation"}))
        except ValidationError as error:
            raise CACError("The CAC signing certificate could not be verified against the configured DoD chain.") from error
        registry = SimpleCertificateStore()
        for issuer in path.iter_certs(include_root=False):
            if issuer.sha256 != certificate.sha256:
                registry.register(issuer)
        super().__init__(signing_cert=certificate, cert_registry=registry, embed_roots=False)

    async def async_sign_raw(self, data, digest_algorithm, dry_run=False):
        if digest_algorithm != "sha256":
            raise CACError("Unsupported CAC signing algorithm.")
        signature_size = (self.signing_cert.public_key.bit_size + 7) // 8
        if dry_run:
            return bytes(signature_size)
        try:
            result = subprocess.run(
                [*self.helper, "sign", json.dumps({
                    "version": 1, "certificateSHA256": self.fingerprint,
                    "purpose": f"{self.field} · PDF {self.revision}",
                })],
                input=data, capture_output=True, timeout=105,
            )
        except subprocess.TimeoutExpired as error:
            raise CACError("CAC approval timed out. Try again and respond to the local approval prompt.") from error
        except OSError as error:
            raise CACError("The local CAC companion could not be started.") from error
        if result.returncode == 2:
            raise CACError("CAC signing canceled.")
        if result.returncode == 3:
            raise CACError("The selected CAC is unavailable. Reinsert it and reconnect.")
        if result.returncode or len(result.stdout) != signature_size:
            raise CACError("The CAC could not sign. Check the card and the local approval prompt.")
        return result.stdout
