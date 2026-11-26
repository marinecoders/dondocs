import base64
import ctypes as c
from ctypes import POINTER, c_uint32, cast, memmove
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from io import BytesIO
import json
import unittest

from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.x509.oid import NameOID

from card_windows import Canceled, DWORD, Unavailable, WindowsCard, check
from helper import run


class TestCard:
    def __init__(self):
        self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Synthetic card")])
        now = datetime.now(timezone.utc)
        cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
                .public_key(self.key.public_key()).serial_number(123)
                .not_valid_before(now).not_valid_after(now + timedelta(days=1))
                .sign(self.key, hashes.SHA256()))
        self.der = cert.public_bytes(serialization.Encoding.DER)
        self.purpose = "Test signature"
        self.present = True
        self.approved = True
        self.remove_on_consent = False

    def certificates(self):
        if self.present:
            yield self.der, self.key

    def approve(self, purpose, subject, fp, digest):
        self.confirmation = (purpose, subject, fp, digest)
        if self.remove_on_consent:
            self.present = False
        return self.approved

    def sign(self, key, message):
        return key.sign(message, padding.PKCS1v15(), hashes.SHA256())


class WindowsContract(unittest.TestCase):
    def setUp(self):
        self.card = TestCard()
        self.fp = sha256(self.card.der).hexdigest()
        self.request = {"version": 1, "purpose": self.card.purpose, "certificateSHA256": self.fp}
        self.message = b"\x00signed attributes\r\n\xff"
        self.out = BytesIO()

    def sign(self, data=None):
        return run(["sign", json.dumps(self.request)], BytesIO(self.message if data is None else data), self.out, self.card)

    def test_lists_public_cert_and_signs_the_same_binary_input_once(self):
        rows = BytesIO()
        run(["list"], BytesIO(), rows, self.card)
        self.assertEqual(json.loads(rows.getvalue()), [{"certificate": base64.b64encode(self.card.der).decode(),
                                                       "fingerprint": self.fp, "chain": []}])
        self.assertEqual(self.sign(), 0)
        self.card.key.public_key().verify(self.out.getvalue(), self.message, padding.PKCS1v15(), hashes.SHA256())
        self.assertEqual(self.card.confirmation, (self.card.purpose, "CN=Synthetic card", self.fp, sha256(self.message).hexdigest()))

    def test_unreadable_certificate_does_not_hide_valid_identity(self):
        self.card.certificates = lambda: iter([(b"invalid DER", None), (self.card.der, self.card.key)])
        self.assertEqual(self.sign(), 0)

    def test_removed_card_or_cancellation_delivers_no_bytes(self):
        self.card.approved = False
        with self.assertRaises(Canceled):
            self.sign()
        self.card.approved = True
        self.card.remove_on_consent = True
        with self.assertRaises(Unavailable):
            self.sign()
        rows = BytesIO()
        run(["list"], BytesIO(), rows, self.card)
        self.assertEqual(json.loads(rows.getvalue()), [])
        self.assertEqual(self.out.getvalue(), b"")

    def test_malformed_requests_are_rejected_before_consent(self):
        for data in (b"", b"x" * 16385):
            self.assertEqual(self.sign(data), 4)
        for key, value in (("purpose", "multi\nline"), ("version", True), ("certificateSHA256", "invalid")):
            with self.subTest(key=key):
                original = self.request[key]
                self.request[key] = value
                self.assertEqual(self.sign(), 4)
                self.request[key] = original
        self.assertFalse(hasattr(self.card, "confirmation"))
        self.assertEqual(self.out.getvalue(), b"")

    def test_provider_result_must_match_selected_certificate(self):
        self.card.sign = lambda key, data: bytes(256)
        with self.assertRaises(InvalidSignature):
            self.sign()
        self.assertEqual(self.out.getvalue(), b"")

    def test_reader_removed_or_reset_does_not_hide_the_next_reader(self):
        names = c.create_unicode_buffer("First\0Second\0")
        for first_status in (0x80100009, 0x80100068):
            with self.subTest(first_status=first_status):
                card = WindowsCard.__new__(WindowsCard)
                card.establish = card.release = card.disconnect = lambda *_: 0
                def list_readers(_ctx, _groups, out, count):
                    size = c.cast(count, c.POINTER(DWORD))
                    self.assertEqual(size[0], 0xFFFFFFFF)
                    c.cast(out, c.POINTER(c.c_void_p))[0] = c.addressof(names)
                    size[0] = len(names)
                    return 0
                card.list_readers = list_readers
                freed = []
                card.free_memory = lambda _ctx, ptr: freed.append(ptr.value)
                card.connect = lambda _ctx, name, *_: first_status if name == "First" else 0
                card.reader_certificates = lambda name, _: iter([name])
                self.assertEqual(list(card.certificates()), ["Second"])
                self.assertEqual(freed, [c.addressof(names)])

    def test_status_and_two_pass_signature_buffer(self):
        for code, error in ((0x8010006E, Canceled), (0x80100069, Unavailable), (0x80090020, OSError)):
            with self.assertRaises(error):
                check(code)
        def sign(out, size, written):
            cast(written, POINTER(c_uint32))[0] = 3
            if out is not None:
                self.assertEqual(size, 3)
                memmove(out, b"\x00\xff\x01", 3)
        self.assertEqual(WindowsCard.signature_bytes(sign), b"\x00\xff\x01")
