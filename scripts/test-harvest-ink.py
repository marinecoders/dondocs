#!/usr/bin/env python3
"""Harvested boxes must match where the ink actually lands.

Every other test of this pipeline compares the harvester's arithmetic against
the same arithmetic restated in the assertion, so a coordinate-space error
agrees with itself and passes. This one does not: it builds a PDF whose widget
/Rects are ALSO painted into the static content stream, runs the real
flatten + harvest, renders the flattened page, and measures the painted pixels.
The page itself is the oracle.

That distinction matters, and it was learned the hard way. A plausible-sounding
guard — "assert no box lands off the page" — would catch none of the coordinate
bugs found in this pipeline: a /Rotate 180 form puts a box 478pt from the truth
and a shifted MediaBox puts it 51pt off, and both land comfortably inside the
page. Only comparing against ink finds them.

Requires qpdf + poppler (pdftocairo/pdfseparate/pdftoppm) and pypdf + Pillow.
Skips loudly rather than passing when the toolchain is absent.

Run: python3 scripts/test-harvest-ink.py
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / "public" / "templates"
DPI = 150
SCALE = DPI / 72.0
# Rasterizing then thresholding costs a little accuracy at the edges; 1.5pt is
# comfortably tighter than any real defect (the smallest measured was 36pt).
TOLERANCE_PT = 1.5

for exe in ("qpdf", "pdftocairo", "pdfseparate", "pdftoppm"):
    if shutil.which(exe) is None:
        print(f"SKIP — {exe} not installed; this test needs qpdf + poppler")
        sys.exit(0)
try:
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import (
        ArrayObject, DictionaryObject, FloatObject, NameObject,
        NumberObject, TextStringObject,
    )
    from PIL import Image
except ImportError as exc:  # pragma: no cover - environment guard
    print(f"SKIP — {exc}; this test needs pypdf and Pillow")
    sys.exit(0)

failures: list[str] = []


def build_pdf(path: Path, rect: tuple[float, float, float, float],
              media: tuple[float, float, float, float], rotate: int = 0) -> None:
    """One page, one text widget at `rect`, and the SAME rect painted black in
    the content stream so the flattened page carries pixel ground truth."""
    w = PdfWriter()
    mx0, my0, mx1, my1 = media
    page = w.add_blank_page(width=abs(mx1 - mx0), height=abs(my1 - my0))
    page[NameObject("/MediaBox")] = ArrayObject([FloatObject(v) for v in media])
    if rotate:
        page[NameObject("/Rotate")] = NumberObject(rotate)

    x0, y0, x1, y1 = rect
    painted = f"0 0 0 rg\n{x0} {y0} {x1 - x0} {y1 - y0} re f\n".encode()
    from pypdf.generic import DecodedStreamObject
    stream = DecodedStreamObject()
    stream.set_data(painted)
    page[NameObject("/Contents")] = w._add_object(stream)

    field = DictionaryObject()
    field.update({
        NameObject("/Type"): NameObject("/Annot"),
        NameObject("/Subtype"): NameObject("/Widget"),
        NameObject("/FT"): NameObject("/Tx"),
        NameObject("/T"): TextStringObject("probe"),
        NameObject("/Rect"): ArrayObject([FloatObject(v) for v in rect]),
        NameObject("/F"): NumberObject(4),
    })
    ref = w._add_object(field)
    page[NameObject("/Annots")] = ArrayObject([ref])
    field[NameObject("/P")] = page.indirect_reference
    acro = DictionaryObject()
    acro.update({NameObject("/Fields"): ArrayObject([ref])})
    w._root_object[NameObject("/AcroForm")] = w._add_object(acro)
    with open(path, "wb") as fh:
        w.write(fh)


def ink_box(page_pdf: Path) -> tuple[float, float, float, float]:
    """Bounding box of the painted rectangle in PDF points, returned as
    (left, top_from_page_top, right, bottom_from_page_top).

    Raster rows count DOWN from the page top; harvest-fields.py writes `top` as
    the box's top edge in PDF space, which counts UP from the page bottom. The
    caller converts. Getting this backwards is what the Control case is here to
    catch, and it did on the first run."""
    out = Path(tempfile.mkdtemp()) / "r"
    subprocess.run(["pdftoppm", "-png", "-r", str(DPI), "-singlefile",
                    str(page_pdf), str(out)], check=True, capture_output=True)
    im = Image.open(f"{out}.png").convert("L")
    px = im.load()
    xs, ys = [], []
    for y in range(im.height):
        for x in range(im.width):
            if px[x, y] < 128:  # the painted rect is solid black
                xs.append(x)
                ys.append(y)
    if not xs:
        raise AssertionError(f"no ink found in {page_pdf}")
    return (min(xs) / SCALE, min(ys) / SCALE,
            (max(xs) + 1) / SCALE, (max(ys) + 1) / SCALE)


def run_case(name: str, rect, media, rotate: int = 0) -> None:
    folder = TEMPLATES / f"ZZINK - {name}"
    src = Path(tempfile.mkdtemp()) / "src.pdf"
    build_pdf(src, rect, media, rotate)
    try:
        folder.mkdir(parents=True, exist_ok=True)
        flat = subprocess.run([str(ROOT / "scripts" / "flatten-navmc-form.sh"),
                               str(src), str(folder)], capture_output=True, text=True)
        if flat.returncode != 0:
            failures.append(f"{name}: flatten failed — {flat.stderr.strip()[:160]}")
            return
        harv = subprocess.run([sys.executable, str(ROOT / "scripts" / "harvest-fields.py"),
                               str(src), folder.name], capture_output=True, text=True)
        if harv.returncode != 0:
            failures.append(f"{name}: harvest refused — "
                            f"{(harv.stderr or harv.stdout).strip()[:160]}")
            return

        boxes = json.loads((folder / "boxes.draft.json").read_text())
        page1 = boxes["pages"]["page1"] if "pages" in boxes else boxes["page1"]
        got = next(iter(page1.values()))
        ix0, iy0, ix1, iy1 = ink_box(folder / "page1.pdf")
        page_h = float(PdfReader(str(folder / "page1.pdf")).pages[0].mediabox.height)

        # The draft's `top` is the box's TOP edge in PDF space, measured up from
        # the page bottom (see the notes harvest-fields.py writes into the
        # draft). The raster's iy0 is that same edge measured down from the page
        # top, so they are page_h apart.
        for label, harvested, truth in (
            ("left", got["left"], ix0),
            ("top", got["top"], page_h - iy0),
            ("width", got["width"], ix1 - ix0),
            ("height", got["height"], iy1 - iy0),
        ):
            if abs(harvested - truth) > TOLERANCE_PT:
                failures.append(
                    f"{name}.{label}: harvested {harvested:.1f} but the ink is at "
                    f"{truth:.1f} ({abs(harvested - truth):.1f}pt out)")
    finally:
        shutil.rmtree(folder, ignore_errors=True)


# The page as authored, with a normal box. If this drifts, the harness is wrong
# rather than the harvester.
run_case("Control", rect=(100, 600, 300, 620), media=(0, 0, 612, 792))

# The shape every LiveCycle DON form ships: MediaBox corners given inverted.
# Six real originals do this, NAVMC 10274 among them; it used to be refused
# outright with a false "different revisions" verdict.
run_case("InvertedBox", rect=(100, 600, 300, 620), media=(0, 792, 612, 0))

# Page rotation. pdftocairo bakes it into the flattened page, so a rect read
# from source user space has to be rotated to match or it lands 478pt away —
# still on the page, which is why no existing guard caught it.
for deg in (90, 180, 270):
    run_case(f"Rot{deg}", rect=(100, 600, 300, 620), media=(0, 0, 612, 792), rotate=deg)

# A cropped or imposed source: pdftocairo normalizes the origin to 0,0 but the
# rect is written in the source's own space.
run_case("OffsetOrigin", rect=(136, 636, 336, 656), media=(36, 36, 648, 828))

if failures:
    print(f"FAIL — {len(failures)} mismatch(es) between harvested boxes and ink:")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("OK — harvested boxes match the rendered ink")
