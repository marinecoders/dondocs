"""Read certificates from inserted cards and sign with their Windows provider."""
import ctypes as c
from contextlib import ExitStack
from hashlib import sha256


class Canceled(Exception):
    pass


class Unavailable(Exception):
    pass


DWORD, BOOL, HANDLE, PTR, WSTR = c.c_uint32, c.c_int32, c.c_void_p, c.c_void_p, c.c_wchar_p
OUT = c.POINTER
BASE_CSP = "Microsoft Base Smart Card Crypto Provider"
CARD_KSP = "Microsoft Smart Card Key Storage Provider"
NO_CARD = {0x8010000C, 0x80100017, 0x80100069, 0x80090016, 0x80090030}
CANCELED = {1223, 0x800704C7, 0x80090036, 0x80100002, 0x8010006E}


class Certificate(c.Structure):
    _fields_ = [("encoding", DWORD), ("encoded", PTR), ("length", DWORD), ("info", PTR), ("store", HANDLE)]


class ProviderInfo(c.Structure):
    _fields_ = [("container", WSTR), ("name", WSTR), ("type", DWORD), ("flags", DWORD),
                ("count", DWORD), ("params", PTR), ("key_spec", DWORD)]


class PaddingInfo(c.Structure):
    _fields_ = [("algorithm", WSTR)]


def function(dll, name, result, *args):
    fn = getattr(dll, name)
    fn.restype, fn.argtypes = result, args
    return fn


def check(status):
    if status in CANCELED:
        raise Canceled
    if status in NO_CARD:
        raise Unavailable
    if status:
        raise OSError(f"Windows card provider status {status:#x}")


def last_error():
    # ctypes exposes GetLastError as a signed C long, including HRESULT values.
    return DWORD(c.get_last_error()).value


def success(ok):
    if not ok:
        check(last_error() or 1)


class WindowsCard:
    def __init__(self):
        # System32-only resolution, including on an installation on a removable drive.
        def library(name):
            return c.WinDLL(name, use_last_error=True, winmode=0x800)
        scard, crypto, adv, ncrypt, ui = map(library, ("winscard", "crypt32", "advapi32", "ncrypt", "user32"))
        self.establish = function(scard, "SCardEstablishContext", DWORD, DWORD, PTR, PTR, OUT(HANDLE))
        self.release = function(scard, "SCardReleaseContext", DWORD, HANDLE)
        self.list_readers = function(scard, "SCardListReadersW", DWORD, HANDLE, WSTR, PTR, OUT(DWORD))
        self.connect = function(scard, "SCardConnectW", DWORD, HANDLE, WSTR, DWORD, DWORD, OUT(HANDLE), OUT(DWORD))
        self.disconnect = function(scard, "SCardDisconnect", DWORD, HANDLE, DWORD)
        self.acquire = function(adv, "CryptAcquireContextW", BOOL, OUT(HANDLE), WSTR, WSTR, DWORD, DWORD)
        self.release_provider = function(adv, "CryptReleaseContext", BOOL, HANDLE, DWORD)
        self.param = function(adv, "CryptGetProvParam", BOOL, HANDLE, DWORD, PTR, OUT(DWORD), DWORD)
        self.close_store = function(crypto, "CertCloseStore", BOOL, HANDLE, DWORD)
        self.next_cert = function(crypto, "CertEnumCertificatesInStore", OUT(Certificate), HANDLE, OUT(Certificate))
        self.free_cert = function(crypto, "CertFreeCertificateContext", BOOL, OUT(Certificate))
        self.property = function(crypto, "CertGetCertificateContextProperty", BOOL, OUT(Certificate), DWORD, PTR, OUT(DWORD))
        self.acquire_key = function(crypto, "CryptAcquireCertificatePrivateKey", BOOL, OUT(Certificate), DWORD, PTR,
                                    OUT(HANDLE), OUT(DWORD), OUT(BOOL))
        self.free_key = function(ncrypt, "NCryptFreeObject", DWORD, HANDLE)
        self.sign_hash = function(ncrypt, "NCryptSignHash", DWORD, HANDLE, OUT(PaddingInfo), PTR, DWORD, PTR, DWORD, OUT(DWORD), DWORD)
        self.create_hash = function(adv, "CryptCreateHash", BOOL, HANDLE, DWORD, HANDLE, DWORD, OUT(HANDLE))
        self.hash_data = function(adv, "CryptHashData", BOOL, HANDLE, PTR, DWORD, DWORD)
        self.sign_legacy = function(adv, "CryptSignHashW", BOOL, HANDLE, DWORD, WSTR, DWORD, PTR, OUT(DWORD))
        self.free_hash = function(adv, "CryptDestroyHash", BOOL, HANDLE)
        self.dialog = function(ui, "MessageBoxW", c.c_int, HANDLE, WSTR, WSTR, DWORD)

    def certificates(self):
        context = HANDLE()
        status = self.establish(0, None, None, c.byref(context))
        if status == 0x8010001D:  # No smart card service running.
            return
        check(status)
        with ExitStack() as stack:
            stack.callback(self.release, context)
            size = DWORD()
            status = self.list_readers(context, None, None, c.byref(size))
            if status == 0x8010002E:  # No readers installed.
                return
            check(status)
            if not 1 <= size.value <= 65536:
                raise OSError("Invalid reader list")
            names = c.create_unicode_buffer(size.value)
            check(self.list_readers(context, None, names, c.byref(size)))
            for reader in names[:size.value].rstrip("\0").split("\0"):
                if not reader:
                    continue
                with ExitStack() as resources:
                    card, protocol = HANDLE(), DWORD()
                    status = self.connect(context, reader, 2, 3, c.byref(card), c.byref(protocol))  # Shared, T=0 or T=1
                    # Another application may exclusively hold one of several readers.
                    if status in NO_CARD or status in (0x8010000B, 0x80100066, 0x80100065):
                        continue
                    check(status)
                    resources.callback(self.disconnect, card, 0)
                    try:
                        yield from self.reader_certificates(reader, resources)
                    except Unavailable:
                        continue

    def reader_certificates(self, reader, resources):
        provider = HANDLE()
        scope = "\\\\.\\" + reader + "\\"
        # Request a silent, reader-scoped context solely for its public certificate store.
        success(self.acquire(c.byref(provider), scope, BASE_CSP, 1, 0xF0000040))
        resources.callback(self.release_provider, provider, 0)
        store = HANDLE()
        length = DWORD(c.sizeof(store))
        success(self.param(provider, 42, c.byref(store), c.byref(length), 0))  # PP_USER_CERTSTORE
        resources.callback(self.close_store, store, 0)
        yield from self.store_certificates(store)

    def store_certificates(self, store):
        current = None
        try:
            while True:
                current = self.next_cert(store, current)  # Releases the previous context.
                if not current:
                    if last_error() not in (0x80092004, 18):  # CRYPT_E_NOT_FOUND, ERROR_NO_MORE_FILES
                        raise OSError("Cannot enumerate card certificates")
                    return
                length = DWORD()
                if not self.property(current, 2, None, c.byref(length)):  # CERT_KEY_PROV_INFO_PROP_ID
                    if last_error() == 0x80092004:
                        continue
                    raise OSError("Cannot inspect card provider")
                if not c.sizeof(ProviderInfo) <= length.value <= 65536:
                    raise OSError("Invalid card provider information")
                buf = c.create_string_buffer(length.value)
                success(self.property(current, 2, buf, c.byref(length)))
                info = c.cast(buf, OUT(ProviderInfo)).contents
                if (info.type == 0 and info.name == CARD_KSP) or (info.type == 1 and info.name == BASE_CSP):
                    yield c.string_at(current.contents.encoded, current.contents.length), current
        finally:
            if current:
                self.free_cert(current)

    def approve(self, purpose, subject, fingerprint, digest):
        text = f"{purpose}\n\nCertificate: {subject}\nSHA-256 fingerprint: {fingerprint}\nData to sign (SHA-256): {digest}"
        result = self.dialog(None, text, "DonDocs CAC signing", 0x00000124 | 0x00010000)  # Yes/No, default No, foreground
        if not result:
            raise OSError("Could not open the approval dialog")
        return result == 6

    def sign(self, cert, message):
        handle, spec, owned = HANDLE(), DWORD(), BOOL()
        # Allow CNG; compare the key to the selected certificate and disable key association repair.
        success(self.acquire_key(cert, 0x10000 | 0x04 | 0x08, None, c.byref(handle), c.byref(spec), c.byref(owned)))
        with ExitStack() as stack:
            if spec.value == 0xFFFFFFFF:  # CERT_NCRYPT_KEY_SPEC
                if owned.value:
                    stack.callback(self.free_key, handle)
                data = sha256(message).digest()
                pad = PaddingInfo("SHA256")
                def sign(out, length, written):
                    check(self.sign_hash(handle, c.byref(pad), data, len(data), out, length, written, 2))
                return self.signature_bytes(sign)
            if owned.value:
                stack.callback(self.release_provider, handle, 0)
            if spec.value not in (1, 2):  # AT_KEYEXCHANGE, AT_SIGNATURE
                raise Unavailable
            digest = HANDLE()
            success(self.create_hash(handle, 0x800C, None, 0, c.byref(digest)))  # CALG_SHA_256
            stack.callback(self.free_hash, digest)
            success(self.hash_data(digest, message, len(message), 0))
            def sign(out, length, written):
                success(self.sign_legacy(digest, spec, None, 0, out, written))
            return self.signature_bytes(sign)[::-1]  # CryptoAPI RSA signatures are little-endian.

    @staticmethod
    def signature_bytes(sign):
        size = DWORD()
        sign(None, 0, c.byref(size))
        if not 1 <= size.value <= 2048:
            raise OSError("Invalid signature size")
        out = c.create_string_buffer(size.value)
        sign(out, len(out), c.byref(size))
        return out.raw[:size.value]
