from datetime import datetime, timedelta, timezone
from io import BytesIO
import logging
import unittest

from asn1crypto import keys, x509 as asn1_x509
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
from pyhanko.pdf_utils import generic
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.pdf_utils.writer import PageObject, PdfFileWriter
from pyhanko.sign import fields, signers, timestamps
from pyhanko.sign.ades.api import CAdESSignedAttrSpec
from pyhanko_certvalidator.registry import SimpleCertificateStore

from verify import verify_pdf


def identity(name, issuer=None, tsa=False):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)])
    signing_key, issuer_name = issuer if issuer else (key, subject)
    now = datetime.now(timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer_name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=1))
        .add_extension(x509.BasicConstraints(ca=issuer is None, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=issuer is not None,
                content_commitment=issuer is not None and not tsa,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=issuer is None,
                crl_sign=issuer is None,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
    )
    if tsa:
        cert = cert.add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.TIME_STAMPING]), critical=True)
    cert = asn1_x509.Certificate.load(cert.sign(signing_key, hashes.SHA256()).public_bytes(serialization.Encoding.DER))
    return key, subject, cert


def private_key(key):
    return keys.PrivateKeyInfo.load(key.private_bytes(
        serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ))


class PdfVerificationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        logging.disable(logging.CRITICAL)
        cls.addClassCleanup(logging.disable, logging.NOTSET)
        root_key, root_name, cls.root = identity("Synthetic CA")
        cls.root_key, cls.root_name = root_key, root_name
        _, _, cls.other_root = identity("Different synthetic CA")
        key, _, cert = identity("Synthetic document signer", (root_key, root_name))
        tsa_key, _, tsa = identity("Synthetic time source", (root_key, root_name), tsa=True)
        cls.signer = signers.SimpleSigner(cert, private_key(key), SimpleCertificateStore())
        cls.timestamper = timestamps.DummyTimeStamper(tsa, private_key(tsa_key))

    def source(self):
        writer = PdfFileWriter()
        contents = writer.add_object(generic.StreamObject(stream_data=b"q 0 0 10 10 re f Q"))
        writer.insert_page(PageObject(contents, [0, 0, 612, 792]))
        for slot in ("Review", "CounterSign"):
            fields.append_signature_field(writer, fields.SigFieldSpec(slot))
        output = BytesIO()
        writer.write(output)
        return output.getvalue()

    def signed(self, *, timestamp=False, permission=fields.MDPPerm.FILL_FORMS):
        output = BytesIO()
        signers.sign_pdf(
            IncrementalPdfFileWriter(BytesIO(self.source())),
            signers.PdfSignatureMetadata(field_name="Review", certify=True, docmdp_permissions=permission),
            self.signer,
            timestamper=self.timestamper if timestamp else None,
            output=output,
        )
        return output.getvalue()

    def countersigned(self, pdf):
        output = BytesIO()
        signers.sign_pdf(
            IncrementalPdfFileWriter(BytesIO(pdf)),
            signers.PdfSignatureMetadata(field_name="CounterSign"),
            self.signer,
            output=output,
        )
        return output.getvalue()

    def check(self, pdf, root=None, tsa_root=None, **options):
        return verify_pdf(pdf, [root or self.root], [tsa_root or self.root], **options)

    def test_unsigned_and_untrusted_are_distinct(self):
        self.assertEqual(self.check(self.source())["state"], "unsigned")
        result = self.check(self.signed(), root=self.other_root)["signatures"][0]
        self.assertTrue(result["digestMatches"])
        self.assertEqual(result["state"], "trust-not-established")

    def test_verify_with_and_without_timestamp_trust(self):
        signed = self.signed(timestamp=True)
        result = self.check(signed)["signatures"][0]
        self.assertEqual(result["state"], "verified")
        self.assertTrue(result["timestamp"]["trusted"])
        other = self.check(signed, tsa_root=self.other_root)["signatures"][0]
        self.assertEqual(other["state"], "trust-not-established")

    def test_document_timestamp_alone_is_not_a_verified_signer(self):
        output = BytesIO()
        signer = signers.PdfTimeStamper(self.timestamper)
        signer.timestamp_pdf(IncrementalPdfFileWriter(BytesIO(self.source())), "sha256", output=output)
        result = self.check(output.getvalue())
        self.assertEqual(result["state"], "timestamp-only")
        self.assertEqual(result["signatures"][0]["state"], "verified")
        self.assertTrue(result["signatures"][0]["timestamp"]["trusted"])

    def test_reports_content_timestamp_with_signature_timestamp(self):
        output = BytesIO()
        signers.sign_pdf(
            IncrementalPdfFileWriter(BytesIO(self.source())),
            signers.PdfSignatureMetadata(
                field_name="Review", subfilter=fields.SigSeedSubFilter.PADES,
                cades_signed_attr_spec=CAdESSignedAttrSpec(timestamp_content=True),
            ),
            self.signer, timestamper=self.timestamper, output=output,
        )
        result = self.check(output.getvalue())["signatures"][0]
        self.assertEqual(result["state"], "verified")
        self.assertTrue(result["contentTimestamp"]["trusted"])
        self.assertTrue(result["timestamp"]["trusted"])

    def test_covered_bytes_must_match(self):
        signed = self.signed()
        self.assertIn(b"10 10 re", signed)
        changed = signed.replace(b"10 10 re", b"20 10 re", 1)
        self.assertEqual(self.check(changed)["signatures"][0]["state"], "invalid")

    def test_certification_controls_later_signatures(self):
        signed = self.countersigned(self.signed())
        first, second = self.check(signed)["signatures"]
        self.assertEqual(first["state"], "verified")
        self.assertEqual(first["laterChanges"], "form_filling")
        self.assertEqual(second["coverage"], "entire_file")
        locked = self.signed(permission=fields.MDPPerm.NO_CHANGES)
        writer = IncrementalPdfFileWriter(BytesIO(locked))
        stream = writer.add_object(generic.StreamObject(stream_data=b"q 20 20 10 10 re f Q"))
        writer.add_stream_to_page(0, stream)
        output = BytesIO()
        writer.write(output)
        first = self.check(output.getvalue())["signatures"][0]
        self.assertEqual(first["state"], "invalid")
        self.assertFalse(first["permittedChanges"])

    def test_local_crl_distinguishes_good_revoked_and_missing_evidence(self):
        signed = self.signed()
        now = datetime.now(timezone.utc)
        crl = (x509.CertificateRevocationListBuilder().issuer_name(self.root_name)
               .last_update(now - timedelta(minutes=2)).next_update(now + timedelta(days=1)))
        good = crl.sign(self.root_key, hashes.SHA256()).public_bytes(serialization.Encoding.DER)
        self.assertEqual(self.check(signed, crls=[good], require_revocation=True)["state"], "verified")
        revoked = (x509.RevokedCertificateBuilder().serial_number(self.signer.signing_cert.serial_number)
                   .revocation_date(now - timedelta(minutes=1)).build())
        bad = crl.add_revoked_certificate(revoked).sign(self.root_key, hashes.SHA256()).public_bytes(serialization.Encoding.DER)
        result = self.check(signed, crls=[bad], require_revocation=True)["signatures"][0]
        self.assertTrue(result["certificateRevoked"])
        self.assertTrue(result["digestMatches"])
        self.assertEqual(result["state"], "invalid")

    def test_revocation_requirement_is_fail_closed(self):
        result = self.check(self.signed(), require_revocation=True)
        self.assertNotEqual(result["state"], "verified")


if __name__ == "__main__":
    unittest.main()
