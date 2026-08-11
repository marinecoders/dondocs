#!/usr/bin/env python3
"""Serialized read-modify-write of public/templates/index.json.

Every writer of the catalog does read -> mutate -> replace. Done with a bare
os.replace and no lock, the last writer's whole snapshot becomes the file and
any row a concurrent run added in between is simply gone — reproduced 5 times
out of 5 with two import-batch.sh runs against disjoint manifests. The two shell
writers also shared one temp path, so a run could publish a file another was
still writing, defeating the atomicity their comments claimed.

update() closes both: an exclusive flock on a sidecar, a re-read INSIDE the lock
so the snapshot cannot be stale, a pid-unique temp, then os.replace. The
critical section is a few milliseconds of JSON, so a normal single run never
notices it is there.

The browser side has always worked this way — docs/STORAGE.md's "concurrent
writers serialize instead of losing an update", implemented with
navigator.locks. The shell pipeline never had a mechanism at all.

Import it (`sys.path.insert(0, os.environ['SCRIPTS']); import index_json`), or
call the one CLI form used by stamp-quality.mts, which cannot take a flock from
Node and so hands the write back here:

    python3 scripts/index_json.py --patch <<< '{"<directory>": {"fieldLanding": 97}}'
"""
from __future__ import annotations

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
            # Leave no half-written temp for the next run to trip over.
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        return result
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()


def patch(rows, index_path=INDEX):
    """Merge `{directory: {key: value}}` into the matching rows.

    Only the named keys of the named rows change, so a caller that spent minutes
    computing them cannot revert a row someone else touched meanwhile. Returns
    the directories it could not find.
    """
    def apply(data):
        seen = set()
        for t in data["templates"]:
            fields = rows.get(t["directory"])
            if fields is not None:
                t.update(fields)
                seen.add(t["directory"])
        return sorted(set(rows) - seen)

    return update(apply, index_path)


if __name__ == "__main__":
    if sys.argv[1:2] != ["--patch"]:
        sys.exit('usage: index_json.py --patch [index.json]  '
                 '(reads {"<directory>": {<fields to merge>}} on stdin)')
    missing = patch(json.load(sys.stdin), sys.argv[2] if len(sys.argv) > 2 else INDEX)
    if missing:
        sys.exit(f"index.json has no row for: {', '.join(missing)}")
