#!/usr/bin/env python3
"""Prepare an import candidate. Review and publish with npm run form-package."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: promote_form.py <folder>")
    if len(sys.argv) > 2 and sys.argv[2].strip():
        subprocess.run([sys.executable, str(ROOT / "scripts/index_json.py"), "--patch", str(ROOT / "public/templates/index.json")], input=json.dumps({sys.argv[1]: {"category": sys.argv[2].strip()}}), text=True, check=True)
    subprocess.run(["npm", "run", "form-package", "--", "prepare", sys.argv[1]], cwd=ROOT, check=True)
