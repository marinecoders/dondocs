import os
import shutil
import subprocess
import unittest
from datetime import datetime, timedelta, timezone
from io import BytesIO
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image, ImageDraw
from appearance import certificate_stamp_style, fit_column, graphic_signing_request
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

    def test_administrative_action_has_no_publisher_signing_fields(self):
        original = self.templates / "NAVMC10274 - Administrative Action/2020-07/original.pdf"
        with self.assertRaisesRegex(ValueError, "supported official form edition"):
            inspect_revision(original.read_bytes(), self.context)

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

    def test_rejects_boxes_without_room_for_certificate_text(self):
        for width, height in [(0, 20), (-1, 20), (30, 0)]:
            with self.subTest(width=width, height=height), self.assertRaisesRegex(ValueError, "too small"):
                fit_column(["Signer"], width, height, len, 10)

    def test_custom_graphic_before_countersigning(self):
        font = Path(os.environ.get("DONDOCS_SIGNING_FONT", "/System/Library/Fonts/Supplemental/Times New Roman.ttf"))
        if not font.is_file():
            self.skipTest("Set DONDOCS_SIGNING_FONT to an installed Times New Roman Regular.")
        default = certificate_stamp_style(font)
        ink = Image.new("RGBA", (96, 32))
        ImageDraw.Draw(ink).line([(4, 23), (24, 5), (16, 27), (88, 10)], fill="navy", width=4)
        output = BytesIO()
        ink.save(output, format="PNG")
        png = output.getvalue()
        for relative_file, first, second in [
            ("NAVMC11811 - Administrative Remarks/2014-05/original.pdf", None, None),
            ("NAVMC10132 - Unit Punishment Book/original.pdf", "9 NJP AUTHORITY SIGNATURE", "11 APPEAL ADVISEMENT SIGNATURE"),
        ]:
            with self.subTest(file=relative_file):
                original = (self.templates / relative_file).read_bytes()
                original_bytes, custom = graphic_signing_request(len(png).to_bytes(4, "big") + png + original,
                                                                 default, len(original))
                self.assertEqual(original_bytes, original)
                _, slots = inspect_revision(original, self.context)
                name = first or slots[0]["name"]
                one = sign_revision(original_bytes, name, self.signer, self.context, custom)
                reader = OfficialReader(BytesIO(one), strict=False)
                if reader.security_handler:
                    reader.decrypt("")
                widget = next(ref.get_object() for n, _, ref in fields.enumerate_sig_fields(reader) if n == name)
                stamp = widget["/AP"]["/N"]
                image = stamp["/Resources"]["/XObject"]["/SignatureGraphic"]
                self.assertEqual(image.data, custom.graphic.tobytes())
                self.assertIn(b"/SignatureGraphic Do", stamp.data)
                self.assertIsNone(default.graphic)
                two = sign_revision(one, second or slots[1]["name"], self.signer, self.context, default)
                self.assertTrue(two.startswith(one))
                inspect_return(two, len(one), sha256(one).hexdigest(), self.context)
                if shutil.which("pdfsig"):
                    with TemporaryDirectory() as folder:
                        dest = Path(folder, "synthetic.pdf")
                        dest.write_bytes(two)
                        report = subprocess.run(["pdfsig", str(dest)], check=True, capture_output=True,
                                                text=True, timeout=20).stdout
                        self.assertGreaterEqual(report.count("Signature is Valid"), 2, report)

    def test_graphic_request_rejects_invalid_images(self):
        # The same payload delimiter is used by the authenticated /sign endpoint.
        for kind, size in [("transparent", (40, 10)), ("oversize", (1025, 1))]:
            with self.subTest(kind=kind):
                output = BytesIO()
                Image.new("RGBA", size).save(output, format="PNG")
                png = output.getvalue()
                with self.assertRaises(ValueError):
                    graphic_signing_request(len(png).to_bytes(4, "big") + png + b"pdf", None, 3)
        for body in [b"", b"bad", b"\x00\x00\x00\x01xpdf", b"\x00\x00\x00\x10"]:
            with self.assertRaises(ValueError):
                graphic_signing_request(body, None, 3)

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

    def test_edit_between_upb_signatures(self):
        from form_edits import apply_field_edits, available_fields
        data = (self.templates / "NAVMC10132 - Unit Punishment Book/original.pdf").read_bytes()
        first = sign_revision(data, "2 ACC ELECTION AND RIGHTS SIGNATURE", self.signer, self.context)
        available, _ = available_fields(first, self.context)
        self.assertNotIn("18_accused_full_name", available)
        with self.assertRaisesRegex(ValueError, "locked"):
            apply_field_edits(first, {"18_accused_full_name": "Training"}, self.context)
        # The item 2 signer has already locked the allegations. Findings are entered later.
        changes = {"1a_finding": "Guilty", "6_punishment_imposed": "Training entry", "13_not_appealed": True}
        edited = apply_field_edits(first, changes, self.context)
        self.assertTrue(edited.startswith(first))
        available, _ = available_fields(edited, self.context)
        self.assertEqual({key: available[key][1]["value"] for key in changes}, changes)
        if shutil.which("pdftotext"):
            text = subprocess.check_output(["pdftotext", "-layout", "-", "-"], input=edited)
            self.assertIn(b"Training entry", text)
        second = sign_revision(edited, "3 RIGHTS ATTEST SIGNATURE", self.signer, self.context)
        self.assertTrue(second.startswith(edited))
        self.assertEqual(sum(s["trusted"] is True for s in inspect_revision(second, self.context)[1]), 2)

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
