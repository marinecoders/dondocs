#!/usr/bin/env python3
"""Serialize catalog updates with flock and atomically replace index.json.

Read inside the lock to preserve concurrent writers' changes. Publication uses
the CLI to patch selected fields without replacing a stale catalog snapshot:

    python3 scripts/index_json.py --patch <<< '{"<directory>": {"status": "retired"}}'
"""
from __future__ import annotations

from contextlib import suppress
import fcntl
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "public" / "templates" / "index.json"
# Vite copies public/ into dist/ verbatim, so a sidecar next to the catalog
# ships to every user as a stray zero-byte file. The repo's own lock sits at the
# repo root; any other index (the tests) locks beside itself.
REPO_LOCK = ROOT / ".index-json.lock"


def lock_for(index_path) -> Path:
    path = Path(index_path).resolve()
    return REPO_LOCK if path == INDEX.resolve() else Path(f"{path}.lock")


def update(mutate, index_path=INDEX):
    """Apply `mutate(data)` to the catalog under an exclusive lock.

    `mutate` receives the catalog as just read from disk and edits it in place;
    whatever it returns is handed back to the caller. Raising leaves index.json
    exactly as it was, which is what lets a caller validate a row and abort
    before anything on disk has moved.
    """
    lock = open(lock_for(index_path), "a+")
    index_path = str(index_path)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX)
        with open(index_path) as fh:
            data = json.load(fh)
        result = mutate(data)
        tmp = f"{index_path}.tmp.{os.getpid()}"
        try:
            with open(tmp, "w") as fh:
                json.dump(data, fh, indent=2)
                fh.write("\n")
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, index_path)
        except BaseException:
            # Best-effort cleanup must preserve the original write failure.
            with suppress(OSError):
                os.unlink(tmp)
            raise
        return result
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()


def patch(rows, index_path=INDEX, expected=None):
    """Merge `{directory: {key: value}}` into the matching rows.

    Only the named keys of the named rows change, so a caller that spent minutes
    computing them cannot revert a row someone else touched meanwhile. Returns
    the directories it could not find.
    """
    def apply(data):
        seen = set()
        if expected is not None:
            for directory, revision in expected.items():
                matches = [t for t in data["templates"] if t.get("sourceDirectory", t["directory"]) == directory]
                if len(matches) != 1:
                    raise ValueError(f"Expected one catalog row for {directory}")
                current = matches[0].get("definitionRevision")
                target = rows[directory].get("definitionRevision")
                if current != revision and current != target:
                    raise ValueError(f"Stale candidate for {directory}: catalog revision changed; prepare and review again")
        for t in data["templates"]:
            fields = rows.get(t.get("sourceDirectory", t["directory"]))
            if fields is not None:
                t.update(fields)
                seen.add(t.get("sourceDirectory", t["directory"]))
        return sorted(set(rows) - seen)

    return update(apply, index_path)


if __name__ == "__main__":
    if sys.argv[1:2] not in (["--patch"], ["--compare-patch"]):
        sys.exit('usage: index_json.py --patch [index.json]  '
                 '(reads {"<directory>": {<fields to merge>}} on stdin)')
    payload = json.load(sys.stdin)
    compare = sys.argv[1] == "--compare-patch"
    missing = patch(payload["rows"] if compare else payload,
                    sys.argv[2] if len(sys.argv) > 2 else INDEX,
                    payload["expected"] if compare else None)
    if missing:
        sys.exit(f"index.json has no row for: {', '.join(missing)}")
