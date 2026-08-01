#!/usr/bin/env python3
"""Every page is measured against itself, not against page 1.

The harvested boxes were already per-page — place_on_page reads the page it is
handed. Everything built ON those boxes was not: the bounds warning, the
revision guard and the overlay all took page 1's size and applied it to the
whole document. On a form whose pages differ in size that meant

  * the out-of-bounds warning fired on page-2 fields that sit perfectly well on
    page 2, and stayed quiet about ones that really do hang off it, and
  * the overlay PNG — the single artifact a human looks at to decide whether an
    import is right — drew every page-2 box at page 1's scale, in the wrong
    place, over a page that is correct.

The second is the one that matters: a review image that lies is worse than no
review image. So this test finds the red box the harvester drew and the black
ink it claims to sit on, and compares them.

Needs qpdf + poppler and pypdf + Pillow; skips loudly without them.

Run: python3 scripts/test-harvest-pages.py
"""
from __future__ import annotations

import re
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
    from PIL import Image
except ImportError as exc:  # pragma: no cover - environment guard
    missing.append(str(exc))
if missing:
    print(f"SKIP — needs {', '.join(missing)}")
    sys.exit(0)

failures: list[str] = []


def check(cond, message):
    if not cond:
        failures.append(message)


# Page 1 is Letter; page 2 is Legal — 216pt taller. The page-2 field sits at a
# height that does not exist on page 1, which is exactly the case page 1's
# measurements got wrong in both directions.
LETTER = (612.0, 792.0)
LEGAL = (612.0, 1008.0)
P1_RECT = (100.0, 600.0, 300.0, 620.0)
P2_RECT = (100.0, 900.0, 300.0, 920.0)   # top=920 — off the bottom of a Letter page


def build(path: Path) -> None:
    w = PdfWriter()
    refs = []
    for (pw, ph), rect, name in ((LETTER, P1_RECT, "onLetter"), (LEGAL, P2_RECT, "onLegal")):
        page = w.add_blank_page(width=pw, height=ph)
        x0, y0, x1, y1 = rect
        stream = DecodedStreamObject()
        stream.set_data(f"0 0 0 rg\n{x0} {y0} {x1 - x0} {y1 - y0} re f\n".encode())
        page[NameObject("/Contents")] = w._add_object(stream)
        field = DictionaryObject()
        field.update({
            NameObject("/Type"): NameObject("/Annot"),
            NameObject("/Subtype"): NameObject("/Widget"),
            NameObject("/FT"): NameObject("/Tx"),
            NameObject("/T"): TextStringObject(name),
            NameObject("/TU"): TextStringObject(name),
            NameObject("/Rect"): ArrayObject([FloatObject(v) for v in rect]),
            NameObject("/F"): NumberObject(4),
        })
        ref = w._add_object(field)
        field[NameObject("/P")] = page.indirect_reference
        page[NameObject("/Annots")] = ArrayObject([ref])
        refs.append(ref)
    acro = DictionaryObject()
    acro.update({NameObject("/Fields"): ArrayObject(refs)})
    w._root_object[NameObject("/AcroForm")] = w._add_object(acro)
    with open(path, "wb") as fh:
        w.write(fh)


def bbox(im: Image.Image, pick) -> tuple[int, int, int, int] | None:
    px = im.load()
    xs, ys = [], []
    for y in range(im.height):
        for x in range(im.width):
            if pick(px[x, y]):
                xs.append(x)
                ys.append(y)
    return (min(xs), min(ys), max(xs), max(ys)) if xs else None


folder = TEMPLATES / "ZZPAGE - Mixed Sizes"
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
        harv = subprocess.CompletedProcess([], 1, "", "")

    # A field 920pt up a 1008pt page is on the page. Measured against page 1 it
    # looks 128pt past the bottom edge, and the import cries wolf.
    check("out of bounds" not in harv.stderr,
          f"a page-2 field within its own page was called out of bounds: "
          f"{harv.stderr.strip()[:200]}")

    # The overlay is the review artifact. Find where the harvester drew its box
    # and where the ink it claims to cover actually is.
    m = re.search(r"\[harvest\] overlay: (\S+)/", harv.stdout)
    if not m:
        failures.append(f"no overlay path in the harvest output: {harv.stdout.strip()[:200]}")
    else:
        overlay = Path(m.group(1)) / "overlay-page2.png"
        if not overlay.exists():
            failures.append(f"no overlay written for page 2 ({overlay})")
        else:
            im = Image.open(overlay).convert("RGB")
            drawn = bbox(im, lambda p: p[0] > 150 and p[1] < 90 and p[2] < 90)
            ink = bbox(im, lambda p: max(p) < 90)
            if drawn is None or ink is None:
                failures.append(f"overlay page 2 has no box ({drawn}) or no ink ({ink})")
            else:
                # The drawn outline sits on the ink; a 6px slack at 100dpi covers
                # the 2px stroke and the key caption drawn just inside it.
                off = max(abs(a - b) for a, b in zip(drawn[:2], ink[:2]))
                check(off <= 6,
                      f"the page-2 overlay box is {off}px from the ink it claims to mark "
                      f"(drawn {drawn}, ink {ink}) — the review image is lying")
finally:
    shutil.rmtree(folder, ignore_errors=True)

if failures:
    print(f"FAIL — {len(failures)} problem(s) measuring a mixed-size form:")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("OK — each page is bounded, scaled and drawn to its own size")
