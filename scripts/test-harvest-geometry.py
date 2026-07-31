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
box_size = mod.box_size

failures = []


def eq(got, want, msg):
    if got != want:
        failures.append(f'{msg}: got {got!r}, want {want!r}')


# The ordinary case must be untouched.
eq(box_size([0, 0, 612, 792]), (612.0, 792.0), 'normal letter box')
eq(box_size([0, 0, 792, 612]), (792.0, 612.0), 'normal landscape box')

# The shape every LiveCycle DON form actually ships.
eq(box_size([0, 792, 612, 0]), (612.0, 792.0), 'inverted vertical axis')

# Both axes, not just height — [612 792 0 0] flips the width too, and the same
# guard, bounds warning and overlay scale would inherit it.
eq(box_size([612, 792, 0, 0]), (612.0, 792.0), 'both axes inverted')
eq(box_size([612, 0, 0, 792]), (612.0, 792.0), 'inverted horizontal axis')

# A non-zero origin (cropped or imposed source) reports extent, not corners.
eq(box_size([36, 36, 648, 828]), (612.0, 792.0), 'offset origin')
eq(box_size([648, 828, 36, 36]), (612.0, 792.0), 'offset origin, inverted')

# Strings are what a real PDF dictionary yields for these numbers.
eq(box_size(['0', '792', '612', '0']), (612.0, 792.0), 'numeric strings')

if failures:
    print(f'FAIL — {len(failures)} assertion(s):')
    for f in failures:
        print(f'  - {f}')
    sys.exit(1)
print('OK — page geometry normalizes on both axes')
