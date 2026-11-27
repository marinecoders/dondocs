"""Loopback adapter between the DonDocs form workspace and the standalone CAC CLI."""
import argparse
import json
import logging
import subprocess
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from connection import Sessions, approve_connection
from appearance import certificate_stamp_style
from cac_signer import CACError, CACSigner, dod_validation_context, eligible_certificate
from official_pdf import official_profile, inspect_return, inspect_revision, sign_revision

PORT = 47993
MAX_PDF = 20 * 1024 * 1024


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
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Field, X-Certificate, X-Finalize, X-Base-Length, X-Base-SHA256, X-DonDocs-Connect")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def allowed(self):
        return (self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}"
                and self.headers.get("Origin") == self.server.origin
                and self.path in ("/session", "/disconnect", "/identities", "/inspect", "/sign", "/return"))

    def do_OPTIONS(self):
        self.reply(200 if self.allowed() else 403, {})

    def do_POST(self):
        if not self.allowed():
            self.reply(403, {"error": "This DonDocs address is not allowed."})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size > MAX_PDF or size < 0 or "Transfer-Encoding" in self.headers:
                self.reply(413, {"error": "Choose a PDF up to 20 MB."})
                return
            if self.path == "/session":
                if size or self.headers.get("X-DonDocs-Connect") != "1":
                    self.reply(400, {"error": "Invalid connection request."})
                    return
                try:
                    status, body = self.server.sessions.request(self.server.origin, approve_connection)
                except (OSError, subprocess.SubprocessError):
                    self.reply(503, {"error": "Could not complete approval. Open the signing companion in your desktop session and retry."})
                    return
                self.reply(status, body)
                return
            auth = self.headers.get("Authorization", "")
            token = auth.removeprefix("Bearer ")
            if token == auth or not self.server.sessions.authorized(token):
                self.reply(401, {"error": "Your signing connection expired. Choose Connect CAC again."})
                return
            if self.path == "/disconnect":
                if size:
                    raise ValueError("Unexpected disconnect request body.")
                self.server.sessions.disconnect(token)
                self.reply(200, {})
                return
            if self.path == "/identities":
                if size:
                    raise ValueError("Unexpected certificate request body.")
                cmd = subprocess.run([self.server.helper, "list"], capture_output=True, check=True, timeout=15)
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--helper", required=True, type=Path)
    parser.add_argument("--ca-bundle", required=True, type=Path)
    parser.add_argument("--font", required=True, type=Path)
    args = parser.parse_args()
    origin = urlsplit(args.origin)
    if (origin.scheme not in ("http", "https") or not origin.hostname or origin.username or origin.password
        or origin.path or origin.query or origin.fragment
        or origin.scheme == "http" and origin.hostname not in ("localhost", "127.0.0.1")):
        parser.error("Choose the exact HTTPS DonDocs origin or an HTTP localhost origin.")
    logging.disable(logging.CRITICAL)
    with HTTPServer(("127.0.0.1", PORT), Handler) as server:
        server.origin, server.helper, server.bundle = args.origin, args.helper.resolve(strict=True), args.ca_bundle
        server.context = dod_validation_context(args.ca_bundle)
        server.style = certificate_stamp_style(args.font.resolve(strict=True))
        server.sessions = Sessions()
        print(f"Ready for connection requests from {server.origin}.", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
