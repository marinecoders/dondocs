"""Native connection consent and temporary grants for the configured web origin."""
import os
import secrets
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

SESSION_SECONDS = 15 * 60
MAX_SESSION_SECONDS = 4 * 60 * 60


@dataclass
class Grant:
    expires: float
    deadline: float


class Sessions:
    """The loopback HTTP server handles requests serially."""
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.grants = {}
        self.next_prompt = 0

    def request(self, origin, approve):
        now = self.clock()
        self.grants = {key: grant for key, grant in self.grants.items() if grant.expires > now}
        if now < self.next_prompt or len(self.grants) >= 16:
            return 429, {"error": "Please wait before requesting another connection."}
        try:
            granted = approve(origin)
        finally:
            self.next_prompt = self.clock() + 2
        if not granted:
            return 403, {"error": "Connection declined. Choose Connect CAC to try again."}
        token = secrets.token_urlsafe(32)
        issued = self.clock()
        self.grants[token] = Grant(issued + SESSION_SECONDS, issued + MAX_SESSION_SECONDS)
        return 200, {"token": token, "expiresIn": SESSION_SECONDS, "maxAgeSeconds": MAX_SESSION_SECONDS}

    def authorized(self, token):
        now = self.clock()
        grant = self.grants.get(token)
        if grant is None or grant.expires <= now:
            self.grants.pop(token, None)
            return False
        grant.expires = min(now + SESSION_SECONDS, grant.deadline)
        return True

    def disconnect(self, token):
        self.grants.pop(token, None)


def approve_connection(origin):
    # The site comes from the bridge's startup configuration, never the request body.
    text = (f"Allow {origin} to connect to the DonDocs signing companion?\n\n"
            "Each signature still requires your approval. The connection expires after 15 minutes of inactivity or four hours from approval.")
    if sys.platform == "darwin":
        program = ('on run argv\n'
                   'set answer to display dialog (item 1 of argv) with title "DonDocs signing companion" '
                   'buttons {"Cancel", "Allow"} default button "Cancel" cancel button "Cancel" giving up after 60\n'
                   'if not (gave up of answer) then return button returned of answer\nend run')
        result = subprocess.run(["/usr/bin/osascript", "-e", program, text], capture_output=True, timeout=65)
    elif sys.platform == "win32":
        # Use the interactive desktop. The argument is data, not PowerShell source.
        script = ("Add-Type -AssemblyName System.Windows.Forms; "
                  "$choice = [System.Windows.Forms.MessageBox]::Show($env:DONDOCS_CONSENT_TEXT,"
                  "'DonDocs signing companion','YesNo','Question','Button2'); "
                  "if ($choice -eq 'Yes') { Write-Output 'Allow' }")
        powershell = Path(os.environ["SystemRoot"], "System32/WindowsPowerShell/v1.0/powershell.exe")
        result = subprocess.run([powershell, "-NoProfile", "-NonInteractive", "-Command", script],
                                env={**os.environ, "DONDOCS_CONSENT_TEXT": text}, capture_output=True, timeout=65)
    else:
        raise OSError("Native signing approval is unavailable on this platform.")
    if result.returncode:
        if sys.platform == "darwin" and b"(-128)" in result.stderr:
            return False
        raise OSError("Could not show the native connection prompt.")
    return result.stdout.strip() == b"Allow"
