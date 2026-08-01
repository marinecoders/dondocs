#!/usr/bin/env python3
"""index.json keeps every row when several writers land at once.

The failure this pins is silent by construction: each writer reads the catalog,
adds its row, and replaces the file. Whoever renames last publishes a snapshot
taken before the others existed, and their rows are gone — no error, no warning,
and both runs report success. Two import-batch.sh runs against disjoint
manifests lost rows 5 times out of 5.

So the workers here are real processes, not threads, and each one holds the
critical section open long enough that they are certainly overlapping. Serialize
correctly and all eight rows survive; drop the lock and one does.

Run: python3 scripts/test-index-json.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import index_json  # noqa: E402

WORKERS = 8
# Long enough that every worker is inside update() while the others start.
HOLD = 0.2

if sys.argv[1:2] == ["--worker"]:
    n = sys.argv[3]

    def add(data):
        time.sleep(HOLD)
        data["templates"].append({"id": f"w{n}", "directory": f"W{n}"})

    index_json.update(add, sys.argv[2])
    sys.exit(0)

failures: list[str] = []


def fresh(directory, templates=()) -> Path:
    path = Path(directory) / "index.json"
    path.write_text(json.dumps({"templates": list(templates)}, indent=2) + "\n")
    return path


with tempfile.TemporaryDirectory() as tmp:
    index = fresh(tmp)
    procs = [subprocess.Popen([sys.executable, __file__, "--worker", str(index), str(i)])
             for i in range(WORKERS)]
    bad = [p.wait() for p in procs]
    if any(bad):
        failures.append(f"worker exit codes {bad}")

    kept = sorted(t["id"] for t in json.loads(index.read_text())["templates"])
    want = sorted(f"w{i}" for i in range(WORKERS))
    if kept != want:
        lost = sorted(set(want) - set(kept))
        failures.append(f"{len(lost)} of {WORKERS} concurrent rows lost: {', '.join(lost)}")

    # A pid-shared temp name is how one run publishes a file another is still
    # writing, so the temps must be gone and must never have collided.
    strays = sorted(f for f in os.listdir(tmp) if ".tmp" in f)
    if strays:
        failures.append(f"temp files left behind: {strays}")

    # Aborting the mutation is how promote refuses to write a form whose index
    # row is missing, so it has to leave the catalog byte-identical.
    before = index.read_bytes()

    class Boom(Exception):
        pass

    def wreck(data):
        data["templates"].clear()
        raise Boom

    try:
        index_json.update(wreck, index)
    except Boom:
        pass
    else:
        failures.append("update() swallowed the exception the mutation raised")
    if index.read_bytes() != before:
        failures.append("a mutation that raised still rewrote index.json")

with tempfile.TemporaryDirectory() as tmp:
    # patch() is what stamp-quality.mts writes through after minutes of
    # rendering: it must touch only the keys it measured, on only the rows it
    # names, and say so when a row it measured is no longer there.
    index = fresh(tmp, [{"directory": "A", "config": True}, {"directory": "B"}])
    missing = index_json.patch({"A": {"fieldLanding": 97}, "Gone": {"fieldLanding": 3}}, index)
    rows = {t["directory"]: t for t in json.loads(index.read_text())["templates"]}
    if missing != ["Gone"]:
        failures.append(f"patch() reported missing rows {missing}, expected ['Gone']")
    if rows["A"].get("fieldLanding") != 97:
        failures.append("patch() did not apply the measured key")
    if rows["A"].get("config") is not True:
        failures.append("patch() dropped a key it was not asked to touch")
    if "fieldLanding" in rows["B"]:
        failures.append("patch() wrote to a row it was not asked to touch")

    # stamp-quality.mts reaches patch() over stdin, so the CLI shape is part of
    # the contract: it must apply what it can and still report the miss.
    cli = subprocess.run([sys.executable, str(ROOT / "scripts" / "index_json.py"),
                          "--patch", str(index)],
                         input='{"B": {"fieldLanding": 12}, "Gone": {}}',
                         capture_output=True, text=True)
    if cli.returncode == 0 or "Gone" not in cli.stderr:
        failures.append(f"--patch did not report the missing row (rc={cli.returncode}, "
                        f"stderr={cli.stderr.strip()!r})")
    rows = {t["directory"]: t for t in json.loads(index.read_text())["templates"]}
    if rows["B"].get("fieldLanding") != 12:
        failures.append("--patch did not apply the rows it could find")

if failures:
    print(f"FAIL — {len(failures)} problem(s) with index.json writes:")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("OK — concurrent index.json writers all keep their rows")
