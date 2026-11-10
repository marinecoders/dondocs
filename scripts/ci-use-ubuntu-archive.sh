#!/usr/bin/env bash
set -euo pipefail

# HTTP mirror retries can exhaust the job before tests start. Preserve source
# priorities and repository settings, but use HTTPS for Ubuntu downloads.
# An optional APT directory lets the fixture tests run without changing the host.
sudo python3 - "${1:-/etc/apt}" <<'PY'
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
if not root.is_dir():
    raise SystemExit(f"APT directory does not exist: {root}")

ubuntu_url = re.compile(
    r"https?://((?:[a-z0-9-]+\.)?archive\.ubuntu\.com|security\.ubuntu\.com|ports\.ubuntu\.com)(?=[:/\s]|$)"
)
files = [root / "sources.list", *root.glob("apt-mirrors*.txt"),
         *root.glob("sources.list.d/*.list"), *root.glob("sources.list.d/*.sources")]
changed = 0
for path in files:
    if not path.is_file():
        continue
    source = path.read_text()
    updated = ubuntu_url.sub(
        lambda match: "https://" + match[1].replace("azure.archive.ubuntu.com", "archive.ubuntu.com"), source
    )
    if updated != source:
        path.write_text(updated)
        changed += 1

# Runner configuration can sort after numeric prefixes. APT applies the last
# setting for each key, so keep our transport limits after the runner's files.
config = root / "apt.conf.d/zzzz-dondocs-ci-transport"
config.parent.mkdir(exist_ok=True)
config.write_text('Acquire::Retries "2";\nAcquire::http::Timeout "20";\nAcquire::https::Timeout "20";\n')
print(f"Configured Ubuntu HTTPS transport in {changed} APT source files; retries and timeouts are bounded.")
PY

if [[ $# -eq 0 ]]; then
  apt-config dump Acquire::Retries Acquire::http::Timeout Acquire::https::Timeout
fi
