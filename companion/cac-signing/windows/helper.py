"""DonDocs CAC v1 subprocess contract. Windows UI and card access live in card_windows."""
import base64
import hashlib
import json
import re
import sys
import unicodedata
from contextlib import closing

from cryptography import x509
from cryptography.exceptions import UnsupportedAlgorithm
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from card_windows import Canceled, Unavailable, WindowsCard


def signing_request(raw):
    if len(raw.encode("utf-8")) > 4096:
        raise ValueError
    obj = json.loads(raw)
    if not isinstance(obj, dict) or type(obj.get("version")) is not int or obj["version"] != 1:
        raise ValueError
    fingerprint, purpose = obj.get("certificateSHA256"), obj.get("purpose")
    if not isinstance(fingerprint, str) or not re.fullmatch("[0-9a-f]{64}", fingerprint):
        raise ValueError
    if (not isinstance(purpose, str) or not 1 <= len(purpose.encode("utf-8")) <= 160
            or purpose != purpose.strip() or any(unicodedata.category(c) in {"Cc", "Cf", "Zl", "Zp"} for c in purpose)):
        raise ValueError
    return fingerprint, purpose


def identities(card):
    for der, context in card.certificates():
        try:
            cert = x509.load_der_x509_certificate(der)
            public_key = cert.public_key()
        except (ValueError, UnsupportedAlgorithm):
            continue
        if isinstance(public_key, rsa.RSAPublicKey):
            yield hashlib.sha256(der).hexdigest(), cert, der, context


def run(args, stdin, stdout, card):
    if args == ["list"]:
        rows = {}
        for digest, _, der, _ in identities(card):
            rows[digest] = {"fingerprint": digest, "certificate": base64.b64encode(der).decode("ascii"), "chain": []}
        stdout.write(json.dumps(list(rows.values())).encode("ascii"))
        return 0
    if len(args) != 2 or args[0] != "sign":
        return 4
    try:
        digest, purpose = signing_request(args[1])
    except (ValueError, UnicodeError):
        return 4
    message = stdin.read(16385)
    if not 1 <= len(message) <= 16384:
        return 4
    with closing(identities(card)) as candidates:
        selected = next((cert for fp, cert, _, _ in candidates if fp == digest), None)
    if selected is None:
        raise Unavailable
    data_hash = hashlib.sha256(message).hexdigest()
    if not card.approve(purpose, selected.subject.rfc4514_string(), digest, data_hash):
        raise Canceled
    # Release discovery handles before the prompt. Look up the exact certificate again.
    with closing(identities(card)) as candidates:
        for fp, cert, _, context in candidates:
            if fp == digest:
                signature = card.sign(context, message)
                cert.public_key().verify(signature, message, padding.PKCS1v15(), hashes.SHA256())
                stdout.write(signature)
                return 0
    raise Unavailable


def main():
    return run(sys.argv[1:], sys.stdin.buffer, sys.stdout.buffer, WindowsCard())


if __name__ == "__main__":
    try:
        status = main()
        sys.stdout.buffer.flush()
    except Canceled:
        status = 2
    except Unavailable:
        status = 3
    except Exception:
        status = 1
    if status:
        print({1: "Windows CAC operation failed.", 2: "CAC approval canceled.",
               3: "Selected CAC unavailable.", 4: "Invalid CAC request."}[status], file=sys.stderr)
    sys.exit(status)
