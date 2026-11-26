"""Platform checks using ephemeral software keys; production discovery only opens card stores."""
import ctypes as c
import struct
import sys
import unittest

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from card_windows import (BASE_CSP, CARD_KSP, BOOL, DWORD, HANDLE, OUT, PTR, WSTR, Certificate,
                          ProviderInfo, WindowsCard, check, function, success)
from test_helper import TestCard


@unittest.skipUnless(sys.platform == "win32", "Windows provider APIs required")
class ProviderSigning(unittest.TestCase):
    message = b"\x00DonDocs provider test\r\n\xff"

    def setUp(self):
        self.card = WindowsCard()

    def check_signature(self, handle, key_spec, exponent, modulus):
        def acquire(_cert, _flags, _params, key, spec, owned):
            c.cast(key, OUT(HANDLE))[0] = handle.value
            c.cast(spec, OUT(DWORD))[0] = key_spec
            c.cast(owned, OUT(BOOL))[0] = 0  # This test owns the ephemeral key.
            return True
        self.card.acquire_key = acquire
        signed = self.card.sign(None, self.message)
        rsa.RSAPublicNumbers(exponent, modulus).public_key().verify(signed, self.message, padding.PKCS1v15(), hashes.SHA256())

    def test_certificate_store_filters_provider_and_reaches_end_normally(self):
        dll = c.WinDLL("crypt32", use_last_error=True, winmode=0x800)
        open_store = function(dll, "CertOpenStore", HANDLE, PTR, DWORD, HANDLE, DWORD, PTR)
        store = open_store(2, 0, None, 0, None)  # CERT_STORE_PROV_MEMORY
        self.assertTrue(store)
        self.addCleanup(self.card.close_store, store, 0)
        self.assertEqual(list(self.card.store_certificates(store)), [])

        add = function(dll, "CertAddEncodedCertificateToStore", BOOL, HANDLE, DWORD, PTR, DWORD,
                       DWORD, OUT(OUT(Certificate)))
        set_property = function(dll, "CertSetCertificateContextProperty", BOOL, OUT(Certificate), DWORD, DWORD, PTR)
        der = TestCard().der
        entry = OUT(Certificate)()
        success(add(store, 1, der, len(der), 1, c.byref(entry)))
        self.addCleanup(self.card.free_cert, entry)
        self.assertEqual(list(self.card.store_certificates(store)), [])  # No provider binding.
        for name, prov_type, expected in ((BASE_CSP, 1, [der]), (CARD_KSP, 0, [der]),
                                          ("Microsoft Software Key Storage Provider", 0, [])):
            with self.subTest(name=name):
                info = ProviderInfo(container="Synthetic", name=name, type=prov_type)
                success(set_property(entry, 2, 0, c.byref(info)))
                self.assertEqual([cert for cert, _ in self.card.store_certificates(store)], expected)

    def test_cryptoapi_signature_byte_order(self):
        dll = c.WinDLL("advapi32", use_last_error=True, winmode=0x800)
        generate = function(dll, "CryptGenKey", BOOL, HANDLE, DWORD, DWORD, OUT(HANDLE))
        destroy = function(dll, "CryptDestroyKey", BOOL, HANDLE)
        export = function(dll, "CryptExportKey", BOOL, HANDLE, HANDLE, DWORD, DWORD, PTR, OUT(DWORD))
        provider, key = HANDLE(), HANDLE()
        success(self.card.acquire(c.byref(provider), None, "Microsoft Enhanced RSA and AES Cryptographic Provider", 24, 0xF0000000))
        self.addCleanup(self.card.release_provider, provider, 0)
        success(generate(provider, 2, 2048 << 16, c.byref(key)))
        self.addCleanup(destroy, key)
        size = DWORD()
        success(export(key, None, 6, 0, None, c.byref(size)))  # PUBLICKEYBLOB
        blob = c.create_string_buffer(size.value)
        success(export(key, None, 6, 0, blob, c.byref(size)))
        exponent = struct.unpack_from("<I", blob.raw, 16)[0]
        self.check_signature(provider, 2, exponent, int.from_bytes(blob.raw[20:], "little"))

    def test_cng_signs_single_sha256_digest(self):
        dll = c.WinDLL("ncrypt", use_last_error=True, winmode=0x800)
        open_provider = function(dll, "NCryptOpenStorageProvider", DWORD, OUT(HANDLE), WSTR, DWORD)
        create = function(dll, "NCryptCreatePersistedKey", DWORD, HANDLE, OUT(HANDLE), WSTR, WSTR, DWORD, DWORD)
        finalize = function(dll, "NCryptFinalizeKey", DWORD, HANDLE, DWORD)
        export = function(dll, "NCryptExportKey", DWORD, HANDLE, HANDLE, WSTR, PTR, PTR, DWORD, OUT(DWORD), DWORD)
        provider, key = HANDLE(), HANDLE()
        check(open_provider(c.byref(provider), "Microsoft Software Key Storage Provider", 0))
        self.addCleanup(self.card.free_key, provider)
        check(create(provider, c.byref(key), "RSA", None, 0, 0))  # An unnamed, ephemeral key.
        self.addCleanup(self.card.free_key, key)
        check(finalize(key, 0))
        size = DWORD()
        check(export(key, None, "RSAPUBLICBLOB", None, None, 0, c.byref(size), 0))
        blob = c.create_string_buffer(size.value)
        check(export(key, None, "RSAPUBLICBLOB", None, blob, len(blob), c.byref(size), 0))
        exp_len, modulus_len = struct.unpack_from("<II", blob.raw, 8)
        start = 24 + exp_len
        self.check_signature(key, 0xFFFFFFFF, int.from_bytes(blob.raw[24:start], "big"),
                             int.from_bytes(blob.raw[start:start + modulus_len], "big"))
