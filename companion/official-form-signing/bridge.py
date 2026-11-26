"""Loopback adapter between the DonDocs form workspace and the standalone CAC CLI."""
import argparse
import json
import logging
import secrets
import subprocess
import socket
import sys
import os
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from appearance import certificate_stamp_style
from cac_signer import CACError, CACSigner, dod_validation_context, eligible_certificate
from official_pdf import official_profile, inspect_return, inspect_revision, sign_revision

PORT = 47993
MAX_PDF = 20 * 1024 * 1024


class LoopbackServer(HTTPServer):
    def server_bind(self):
        if sys.platform == "win32":
            self.allow_reuse_address = False
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Requests can contain personal signing information.

    def setup(self):
        super().setup()
        self.connection.settimeout(20)

    def reply(self, code, body, mime="application/json"):
        payload = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        if self.headers.get("Origin") == self.server.origin:
            self.send_header("Access-Control-Allow-Origin", self.server.origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Field, X-Certificate, X-Finalize, X-Base-Length, X-Base-SHA256")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def allowed(self):
        return (self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}"
                and self.headers.get("Origin") == self.server.origin
                and self.path in ("/identities", "/inspect", "/sign", "/return"))

    def do_OPTIONS(self):
        self.reply(200 if self.allowed() else 403, {})

    def do_POST(self):
        if not self.allowed() or not secrets.compare_digest(
            self.headers.get("Authorization", "").encode(), ("Bearer " + self.server.token).encode()
        ):
            self.reply(403, {"error": "Check the pairing code and the configured DonDocs origin."})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size > MAX_PDF or size < 0 or "Transfer-Encoding" in self.headers:
                self.reply(413, {"error": "Choose a PDF up to 20 MB."})
                return
            if self.path == "/identities":
                if size:
                    raise ValueError("Unexpected certificate request body.")
                cmd = subprocess.run([*self.server.helper, "list"], capture_output=True, check=True, timeout=15)
                rows = []
                for row in json.loads(cmd.stdout):
                    cert = eligible_certificate(row)
                    if cert and cert.sha256.hex() == row["fingerprint"] and cert.public_key.algorithm == "rsa":
                        rows.append({"fingerprint": row["fingerprint"], "label": cert.subject.native.get("common_name", "Signing certificate")})
                self.reply(200, rows)
                return
            if self.headers.get_content_type() != "application/pdf" or size < 1:
                raise ValueError("Choose an official PDF revision.")
            data = self.rfile.read(size)
            if len(data) != size:
                raise ValueError("The document transfer was interrupted.")
            if self.path == "/return":
                edition, slots = inspect_return(data, int(self.headers.get("X-Base-Length", "0")),
                                                self.headers.get("X-Base-SHA256"), self.server.context)
            else:
                edition, slots = inspect_revision(data, self.server.context)
            if self.path in ("/inspect", "/return"):
                profile = official_profile(data)
                self.reply(200, {"formId": profile["formId"], "edition": profile["edition"],
                                 "fields": slots, "sha256": sha256(data).hexdigest()})
                return
            name = self.headers.get("X-Field", "")
            field = next((item for item in slots if item["name"] == name), None)
            if not field or field["signed"] or field["locked"]:
                raise ValueError("Choose an available signature field.")
            signer = CACSigner(self.server.helper, edition + " " + field["label"], sha256(data).hexdigest(),
                               self.server.bundle, self.headers.get("X-Certificate", ""))
            result = sign_revision(data, name, signer, signer.validation_context, self.server.style,
                                   finalize=self.headers.get("X-Finalize") == "true")
            self.reply(200, result, "application/pdf")
        except (ValueError, CACError) as exc:
            self.reply(422, {"error": str(exc)})
        except (OSError, subprocess.SubprocessError):
            self.reply(503, {"error": "The signing companion is unavailable. Reconnect the card and retry."})
        except Exception:
            self.reply(422, {"error": "Could not qualify this PDF revision for signing."})


def helper_command(executable):
    if executable:
        return [str(executable.resolve(strict=True))]
    script = Path(__file__).resolve().parents[1] / "cac-signing/windows/helper.py"
    return [sys.executable, str(script.resolve(strict=True))]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--helper", type=Path, help="Native CAC executable (Windows uses its bundled helper by default)")
    parser.add_argument("--ca-bundle", required=True, type=Path)
    parser.add_argument("--font", type=Path, help="Installed Times New Roman regular font")
    args = parser.parse_args()
    if not args.helper and sys.platform != "win32":
        parser.error("--helper is required on this platform")
    helper = helper_command(args.helper)
    font = args.font
    if font is None and sys.platform == "win32" and os.environ.get("SystemRoot"):
        font = Path(os.environ["SystemRoot"]) / "Fonts/times.ttf"
    if font is None:
        parser.error("--font is required on this platform")
    origin = urlsplit(args.origin)
    if (origin.scheme not in ("http", "https") or not origin.hostname or origin.username or origin.password
        or origin.path or origin.query or origin.fragment
        or origin.scheme == "http" and origin.hostname not in ("localhost", "127.0.0.1")):
        parser.error("Choose the exact HTTPS DonDocs origin or an HTTP localhost origin.")
    logging.disable(logging.CRITICAL)
    with LoopbackServer(("127.0.0.1", PORT), Handler) as server:
        server.origin, server.helper, server.bundle = args.origin, helper, args.ca_bundle
        server.context = dod_validation_context(args.ca_bundle)
        server.style = certificate_stamp_style(font.resolve(strict=True))
        server.token = secrets.token_urlsafe(32)
        print(f"Pair {server.origin} with this code: {server.token}", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
