#!/usr/bin/env python3
"""A checkbox checklist is not a one-column table.

Row-group detection gates on the name family, three or more members, a shared
left edge and a constant vertical stride — and never on the field TYPE or the
column COUNT. A vertical checklist clears every one of those, so it collapsed
into an anonymous row group that kept row 1's box and row 1's caption and erased
the other nine from both `sections` and `fields`.

Nothing warned. boxes.draft.json is written before grouping runs, so it still
listed all ten and the overlay PNGs still drew all ten — the loss was invisible
in the harvester's own evidence. And section_editor(), which exists precisely to
tag a checkbox checklist, only ever saw the leftovers.

Part 1 drives detect_row_groups directly. Part 2 puts ten checkbox widgets
through the real flatten + harvest and reads the config the app would load;
it skips loudly if the PDF toolchain is absent.

Run: python3 scripts/test-rowgroups.py
"""
from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("harvest_fields", ROOT / "scripts" / "harvest-fields.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
detect_row_groups = mod.detect_row_groups

failures: list[str] = []


def check(cond, message):
    if not cond:
        failures.append(message)


def stack(prefix, count, left, top, ftype, stride=20.0, width=12.0, height=12.0):
    """`count` fields in one column, named the way dedupe() names them."""
    return {f"{prefix}{i + 1}": {"type": ftype, "description": "", "left": left,
                                 "top": top - i * stride, "width": width, "height": height}
            for i in range(count)}


# --- 1. the checklist ---------------------------------------------------------
boxes = stack("checkBox", 10, left=72.0, top=700.0, ftype="checkbox")
groups, grouped = detect_row_groups({"page1": dict(boxes)}, {})
check(not groups, f"ten stacked checkboxes were collapsed into a row group: {list(groups)}")
check(not grouped,
      f"{len(grouped)} of 10 checkboxes were erased from the field list: {sorted(grouped)}")

# --- 2. a real roster still groups -------------------------------------------
roster = {**stack("nameRow", 5, left=100.0, top=700.0, ftype="text", width=150.0, height=14.0),
          **stack("rankRow", 5, left=300.0, top=700.0, ftype="text", width=80.0, height=14.0)}
groups, grouped = detect_row_groups({"page1": roster}, {})
check(len(groups) == 1, f"a 2-column 5-row roster produced {len(groups)} row groups")
group = next(iter(groups.values()), {})
check(len(group.get("columns", {})) == 2, f"roster columns: {list(group.get('columns', {}))}")
check(group.get("count") == 5, f"roster row count {group.get('count')} != 5")
check(len(grouped) == 10, f"roster grouped {len(grouped)} keys, expected all 10")

# --- 3. a one-column TEXT stack still groups ---------------------------------
# The refusal is about checkboxes, not about single columns: a stack of remarks
# lines is a real one-column table and must keep grouping.
lines = stack("remarks", 6, left=90.0, top=600.0, ftype="text", width=400.0, height=14.0)
groups, grouped = detect_row_groups({"page1": lines}, {})
check(len(groups) == 1, "a one-column stack of text lines stopped grouping")
check(len(grouped) == 6, f"the text stack grouped {len(grouped)} keys, expected 6")


# --- 4. end to end, through the real harvester -------------------------------
def build_checklist_pdf(path, count=10):
    """One page with `count` stacked checkbox widgets, plus a painted rule so
    the page is not blank."""
    w = PdfWriter()
    page = w.add_blank_page(width=612, height=792)
    stream = DecodedStreamObject()
    stream.set_data(b"0 0 0 rg\n72 740 200 2 re f\n")
    page[NameObject("/Contents")] = w._add_object(stream)

    refs = []
    for i in range(count):
        top = 700 - i * 20
        field = DictionaryObject()
        field.update({
            NameObject("/Type"): NameObject("/Annot"),
            NameObject("/Subtype"): NameObject("/Widget"),
            NameObject("/FT"): NameObject("/Btn"),
            NameObject("/T"): TextStringObject(f"checkBox{i + 1}"),
            NameObject("/TU"): TextStringObject(f"Item {i + 1}"),
            NameObject("/Rect"): ArrayObject([FloatObject(v) for v in
                                              (72, top, 84, top + 12)]),
            NameObject("/F"): NumberObject(4),
        })
        ref = w._add_object(field)
        field[NameObject("/P")] = page.indirect_reference
        refs.append(ref)
    page[NameObject("/Annots")] = ArrayObject(refs)
    acro = DictionaryObject()
    acro.update({NameObject("/Fields"): ArrayObject(refs)})
    w._root_object[NameObject("/AcroForm")] = w._add_object(acro)
    with open(path, "wb") as fh:
        w.write(fh)


missing = [e for e in ("qpdf", "pdftocairo", "pdfseparate", "pdftoppm") if shutil.which(e) is None]
try:
    from pypdf import PdfWriter
    from pypdf.generic import (
        ArrayObject, DecodedStreamObject, DictionaryObject, FloatObject,
        NameObject, NumberObject, TextStringObject,
    )
except ImportError as exc:  # pragma: no cover - environment guard
    missing.append(str(exc))

if missing:
    print(f"SKIP (part 4 only) — needs {', '.join(missing)}")
else:
    folder = ROOT / "public" / "templates" / "ZZROWS - Checklist"
    src = Path(tempfile.mkdtemp()) / "src.pdf"
    build_checklist_pdf(src)
    try:
        folder.mkdir(parents=True, exist_ok=True)
        flat = subprocess.run([str(ROOT / "scripts" / "flatten-navmc-form.sh"), str(src), str(folder)],
                              capture_output=True, text=True)
        harv = subprocess.run([sys.executable, str(ROOT / "scripts" / "harvest-fields.py"),
                               str(src), folder.name], capture_output=True, text=True)
        if flat.returncode != 0 or harv.returncode != 0:
            failures.append(f"flatten/harvest failed — "
                            f"{(flat.stderr + harv.stderr).strip()[:200]}")
        else:
            cfg = json.loads((folder / "form.draft.json").read_text())
            check(len(cfg["fields"]) == 10,
                  f"the harvested config has {len(cfg['fields'])} of 10 checkboxes")
            check("rowGroups" not in cfg,
                  f"the harvested config still has row groups: {list(cfg.get('rowGroups', {}))}")
            editors = [s.get("editor") for s in cfg["sections"]]
            check(editors == ["checklist"],
                  f"the checklist section was tagged {editors}, not ['checklist'] — "
                  "section_editor only ever saw the leftovers")
    finally:
        shutil.rmtree(folder, ignore_errors=True)

if failures:
    print(f"FAIL — {len(failures)} problem(s) in row-group detection:")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("OK — checklists stay fields, rosters still group")
