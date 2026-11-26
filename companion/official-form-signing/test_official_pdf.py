import shutil
import subprocess
import unittest
from datetime import datetime, timedelta, timezone
from io import BytesIO
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory

from asn1crypto import x509 as ax509
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID
from pyhanko.sign.signers import SimpleSigner
from pyhanko_certvalidator import ValidationContext

from pyhanko.pdf_utils import generic
from pyhanko.sign import fields
from official_pdf import OfficialReader, OfficialRevisionWriter, inspect_return, inspect_revision, sign_revision


def first_signed_revision(pdf):
    reader = OfficialReader(BytesIO(pdf), strict=False)
    reader.decrypt("")
    first, second = reader.embedded_signatures
    end = int(first.byte_range[2]) + int(first.byte_range[3])
    return pdf[:end], second.field_name


class OfficialSigning(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "DonDocs synthetic qualification")])
        now = datetime.now(timezone.utc)
        cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
                .serial_number(42).not_valid_before(now - timedelta(days=1)).not_valid_after(now + timedelta(days=1))
                .add_extension(x509.KeyUsage(True, True, False, False, False, True, True, False, False), True)
                .add_extension(x509.BasicConstraints(ca=True, path_length=None), True).sign(key, hashes.SHA256()))
        cls.context = ValidationContext(trust_roots=[ax509.Certificate.load(cert.public_bytes(serialization.Encoding.DER))],
                                        allow_fetching=False)
        with TemporaryDirectory() as temp:
            pfx = Path(temp, "fixture.p12")
            pfx.write_bytes(pkcs12.serialize_key_and_certificates(b"fixture", key, cert, None, serialization.NoEncryption()))
            cls.signer = SimpleSigner.load_pkcs12(str(pfx))
        cls.templates = Path(__file__).resolve().parents[2] / "public/templates"

    def test_conditional_release_retains_all_four_publisher_signatures(self):
        data = (self.templates / "dd/0368/2024-11-26/original.pdf").read_bytes()
        _, slots = inspect_revision(data, self.context)
        expected = ["member[0]", "recruiter[0]", "ao[0]", "SignatureField1[0]"]
        self.assertCountEqual([slot["name"].split(".")[-1] for slot in slots], expected)
        for name in expected:
            base = data
            field = next(slot["name"] for slot in slots if slot["name"].endswith("." + name))
            data = sign_revision(base, field, self.signer, self.context)
            inspect_return(data, len(base), sha256(base).hexdigest(), self.context)
        _, signed = inspect_revision(data, self.context)
        self.assertTrue(all(slot["signed"] and slot["trusted"] for slot in signed))

    def test_cola_retains_member_and_command_signatures_after_editing(self):
        blank = (self.templates / "navmc/11106/1989-01/original.pdf").read_bytes()
        writer = OfficialRevisionWriter(BytesIO(blank), strict=False)
        for _, _, ref in fields.enumerate_sig_fields(writer):
            widget = ref.get_object()
            widget[generic.pdf_name("/V")] = generic.NullObject()
            widget[generic.pdf_name("/Rect")] = generic.ArrayObject(
                generic.FloatObject(round(float(value), 2)) for value in widget["/Rect"]
            )
            writer.mark_update(ref)
        output = BytesIO()
        writer.write(output)
        data = output.getvalue()
        _, unsigned = inspect_revision(data, self.context)
        self.assertFalse(any(slot["signed"] for slot in unsigned))
        for field in ("SigMem", "SigCO"):
            base = data
            data = sign_revision(base, f"topmostSubform[0].Page1[0].{field}[0]", self.signer, self.context)
            inspect_return(data, len(base), sha256(base).hexdigest(), self.context)
        _, slots = inspect_revision(data, self.context)
        self.assertEqual(len(slots), 2)
        self.assertTrue(all(slot["signed"] and slot["trusted"] for slot in slots))

    def test_page11_countersign_and_first_signature_lock(self):
        data = (self.templates / "NAVMC11811 - Administrative Remarks/2014-05/original.pdf").read_bytes()
        _, slots = inspect_revision(data, self.context)
        self.assertEqual(len(slots), 3)
        one = sign_revision(data, slots[0]["name"], self.signer, self.context)
        two = sign_revision(one, slots[1]["name"], self.signer, self.context)
        self.assertTrue(two.startswith(one))
        self.assertEqual(sum(s["signed"] for s in inspect_revision(two, self.context)[1]), 2)
        inspect_return(two, len(one), sha256(one).hexdigest(), self.context)
        with self.assertRaisesRegex(ValueError, "exact saved file"):
            inspect_return(two, len(one), "0" * 64, self.context)
        final = sign_revision(data, slots[0]["name"], self.signer, self.context, finalize=True)
        with self.assertRaisesRegex(ValueError, "locked"):
            sign_revision(final, slots[1]["name"], self.signer, self.context)

    def test_desktop_acrobat_returns_in_both_orders(self):
        blank = (self.templates / "NAVMC11811 - Administrative Remarks/2014-05/original.pdf").read_bytes()
        fixtures = self.templates.parents[1] / "tests/fixtures/official-form-signing"
        # Only the public, synthetic test certificate is trusted, at its recorded qualification time.
        cert = ax509.Certificate.load((fixtures / "acrobat-test-certificate.der").read_bytes())
        context = ValidationContext(trust_roots=[cert], allow_fetching=False,
                                    moment=datetime(2026, 11, 25, 12, tzinfo=timezone.utc))
        acrobat_first = blank + (fixtures / "page11-acrobat-first.increment").read_bytes()
        acrobat_base, _ = first_signed_revision(acrobat_first)
        _, slots = inspect_return(acrobat_first, len(acrobat_base), sha256(acrobat_base).hexdigest(), context)
        self.assertEqual(sum(bool(s["signed"] and s["trusted"]) for s in slots), 2)

        for name in ("page11-acrobat-countersigned", "page11-acrobat-filled-return"):
            with self.subTest(fixture=name):
                returned = blank + (fixtures / (name + ".increment")).read_bytes()
                base, second_name = first_signed_revision(returned)
                _, prior = inspect_revision(base, context)
                self.assertFalse(next(s["locked"] for s in prior if s["name"] == second_name))
                with self.assertRaisesRegex(ValueError, "printable Page 11 was rewritten"):
                    inspect_return(returned, len(base), sha256(base).hexdigest(), context)
                with self.assertRaisesRegex(ValueError, "exact saved file"):
                    inspect_return(returned, len(acrobat_first), sha256(acrobat_first).hexdigest(), context)
                with self.assertRaisesRegex(ValueError, "Changes made after signing"):
                    inspect_revision(returned, self.context)

        # Changing only a signed whitespace byte preserves PDF syntax but breaks the digest.
        self.assertTrue(acrobat_first.endswith(b"\n"))
        with self.assertRaisesRegex(ValueError, "signature is damaged"):
            inspect_revision(acrobat_first[:-1] + b" ", context)

    @unittest.skipUnless(shutil.which("pdftotext"), "Poppler is needed to check the printable page")
    def test_acrobat_replaces_the_printable_page_in_a_filled_xfa_return(self):
        blank = (self.templates / "NAVMC11811 - Administrative Remarks/2014-05/original.pdf").read_bytes()
        fixture = self.templates.parents[1] / "tests/fixtures/official-form-signing/page11-acrobat-filled-return.increment"
        returned = blank + fixture.read_bytes()
        base, _ = first_signed_revision(returned)

        def printed_text(pdf):
            return subprocess.run(["pdftotext", "-nopgbrk", "-", "-"], input=pdf,
                                  capture_output=True, check=True, timeout=10).stdout

        before, after = printed_text(base), printed_text(returned)
        self.assertIn(b"Please wait", before)
        self.assertNotIn(b"Qualification example.", before)
        self.assertNotIn(b"Please wait", after)
        self.assertIn(b"Qualification example.", after)
        self.assertIn(b"Second column.", after)

    def test_jagman_countersignatures(self):
        for code, field_names in [("d", ["Election_Marine", "Election_witness"]),
                                  ("g", ["Appeal_Marine", "Appeal_witness"]),
                                  ("e", ["Education_Marine", "Education_witness"]),
                                  ("o", ["Suspect_signature", "Statement_suspect"])]:
            with self.subTest(appendix=code):
                data = (self.templates / f"jagman/a-1-{code}/5800.7G-CH2/1/fillable.pdf").read_bytes()
                before = sign_revision(data, field_names[0], self.signer, self.context)
                inspect_return(before, len(data), sha256(data).hexdigest(), self.context)
                after = sign_revision(before, field_names[1], self.signer, self.context)
                self.assertTrue(after.startswith(before))
                _, slots = inspect_return(after, len(before), sha256(before).hexdigest(), self.context)
                self.assertEqual({s["name"] for s in slots if s["signed"] and s["trusted"]}, set(field_names))

    def test_unit_punishment_book_enforces_publisher_locks(self):
        data = (self.templates / "NAVMC10132 - Unit Punishment Book/original.pdf").read_bytes()
        _, slots = inspect_revision(data, self.context)
        self.assertEqual(len(slots), 7)
        name = "9 NJP AUTHORITY SIGNATURE"
        one = sign_revision(data, name, self.signer, self.context)
        slots = {s["name"]: s for s in inspect_revision(one, self.context)[1]}
        self.assertTrue(slots[name]["signed"])
        self.assertTrue(slots["2 ACC ELECTION AND RIGHTS SIGNATURE"]["locked"])
        self.assertFalse(slots["11 APPEAL ADVISEMENT SIGNATURE"]["locked"])
        two = sign_revision(one, "11 APPEAL ADVISEMENT SIGNATURE", self.signer, self.context)
        self.assertTrue(two.startswith(one))

    def test_rejects_changed_publisher_signature_rectangle(self):
        data = (self.templates / "NAVMC10132 - Unit Punishment Book/original.pdf").read_bytes()
        writer = OfficialRevisionWriter(BytesIO(data), strict=False)
        writer.encrypt("")
        _, _, ref = next(fields.enumerate_sig_fields(writer))
        ref.get_object()[generic.pdf_name("/Rect")] = generic.ArrayObject([generic.NumberObject(0)] * 4)
        writer.mark_update(ref)
        output = BytesIO()
        writer.write(output)
        with self.assertRaisesRegex(ValueError, "signature fields differ"):
            inspect_revision(output.getvalue(), self.context)
