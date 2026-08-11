#!/usr/bin/env python3
"""Promote a harvested draft to the live form.json and flip its catalog row.

    python3 scripts/promote_form.py <folder> [category]

Two rules, both learned from losing work:

**The committed form.json wins on meaning; the draft wins only on geometry.**
A re-harvest used to write the fresh draft whole, preserving exactly one thing —
the top-level label. Every corrected field label, hand-set required/multiline/
options, regrouped section, tuned rowGroup and hand-added field reverted, and the
batch reported failed=0. So a field present in both keeps everything it had and
takes only `box` and `page` from the draft. A field the draft no longer sees is
KEPT and warned about, never deleted; deleting form.json is how you ask for a
genuinely fresh import.

**Nothing is written until the catalog row is found.** form.json used to be
written first and the missing-row check run after, so the hard error also left an
orphan — and because the resume guard keyed on form.json existing, that folder
was then skipped forever in normal mode and could not register in re-harvest
mode. Unreachable until a human deleted the file.

Warnings print as `WARN:` lines; import-batch.sh counts and surfaces them.
"""
from __future__ import annotations

import copy
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import index_json  # noqa: E402

TEMPLATES = ROOT / "public" / "templates"

# What the harvester measures. Everything else about a field — its label, its
# required bit, its options, its group — is a human judgement.
GEOMETRY = ("box", "page")
# Derived from the folder on every run, so the draft is authoritative for these.
DERIVED = ("id", "directory", "pages")


def merge_field(prev, draft):
    merged = dict(prev)
    for key in GEOMETRY:
        if key in draft:
            merged[key] = draft[key]
    return merged


def merge(prev, draft):
    """Overlay the draft's geometry onto the committed config.

    Returns `(config, warnings)`. Every divergence between the two is either
    applied silently (geometry), or kept and warned about (anything the draft
    stopped seeing) — nothing is dropped on the floor.
    """
    warnings: list[str] = []
    out = copy.deepcopy(prev)
    for key in DERIVED:
        if key in draft:
            out[key] = draft[key]

    draft_fields = draft.get("fields") or {}
    fields = out.get("fields") or {}
    out["fields"] = fields
    for key, f in draft_fields.items():
        fields[key] = merge_field(fields[key], f) if key in fields else copy.deepcopy(f)

    # "Keep what the harvest stopped seeing" has one limit: a field on a page the
    # form no longer has. assertFormConfig refuses a page outside 1..len(pages),
    # so keeping it does not preserve one field, it takes the WHOLE form out of
    # the app. A revision that drops a page is the case — it clears the page-1
    # size guard because the pages it kept are the same size. Losing the field
    # beats losing the form, but it is never quiet about it.
    pages = len(out.get("pages") or [])
    for key in list(fields):
        if key in draft_fields:
            continue
        if pages and fields[key].get("page", 1) > pages:
            del fields[key]
            warnings.append(f"WARN: field {key!r} sat on page {prev['fields'][key]['page']} "
                            f"and this revision only has {pages} — DROPPED, because a field "
                            f"past the last page makes the whole form fail to load")
        else:
            warnings.append(f"WARN: field {key!r} is in form.json but this harvest no "
                            f"longer finds it — kept, and its box may be stale")
    for s in out.get("sections") or []:
        s["fields"] = [k for k in s["fields"] if k in fields]

    # A field nothing lists is a field the editor never shows, so a newly
    # harvested one is filed under the section the draft put it in.
    draft_section = {k: s for s in draft.get("sections") or [] for k in s["fields"]}
    listed = {k for s in out.get("sections") or [] for k in s["fields"]}
    for key in draft_fields:
        if key in listed:
            continue
        src = draft_section.get(key)
        title = src["title"] if src else "Harvested"
        # Not setdefault: a hand-edited "sections": null is a key that exists
        # with no list behind it, and setdefault would hand back the None.
        sections = out.get("sections") or []
        out["sections"] = sections
        target = next((s for s in sections if s["title"] == title), None)
        if target is None:
            target = {"title": title, "fields": []}
            if src and src.get("editor"):
                target["editor"] = src["editor"]
            sections.append(target)
        target["fields"].append(key)
        warnings.append(f"WARN: this harvest found a new field {key!r}; filed under "
                        f"section {title!r} — check where it belongs")

    draft_groups = draft.get("rowGroups") or {}
    prev_groups = out.get("rowGroups") or {}
    if draft_groups or prev_groups:
        groups = copy.deepcopy(prev_groups)
        for gkey, g in draft_groups.items():
            if gkey not in groups:
                groups[gkey] = copy.deepcopy(g)
                warnings.append(f"WARN: this harvest found a new row group {gkey!r}")
                continue
            target = groups[gkey]
            for key in ("page", "count", "rowStride"):
                if key in g:
                    target[key] = g[key]
            columns = target.setdefault("columns", {})
            draft_columns = g.get("columns") or {}
            for ckey, c in draft_columns.items():
                columns[ckey] = (merge_field(columns[ckey], c) if ckey in columns
                                 else copy.deepcopy(c))
            for ckey in columns:
                if ckey not in draft_columns:
                    warnings.append(f"WARN: row group {gkey!r} column {ckey!r} is in "
                                    f"form.json but this harvest no longer finds it — kept")
                    # A kept column on the old page would make the whole config
                    # fail assertFormConfig, taking the form out of the app.
                    columns[ckey]["page"] = target["page"]
        for gkey in prev_groups:
            if gkey not in draft_groups:
                warnings.append(f"WARN: row group {gkey!r} is in form.json but this "
                                f"harvest no longer finds it — kept")
        out["rowGroups"] = groups

    return out, warnings


def write_atomic(path, obj):
    tmp = f"{path}.tmp.{os.getpid()}"
    with open(tmp, "w") as fh:
        json.dump(obj, fh, indent=2)
        fh.write("\n")
    os.replace(tmp, path)


def promote(folder, category="", templates=TEMPLATES):
    directory = Path(templates) / folder
    with open(directory / "form.draft.json") as fh:
        draft = json.load(fh)

    index_path = Path(templates) / "index.json"
    with open(index_path) as fh:
        rows = json.load(fh)["templates"]
    if not any(t["directory"] == folder for t in rows):
        sys.exit(f"no index.json entry for {folder!r} (import-navmc.sh did not register it)")

    config, warnings = draft, []
    live = directory / "form.json"
    if live.exists():
        try:
            with open(live) as fh:
                prev = json.load(fh)
        except (json.JSONDecodeError, OSError) as exc:
            warnings = [f"WARN: existing form.json is unreadable ({exc}); "
                        f"the fresh draft replaces it"]
        else:
            config, warnings = merge(prev, draft)
    for line in warnings:
        print(line)
    write_atomic(live, config)

    def commit_row(data):
        found = False
        for t in data["templates"]:
            if t["directory"] == folder:
                t["config"] = True
                if category:
                    t["category"] = category
                found = True
        if not found:
            raise SystemExit(f"index.json row for {folder!r} vanished mid-promote")

    index_json.update(commit_row, index_path)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: promote_form.py <folder> [category]")
    promote(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "")
