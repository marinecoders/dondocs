"""Process fixture for the signing workspace. All identities are generated per run."""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.x509.oid import NameOID

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "companion/cac-signing/windows"))
sys.path.insert(0, str(ROOT / "companion/official-form-signing"))

import bridge
import cac_signer
from card_windows import Canceled
from helper import run


def make_identity(directory):
    now = datetime.now(timezone.utc)
    def issue(name, key, issuer, issuer_key, ca):
        return (x509.CertificateBuilder()
                .subject_name(name).issuer_name(issuer).public_key(key.public_key())
                .serial_number(x509.random_serial_number())
                .not_valid_before(now - timedelta(days=1)).not_valid_after(now + timedelta(days=1))
                .add_extension(x509.BasicConstraints(ca=ca, path_length=0 if ca else None), True)
                .add_extension(x509.KeyUsage(True, not ca, False, False, False, ca, ca, False, False), True)
                .sign(issuer_key, hashes.SHA256()))

    authority = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "DonDocs test authority")])
    signer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "DonDocs test signer")])
    root_key = rsa.generate_private_key(65537, 2048)
    key = rsa.generate_private_key(65537, 2048)
    root = issue(authority, root_key, authority, root_key, True)
    leaf = issue(signer, key, authority, root_key, False)
    (directory / "root.pem").write_bytes(root.public_bytes(serialization.Encoding.PEM))
    (directory / "signer.der").write_bytes(leaf.public_bytes(serialization.Encoding.DER))
    (directory / "key.pem").write_bytes(key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    return root.fingerprint(hashes.SHA256()).hex()


class FixtureCard:
    def __init__(self, directory):
        self.directory = directory

    def certificates(self):
        yield (self.directory / "signer.der").read_bytes(), None

    def approve(self, *_):
        return not (self.directory / "cancel").exists()

    def sign(self, _, message):
        key = serialization.load_pem_private_key((self.directory / "key.pem").read_bytes(), password=None)
        return key.sign(message, padding.PKCS1v15(), hashes.SHA256())


if __name__ == "__main__":
    mode, location, *args = sys.argv[1:]
    directory = Path(location)
    if mode == "card":
        try:
            sys.exit(run(args, sys.stdin.buffer, sys.stdout.buffer, FixtureCard(directory)))
        except Canceled:
            sys.exit(2)
    if mode not in {"native", "synthetic"}:
        raise ValueError("Unknown fixture mode")
    pin = make_identity(directory)
    sys.argv = [bridge.__file__, "--ca-bundle", str(directory / "root.pem"), *args]
    with patch.object(cac_signer, "DOD_ROOT_PINS", {pin}):
        if mode == "native":
            bridge.main()
        else:
            command = [sys.executable, str(Path(__file__).resolve()), "card", str(directory)]
            with patch.object(bridge, "helper_command", return_value=command):
                bridge.main()
