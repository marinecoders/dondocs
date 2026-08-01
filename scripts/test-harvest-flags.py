#!/usr/bin/env python3
"""The harvester reads the form author's flags instead of guessing at them.

Three of the four facts a widget carries were being inferred or ignored:

  * ReadOnly (/Ff bit 1) and Hidden / NoView (/F bits 2 and 6) were never read,
    so a locked or invisible widget became a fillable editor field that prints
    onto blank paper — the flattened page does not draw it.
  * Multiline was guessed from `height > 30`, which wraps every tall single-line
    box and leaves every short wrapping one unwrapped. /Ff bit 13 says which.
  * A row-group column dropped the /Opt list and the required bit it harvested,
    so a reviewer reading form.json could not tell a dropdown column from a
    free-text one.

Driven through the real flatten + harvest, because these are read out of a live
PDF; skips loudly if the toolchain is absent.

Run: python3 scripts/test-harvest-flags.py
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
TEMPLATES = ROOT / "public" / "templates"

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
    print(f"SKIP — needs {', '.join(missing)}")
    sys.exit(0)

failures: list[str] = []


def check(cond, message):
    if not cond:
        failures.append(message)


READONLY = 1          # /Ff bit 1
MULTILINE = 1 << 12   # /Ff bit 13
HIDDEN = 1 << 1       # /F  bit 2
NOVIEW = 1 << 5       # /F  bit 6
PRINT = 1 << 2        # /F  bit 3 — what an ordinary widget carries


def widget(w, page, name, rect, ff=0, f=PRINT, ft="/Tx", opt=None, tooltip=None):
    field = DictionaryObject()
    field.update({
        NameObject("/Type"): NameObject("/Annot"),
        NameObject("/Subtype"): NameObject("/Widget"),
        NameObject("/FT"): NameObject(ft),
        NameObject("/T"): TextStringObject(name),
        NameObject("/Rect"): ArrayObject([FloatObject(v) for v in rect]),
        NameObject("/F"): NumberObject(f),
        NameObject("/Ff"): NumberObject(ff),
    })
    if tooltip:
        field[NameObject("/TU")] = TextStringObject(tooltip)
    if opt:
        field[NameObject("/Opt")] = ArrayObject([TextStringObject(o) for o in opt])
    ref = w._add_object(field)
    field[NameObject("/P")] = page.indirect_reference
    return ref


def build(path: Path) -> None:
    """One page carrying: an ordinary field, a read-only one, a hidden one, a
    no-view one, a tall single-line box, a short wrapping box, and a five-row
    roster whose one column is a required dropdown."""
    w = PdfWriter()
    page = w.add_blank_page(width=612, height=792)
    stream = DecodedStreamObject()
    stream.set_data(b"0 0 0 rg\n72 760 300 2 re f\n")
    page[NameObject("/Contents")] = w._add_object(stream)

    refs = [
        widget(w, page, "plain", (72, 700, 272, 714), tooltip="Plain"),
        widget(w, page, "lockedTotal", (72, 680, 272, 694), ff=READONLY, tooltip="Computed total"),
        widget(w, page, "hiddenVersion", (72, 660, 272, 674), f=HIDDEN, tooltip="Version"),
        widget(w, page, "noViewStamp", (72, 640, 272, 654), f=PRINT | NOVIEW, tooltip="Stamp"),
        # 60pt tall, and the author did NOT mark it multiline.
        widget(w, page, "tallSingle", (72, 560, 272, 620), tooltip="Tall single line"),
        # 14pt tall, and the author DID.
        widget(w, page, "shortWrap", (72, 530, 272, 544), ff=MULTILINE, tooltip="Short wrapping"),
    ]
    # A roster: five rows of one required /Ch column.
    for i in range(5):
        top = 400 - i * 20
        refs.append(widget(w, page, f"gradeRow{i + 1}", (72, top, 172, top + 14),
                           ff=2, ft="/Ch", opt=["Pass", "Fail"], tooltip="Grade"))
    page[NameObject("/Annots")] = ArrayObject(refs)
    acro = DictionaryObject()
    acro.update({NameObject("/Fields"): ArrayObject(refs)})
    w._root_object[NameObject("/AcroForm")] = w._add_object(acro)
    with open(path, "wb") as fh:
        w.write(fh)


folder = TEMPLATES / "ZZFLAG - Widget Flags"
src = Path(tempfile.mkdtemp()) / "src.pdf"
build(src)
try:
    folder.mkdir(parents=True, exist_ok=True)
    flat = subprocess.run([str(ROOT / "scripts" / "flatten-navmc-form.sh"), str(src), str(folder)],
                          capture_output=True, text=True)
    harv = subprocess.run([sys.executable, str(ROOT / "scripts" / "harvest-fields.py"),
                           str(src), folder.name], capture_output=True, text=True)
    if flat.returncode != 0 or harv.returncode != 0:
        failures.append(f"flatten/harvest failed — {(flat.stderr + harv.stderr).strip()[:200]}")
        cfg = {"fields": {}, "rowGroups": {}}
    else:
        cfg = json.loads((folder / "form.draft.json").read_text())

    fields = cfg.get("fields", {})

    # --- locked and invisible widgets are not offered as fillable ------------
    for key, why in (("lockedTotal", "read-only"), ("hiddenVersion", "hidden"),
                     ("noViewStamp", "no-view")):
        check(key not in fields, f"a {why} widget was emitted as a fillable field")
    check("plain" in fields, "an ordinary widget was skipped along with the flagged ones")
    # Skipping must be loud: three fields vanishing quietly is the same class of
    # bug as the ones this pipeline keeps producing.
    warned = harv.stdout + harv.stderr
    check("WARN" in warned and "read-only or hidden" in warned,
          f"the skipped widgets were not reported: {warned.strip()[:200]}")

    # --- multiline comes from the flag, not the box height -------------------
    check(fields.get("tallSingle", {}).get("multiline") is not True,
          "a 60pt box the author did not mark multiline was made to wrap")
    check(fields.get("shortWrap", {}).get("multiline") is True,
          "a 14pt box the author DID mark multiline was left single-line")

    # --- a row-group column keeps what it harvested --------------------------
    groups = cfg.get("rowGroups") or {}
    check(len(groups) == 1, f"the 5-row roster produced {len(groups)} row groups")
    column = next(iter(next(iter(groups.values()), {}).get("columns", {}).values()), {})
    check(column.get("options") == ["Pass", "Fail"],
          f"the column dropped its /Opt list: {column.get('options')}")
    check(column.get("required") is True, "the column dropped its required bit")
finally:
    shutil.rmtree(folder, ignore_errors=True)

if failures:
    print(f"FAIL — {len(failures)} flag(s) read wrong:")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("OK — locked/hidden widgets skipped loudly, multiline and column facts read from the form")
