#!/usr/bin/env python3
"""Promoting over a reviewed form.json keeps the review, and writes nothing
until the catalog row is found.

Both failures were silent and both reported success. REHARVEST=1 preserved
exactly one thing, the top-level label, and wrote the fresh draft whole: every
corrected field label, hand-set required/multiline/options, regrouped section
and tuned row group reverted, with failed=0 at the end. And promote wrote
form.json BEFORE it looked for the index row, so the "hard error, not a silent
orphan" path produced a hard error AND an orphan — which the resume guard then
skipped forever, because it keyed on the file existing.

Run: python3 scripts/test-promote-merge.py
"""
from __future__ import annotations

import contextlib
import io
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import promote_form  # noqa: E402

failures: list[str] = []

# A draft as the harvester emits it: raw labels, no required bits, no options,
# one flat section, and boxes that moved since the last harvest.
DRAFT = {
    "id": "navmc9999",
    "label": "NAVMC9999 - Widget Request",
    "directory": "NAVMC9999 - Widget Request",
    "pages": ["page1.pdf"],
    "sections": [{"title": "Fields", "fields": ["name", "rank", "newbie"]}],
    "fields": {
        "name": {"type": "text", "label": "TextField1", "page": 1,
                 "box": {"left": 10, "top": 700, "width": 100, "height": 12}},
        "rank": {"type": "text", "label": "TextField2", "page": 1,
                 "box": {"left": 10, "top": 680, "width": 100, "height": 12}},
        "newbie": {"type": "text", "label": "TextField3", "page": 1,
                   "box": {"left": 10, "top": 660, "width": 100, "height": 12}},
    },
    "rowGroups": {
        "roster": {"title": "Roster", "page": 1, "count": 5, "rowStride": 14,
                   "columns": {
                       "who": {"type": "text", "label": "Cell1", "page": 1,
                               "box": {"left": 10, "top": 500, "width": 80, "height": 12}},
                   }},
    },
}

# The same form after a human went through it.
LIVE = {
    "id": "navmc9999",
    "label": "NAVMC 9999 - Widget Request",
    "directory": "NAVMC9999 - Widget Request",
    "pages": ["page1.pdf"],
    "sections": [
        {"title": "Marine", "fields": ["name", "rank"], "editor": "list"},
        {"title": "Retired", "fields": ["dropped"]},
    ],
    "fields": {
        "name": {"type": "text", "label": "Full name", "page": 1, "required": True,
                 "box": {"left": 11, "top": 701, "width": 101, "height": 13}},
        "rank": {"type": "choice", "label": "Rank", "page": 1, "options": ["Cpl", "Sgt"],
                 "box": {"left": 11, "top": 681, "width": 101, "height": 13}},
        "dropped": {"type": "text", "label": "Hand-added remark", "page": 1,
                    "box": {"left": 11, "top": 400, "width": 101, "height": 13}},
    },
    "rowGroups": {
        "roster": {"title": "Watch roster", "page": 1, "count": 5, "rowStride": 14,
                   "editor": "grid",
                   "columns": {
                       "who": {"type": "text", "label": "Name", "page": 1, "required": True,
                               "box": {"left": 11, "top": 501, "width": 81, "height": 13}},
                   }},
    },
}


def check(cond, message):
    if not cond:
        failures.append(message)


merged, warnings = promote_form.merge(LIVE, DRAFT)
warned = " ".join(warnings)

# --- the review survives ----------------------------------------------------
check(merged["label"] == "NAVMC 9999 - Widget Request", "the display label reverted")
check(merged["fields"]["name"]["label"] == "Full name",
      f"a corrected field label reverted to {merged['fields']['name']['label']!r}")
check(merged["fields"]["name"].get("required") is True, "a hand-set required bit was dropped")
check(merged["fields"]["rank"].get("options") == ["Cpl", "Sgt"], "hand-set options were dropped")
check(merged["fields"]["rank"]["type"] == "choice", "a corrected field type reverted")
check([s["title"] for s in merged["sections"]][:2] == ["Marine", "Retired"],
      "hand-arranged sections were replaced by the draft's")
check(merged["rowGroups"]["roster"]["title"] == "Watch roster", "a row group title reverted")
check(merged["rowGroups"]["roster"]["columns"]["who"]["label"] == "Name",
      "a row group column label reverted")

# --- but the geometry updates ------------------------------------------------
check(merged["fields"]["name"]["box"] == DRAFT["fields"]["name"]["box"],
      "the field box did not take the fresh harvest")
check(merged["rowGroups"]["roster"]["columns"]["who"]["box"] == {
          "left": 10, "top": 500, "width": 80, "height": 12},
      "the row group column box did not take the fresh harvest")

# --- nothing is deleted, and everything unexpected is said out loud ----------
check("dropped" in merged["fields"], "a field the harvest no longer sees was deleted")
check("dropped" in warned and "no longer finds it" in warned,
      f"keeping a vanished field was not warned about: {warnings}")
check("newbie" in merged["fields"], "a newly harvested field was not added")
listed = {k for s in merged["sections"] for k in s["fields"]}
check("newbie" in listed, "a newly harvested field is in no section — the editor would never show it")
check("newbie" in warned, f"a newly harvested field was not warned about: {warnings}")

# A fresh import has nothing to preserve and must come through untouched.
check(promote_form.merge({}, DRAFT)[0]["fields"].keys() == DRAFT["fields"].keys(),
      "merging onto an empty config lost fields")

# A column kept past its harvest must not be left on a page the group left, or
# assertFormConfig rejects the whole config and the form vanishes from the app.
moved = json.loads(json.dumps(DRAFT))
moved["pages"] = ["page1.pdf", "page2.pdf"]
moved["rowGroups"]["roster"]["page"] = 2
moved["rowGroups"]["roster"]["columns"] = {"other": moved["rowGroups"]["roster"]["columns"]["who"]}
moved["rowGroups"]["roster"]["columns"]["other"]["page"] = 2
kept, _ = promote_form.merge(LIVE, moved)
check(kept["rowGroups"]["roster"]["columns"]["who"]["page"] == 2,
      "a kept column was left on the group's old page, which invalidates the config")


# --- ordering: nothing is written when the catalog row is missing ------------
def scaffold(root, row=True, live=None):
    """A templates dir with one folder, its draft, and optionally its index row."""
    templates = Path(root) / "templates"
    folder = templates / DRAFT["directory"]
    folder.mkdir(parents=True)
    (folder / "form.draft.json").write_text(json.dumps(DRAFT))
    if live is not None:
        (folder / "form.json").write_text(json.dumps(live))
    rows = [{"id": "navmc9999", "directory": DRAFT["directory"]}] if row else []
    (templates / "index.json").write_text(json.dumps({"templates": rows}, indent=2) + "\n")
    return templates, folder


with tempfile.TemporaryDirectory() as tmp:
    templates, folder = scaffold(tmp, row=False)
    try:
        promote_form.promote(DRAFT["directory"], templates=templates)
    except SystemExit as exc:
        check("no index.json entry" in str(exc), f"unexpected refusal: {exc}")
    else:
        failures.append("promote accepted a form with no index.json row")
    check(not (folder / "form.json").exists(),
          "promote wrote form.json before checking the index row — that orphan is "
          "what the resume guard then skips forever")

with tempfile.TemporaryDirectory() as tmp:
    templates, folder = scaffold(tmp, row=True, live=LIVE)
    with contextlib.redirect_stdout(io.StringIO()):  # its WARN lines are asserted above
        promote_form.promote(DRAFT["directory"], "Personnel & Records", templates=templates)
    row = json.loads((templates / "index.json").read_text())["templates"][0]
    check(row.get("config") is True, "promote did not flip the index row to config:true")
    check(row.get("category") == "Personnel & Records", "promote did not apply the category")
    written = json.loads((folder / "form.json").read_text())
    check(written["label"] == LIVE["label"], "the promoted file reverted the display label")
    check(written["fields"]["name"]["box"] == DRAFT["fields"]["name"]["box"],
          "the promoted file did not take the fresh geometry")
    # Assert the review through promote() and not only through merge(): the
    # first version of this test held while promote quietly bypassed the merge.
    check(written["fields"]["name"]["label"] == "Full name",
          "the promoted file reverted a corrected field label")
    check(written["fields"]["rank"].get("options") == ["Cpl", "Sgt"],
          "the promoted file dropped hand-set options")
    check("dropped" in written["fields"], "the promoted file deleted a hand-added field")


# --- the resume guard treats an orphan as unfinished, not as done ------------
def batch_says(folder_name, form_json, config_row):
    """Run import-batch.sh over a one-line manifest for a folder that already
    exists, in a throwaway copy of the repo, and return what it decided.

    The cache is pre-seeded with a non-PDF so the run never touches the network:
    a folder the guard calls finished is skipped before the fetch, and one it
    calls unfinished stops at the download check a line later."""
    work = Path(tempfile.mkdtemp())
    shutil.copytree(ROOT / "scripts", work / "scripts")
    (work / "docs").mkdir()
    templates = work / "public" / "templates"
    (templates / folder_name).mkdir(parents=True)
    if form_json:
        (templates / folder_name / "form.json").write_text("{}")
    (templates / "index.json").write_text(json.dumps(
        {"templates": [{"id": "x", "directory": folder_name, "config": config_row}]}) + "\n")
    manifest = work / "m.tsv"
    manifest.write_text(f"1\t{folder_name}\t-\t-\n")
    cache = work / "cache"
    cache.mkdir()
    (cache / "1.pdf").write_text("not a pdf")
    out = subprocess.run(["bash", str(work / "scripts" / "import-batch.sh"),
                          str(manifest), str(cache)],
                         capture_output=True, text=True, timeout=120)
    shutil.rmtree(work, ignore_errors=True)
    return out.stdout


done = batch_says("ZZ Finished", form_json=True, config_row=True)
check("skipped=1" in done, f"a finished form was not skipped: {done!r}")

orphan = batch_says("ZZ Orphan", form_json=True, config_row=False)
check("skipped=1" not in orphan,
      "form.json with no config row was reported as skipped — the folder a crashed "
      f"promote leaves behind is unreachable forever: {orphan!r}")
check("[orphan]" in orphan, f"the orphan was not called out: {orphan!r}")

if failures:
    print(f"FAIL — {len(failures)} problem(s) promoting a draft:")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("OK — promote keeps the review, updates the geometry, and writes only after the row is found")
