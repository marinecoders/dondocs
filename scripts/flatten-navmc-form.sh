#!/usr/bin/env bash
# Dev-only: flatten an official NAVMC PDF into the per-page template files the
# app expects, fully headless — no Adobe.
#
#   scripts/flatten-navmc-form.sh <source.pdf> "<Form Folder Name>"
#
# e.g.  scripts/flatten-navmc-form.sh ~/Desktop/"NAVMC 11621 (EF).pdf" \
#         "NAVMC11621 - BCP Evaluation"
#
# Pipeline: qpdf --decrypt (lift the owner-password permission flag) ->
# pdftocairo -pdf (render the static layer, dropping XFA/AcroForm) ->
# pdfseparate (one page1.pdf/page2.pdf/... per page under public/templates/).
#
# HARD LIMIT — pure dynamic XFA forms (e.g. NAVMC 11296) carry no static layer;
# poppler can only render Adobe's "Please wait…" placeholder. This script
# DETECTS that page and REFUSES, so a placeholder can never be staged as a real
# form. Those forms must be flattened in Acrobat: open the decrypted copy, then
# File > Print > "Save as PDF". See docs/FORM_TEMPLATES.md.
#
# Requires: qpdf, poppler (pdftocairo, pdfseparate, pdfinfo, pdftotext).
set -euo pipefail

SRC="${1:-}"
FOLDER="${2:-}"
if [[ -z "$SRC" || -z "$FOLDER" ]]; then
  echo "usage: $0 <source.pdf> \"<Form Folder Name>\"" >&2
  exit 2
fi
[[ -f "$SRC" ]] || { echo "[flatten] source not found: $SRC" >&2; exit 1; }
for bin in qpdf pdftocairo pdfseparate pdfinfo pdftotext; do
  command -v "$bin" >/dev/null || { echo "[flatten] missing '$bin' (brew install qpdf poppler)" >&2; exit 1; }
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# A folder NAME goes under public/templates/; an absolute PATH is used as-is
# (import-navmc.sh flattens to a temp dir first, then derives the real name).
case "$FOLDER" in
  /*) DEST="$FOLDER" ;;
  *)  DEST="$ROOT/public/templates/$FOLDER" ;;
esac
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 1. Lift the owner-password restriction (a permissions flag, not encryption;
#    qpdf --decrypt needs no password). Harmless if the PDF isn't restricted.
qpdf --decrypt "$SRC" "$WORK/dec.pdf" 2>/dev/null || cp "$SRC" "$WORK/dec.pdf"

# 1b. Strip every annotation before rendering. pdftocairo draws widget
#     appearance streams into the page, so Print/Reset button ARTWORK (and
#     any field chrome) would be baked into the template as pixels — the
#     buttons stop working either way, but a dead "Print Form" graphic on a
#     fillable template is worse than none. The static page content is
#     untouched; the app draws all values itself.
python3 - "$WORK/dec.pdf" <<'PYEOF'
import sys
from pypdf import PdfReader, PdfWriter
path = sys.argv[1]
r = PdfReader(path)
w = PdfWriter()
for pg in r.pages:
    if "/Annots" in pg:
        del pg["/Annots"]
    w.add_page(pg)
with open(path, "wb") as f:
    w.write(f)
PYEOF

# 2. Flatten to a static PDF.
pdftocairo -pdf "$WORK/dec.pdf" "$WORK/flat.pdf"

# 3. Refuse the pure-XFA placeholder before anything is written to the repo.
#    When poppler can't render dynamic XFA it emits one of Adobe's fallback
#    pages. There are SEVERAL wordings in the wild — the classic "Please
#    wait…" and the "you need a later version of the PDF viewer / upgrade to
#    the latest version of Adobe Reader" variant (NAVMC 11760). Every variant
#    points the reader at adobe.com, which no real Marine Corps form body
#    ever does, so that URL plus the known phrases is the conclusive tell.
#    Scan ALL pages, not just page 1: a hybrid whose first page renders but
#    whose later pages are placeholders is just as unusable.
XFA_PLACEHOLDER='please wait|may not be able to display|the proper contents of the document|to view the full contents of this document|later version of the (pdf|adobe)|upgrade to the latest version of adobe|www\.adobe\.com|get adobe reader'
ALLTEXT="$(pdftotext -layout "$WORK/flat.pdf" - 2>/dev/null || true)"
if grep -qiE "$XFA_PLACEHOLDER" <<<"$ALLTEXT"; then
  echo "[flatten] REFUSED: '$SRC' rendered an Adobe XFA fallback page, not the" >&2
  echo "          form — poppler cannot render this dynamic XFA. Matched:" >&2
  grep -inE "$XFA_PLACEHOLDER" <<<"$ALLTEXT" | head -3 | sed 's/^/            /' >&2
  echo "          Flatten it in Acrobat instead: open the decrypted copy, then" >&2
  echo "          File > Print > 'Save as PDF'. (see docs/FORM_TEMPLATES.md)" >&2
  exit 3
fi

# 4. Confirm the flatten actually stripped the interactive layer.
if pdfinfo "$WORK/flat.pdf" | grep -qE "^Form:\s*(XFA|AcroForm)"; then
  echo "[flatten] REFUSED: '$SRC' still reports an interactive form after" >&2
  echo "          flattening (pdfinfo Form != none). Needs Acrobat." >&2
  exit 3
fi

# 4b. Button-artwork guard: with annotations stripped (step 1b), no button
#     caption should survive into the rendered text. If one does, the artwork
#     reached the page some other way (e.g. drawn into the static content by
#     the form's author) and a human must look at the pages. A warning, not a
#     refusal — real forms legitimately say things like "Type or print", so
#     only unmistakable button captions are matched.
BTN="$(pdftotext -layout "$WORK/flat.pdf" - 2>/dev/null \
  | grep -inE '\b(print form|reset form|save form|clear form|submit form|print button|reset button)\b' || true)"
if [[ -n "$BTN" ]]; then
  echo "[flatten] WARNING: possible dead button artwork survived the flatten:" >&2
  echo "$BTN" | head -5 | sed 's/^/          /' >&2
  echo "          Review the pages before committing — a non-working 'Print" >&2
  echo "          Form' graphic must not ship on a template." >&2
fi

# 5. Split into the per-page files the registry loads. Separate into the work
#    dir FIRST and only swap into place once the pages exist: deleting the
#    destination up front meant a failed pdfseparate left a previously working
#    form with no pages at all. A run that produces nothing is an error, not a
#    quiet success — downstream the harvester would otherwise die on an empty
#    page list with an index error instead of a readable message.
if ! pdfseparate "$WORK/flat.pdf" "$WORK/page%d.pdf"; then
  echo "[flatten] REFUSED: pdfseparate failed on '$SRC'; $DEST left untouched." >&2
  exit 4
fi
COUNT="$(ls "$WORK"/page*.pdf 2>/dev/null | wc -l | xargs)"
if [[ "$COUNT" -eq 0 ]]; then
  echo "[flatten] REFUSED: pdfseparate produced no pages from '$SRC';" >&2
  echo "          $DEST left untouched." >&2
  exit 4
fi
# 5b. Ink guard. A page that renders all-white is not a form, and nothing above
#     would notice: stripping /Annots (step 1b) removes the only marks a source
#     whose static layer is empty ever had, and such a source clears the XFA
#     refusal whenever it happens not to carry Adobe's wording. Blank pages then
#     get committed as templates and the import reports success.
#     Warn per blank page — a near-empty continuation page is a real thing — and
#     refuse only when EVERY page is blank, which is the shape that produces a
#     template nobody can fill in.
BLANK="$(python3 - "$WORK" <<'PYEOF'
import re, subprocess, sys, tempfile
from pathlib import Path

blank = []
for pdf in sorted(Path(sys.argv[1]).glob('page*.pdf'),
                  key=lambda p: int(re.search(r'\d+', p.stem).group())):
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / 'p'
        subprocess.run(['pdftoppm', '-gray', '-r', '36', '-singlefile', str(pdf), str(root)],
                       check=True, capture_output=True)
        raw = root.with_suffix('.pgm').read_bytes()
    # Raw PGM is "P5\n<w> <h>\n<max>\n" then one byte per pixel, so anything
    # below full white is ink. A handful of pixels is antialiasing, not content.
    parts = raw.split(b'\n', 3)
    body = parts[3] if raw.startswith(b'P5') and len(parts) == 4 else b''
    if sum(1 for b in body if b < 250) <= 8:
        blank.append(pdf.stem)
print(' '.join(blank))
PYEOF
)"
BLANK_COUNT="$(wc -w <<<"$BLANK" | xargs)"
if [[ "$BLANK_COUNT" -eq "$COUNT" ]]; then
  echo "[flatten] REFUSED: every one of the $COUNT rendered page(s) of '$SRC' is" >&2
  echo "          blank — the source has no static layer to flatten. $DEST left" >&2
  echo "          untouched. Flatten it in Acrobat (see docs/FORM_TEMPLATES.md)." >&2
  exit 4
elif [[ -n "$BLANK" ]]; then
  echo "[flatten] WARNING: blank page(s) after flattening: $BLANK" >&2
  echo "          Review them before committing — a page with no ink is either a" >&2
  echo "          real continuation page or a piece of the form that did not render." >&2
fi

mkdir -p "$DEST"
rm -f "$DEST"/page*.pdf
mv "$WORK"/page*.pdf "$DEST"/
echo "[flatten] wrote $COUNT page(s) to $DEST/"
for p in "$DEST"/page*.pdf; do
  echo "  $(basename "$p") — Form:$(pdfinfo "$p" | awk '/^Form/{print $2}') $(pdfinfo "$p" | awk -F: '/Page size/{print $2}' | xargs)"
done
echo "[flatten] Review the pages, then trace field boxes with scripts/extract-pdf-boxes.py."
