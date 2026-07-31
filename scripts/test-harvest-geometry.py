#!/usr/bin/env python3
"""Page-geometry normalization in scripts/harvest-fields.py.

A PDF rectangle may be written with any two diagonally opposite corners
(PDF 32000-1 §7.9.5), and pypdf subtracts without sorting. Every
LiveCycle-authored DON form ships its MediaBox as [0 792 612 0], which made
`.height` come back -792 and the revision guard refuse the form as a "different
revision" — against a template page that was a byte-identical split of that same
source. Six real originals were affected, NAVMC 10274 among them.

Run: python3 scripts/test-harvest-geometry.py   (no PDFs, no poppler needed)
"""
import importlib.util
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('harvest_fields', HERE / 'harvest-fields.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
norm_rect, page_box = mod.norm_rect, mod.page_box

failures = []


def eq(got, want, msg):
    if got != want:
        failures.append(f'{msg}: got {got!r}, want {want!r}')


def size(rect):
    x0, y0, x1, y1 = norm_rect(rect)
    return x1 - x0, y1 - y0


# The ordinary case must be untouched.
eq(size([0, 0, 612, 792]), (612.0, 792.0), 'normal letter box')
eq(size([0, 0, 792, 612]), (792.0, 612.0), 'normal landscape box')

# The shape every LiveCycle DON form actually ships.
eq(size([0, 792, 612, 0]), (612.0, 792.0), 'inverted vertical axis')

# Both axes, not just height — [612 792 0 0] flips the width too, and the same
# guard, bounds warning and overlay scale would inherit it.
eq(size([612, 792, 0, 0]), (612.0, 792.0), 'both axes inverted')
eq(size([612, 0, 0, 792]), (612.0, 792.0), 'inverted horizontal axis')

# A non-zero origin (cropped or imposed source) reports extent, not corners.
eq(size([36, 36, 648, 828]), (612.0, 792.0), 'offset origin')
eq(size([648, 828, 36, 36]), (612.0, 792.0), 'offset origin, inverted')

# Strings are what a real PDF dictionary yields for these numbers.
eq(size(['0', '792', '612', '0']), (612.0, 792.0), 'numeric strings')

class FakePage:
    """Only what page_box reads. A real PdfReader page needs a whole file."""
    def __init__(self, media, crop=None):
        self.mediabox = media
        self.cropbox = crop if crop is not None else media


# pdftocairo renders the CROP box (verified: a 612x792 media / 612x535 crop
# source flattens to 612x535), so the guard has to measure that one.
eq(page_box(FakePage([0, 0, 612, 792])), (0.0, 0.0, 612.0, 792.0), 'crop defaults to media')
eq(page_box(FakePage([0, 0, 612, 792], [0, 0, 612, 535])), (0.0, 0.0, 612.0, 535.0), 'crop wins')
eq(page_box(FakePage([0, 792, 612, 0], [0, 535, 612, 0])), (0.0, 0.0, 612.0, 535.0),
   'crop wins, both inverted')
# A crop box larger than the media box is clipped to it, per the spec.
eq(page_box(FakePage([0, 0, 612, 792], [-50, -50, 700, 900])), (0.0, 0.0, 612.0, 792.0),
   'crop clipped to media')

if failures:
    print(f'FAIL — {len(failures)} assertion(s):')
    for f in failures:
        print(f'  - {f}')
    sys.exit(1)
print('OK — page geometry normalizes on both axes')
