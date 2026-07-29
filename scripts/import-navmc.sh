#!/usr/bin/env bash
# Dev-only: one command from an official NAVMC PDF (local file or .mil URL) to a
# registered, review-ready form template — the form names ITSELF.
#
#   scripts/import-navmc.sh <source.pdf | https://…> ["<Form Folder Name>"] ["description"]
#
#   scripts/import-navmc.sh ~/Desktop/"NAVMC 10132 (EF).pdf"
#     -> detects "NAVMC 10132" + "UNIT PUNISHMENT BOOK" from the pages and files
#        everything under public/templates/"NAVMC10132 - Unit Punishment Book"/
#
# Pass the folder name explicitly only to override the detection. Works from
# any cwd; the repo root is resolved from this script's own location.
#
# Stages:
#   1. Acquire  — local copy, or fetch a .mil URL with the full browser
#                 fingerprint that clears Akamai (plain curl gets 403).
#   2-5.        — flatten-navmc-form.sh into a TEMP dir: qpdf --decrypt,
#                 pdftocairo flatten, pure-XFA refusal gates, pdfseparate.
#   6. Identify — read the flattened pages: the "NAVMC <number>" footer names
#                 the form; the repeated all-caps page header names the title.
#   7. File     — move pages to public/templates/"NAVMC<num> - <Title>"/.
#   8. Register — append to public/templates/index.json (skip if id exists).
#   9. Review   — PNG contact sheet in a temp dir; eyeball before committing.
#
# Refusal at any gate leaves the repo untouched. Nothing is auto-committed.
# Requires: qpdf, poppler (pdftocairo/pdfseparate/pdfinfo/pdftotext/pdftoppm).
set -euo pipefail

SRC="${1:-}"
FOLDER_OVERRIDE="${2:-}"
DESC="${3:-}"
if [[ -z "$SRC" ]]; then
  echo "usage: $0 <source.pdf | https://…> [\"<Form Folder Name>\"] [\"description\"]" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- 1. Acquire -------------------------------------------------------------
if [[ "$SRC" == http* ]]; then
  echo "[import] fetching $SRC"
  curl -sf --http2 --compressed -m 90 -o "$WORK/source.pdf" \
    -H 'accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8' \
    -H 'accept-language: en-US,en;q=0.9' \
    -H 'sec-ch-ua: "Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="99"' \
    -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "macOS"' \
    -H 'sec-fetch-dest: document' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-site: none' -H 'sec-fetch-user: ?1' \
    -H 'upgrade-insecure-requests: 1' \
    -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' \
    "$SRC" || { echo "[import] fetch failed" >&2; exit 1; }
  SRC="$WORK/source.pdf"
fi
[[ -f "$SRC" ]] || { echo "[import] source not found: $SRC" >&2; exit 1; }
head -c 4 "$SRC" | grep -q '%PDF' || { echo "[import] not a PDF: $SRC" >&2; exit 1; }

# --- 2-5. Decrypt, flatten, guard, split — into a temp dir ------------------
STAGE="$WORK/pages"
"$ROOT/scripts/flatten-navmc-form.sh" "$SRC" "$STAGE"

# --- 6. Identify the form from its own pages --------------------------------
TEXT="$WORK/pages.txt"
: > "$TEXT"
for p in "$STAGE"/page*.pdf; do pdftotext -layout "$p" - >> "$TEXT" 2>/dev/null || true; done

FOLDER="$(python3 - "$TEXT" "$SRC" "$FOLDER_OVERRIDE" <<'EOF'
import re, subprocess, sys
text_path, src, override = sys.argv[1], sys.argv[2], sys.argv[3]
if override:
    print(override); sys.exit(0)

text = open(text_path, errors="replace").read()

# Form number: the "NAVMC 10132 (REV. …)" footer on the form beats everything;
# the source filename is the fallback.
m = re.search(r'NAVMC[ .]*(\d{3,5}[A-Za-z]?)', text) or re.search(r'NAVMC[ .]*(\d{3,5}[A-Za-z]?)', src)
if not m:
    sys.exit("[import] could not find a NAVMC number in the pages or filename — pass the folder name explicitly")
number = m.group(1)

# Title, in trust order:
#  1. The source PDF's Title metadata — LiveCycle stamps the real form name
#     (e.g. 11620 carries "MAP EVALUATION").
#  2. The most-repeated all-caps page heading. Signature-block labels repeat
#     too ("COMMANDING OFFICER" cost us a misname), so they're excluded.
BAD = re.compile(r'PRIVACY|STATEMENT|DEPARTMENT|DISTRIBUTION|NAVMC|MCO\b|CUI|OFFICIAL USE'
                 r'|AUTHORITY|PURPOSE|ROUTINE|DISCLOSURE|RETENTION|PREVIOUS EDITIONS'
                 r'|RESET|PRINT|PAGE \d|COPY TO|OFFICER\b|SIGNATURE|EXECUTIVE|COMMANDING'
                 r'|FIRST NAME|LAST NAME|UNITED STATES', re.I)

def sane(t):
    letters = re.sub(r'[^A-Za-z]', '', t or '')
    return t and 4 <= len(t) <= 60 and letters and not BAD.search(t) and not t.lower().endswith('.pdf')

title_raw = ''
try:
    info = subprocess.run(['pdfinfo', src], capture_output=True, text=True, timeout=30).stdout
    meta = next((l.split(':', 1)[1].strip() for l in info.splitlines() if l.startswith('Title:')), '')
    if sane(meta):
        title_raw = meta.upper()
except Exception:
    pass

if not title_raw:
    scores = {}
    for raw in text.splitlines():
        line = re.sub(r'\s{2,}', '  ', raw.strip())
        for part in re.split(r'\s{2,}', line):
            part = part.strip()
            letters = re.sub(r'[^A-Za-z]', '', part)
            if not (8 <= len(part) <= 60 and letters and letters.isupper() and not BAD.search(part)):
                continue
            scores[part] = scores.get(part, 0) + 1
    title_raw = max(scores, key=lambda k: (scores[k], -len(k))) if scores else 'Form'

# Tidy: drop trailing "(1234)" and a trailing "FORM", then title-case with the
# acronyms this domain actually uses kept upper.
title_raw = re.sub(r'\s*\(\d+\)\s*$', '', title_raw)
title_raw = re.sub(r'\s+FORM\s*$', '', title_raw, flags=re.I)
ACRONYMS = {'BCP', 'PFT', 'CFT', 'MAP', 'NJP', 'UPB', 'SRB', 'OMPF', 'MOS', 'TAD', 'PCS', 'ID', 'II', 'III', 'IV'}
words = []
for w in title_raw.split():
    parts = [p if p.upper() in ACRONYMS else p.capitalize() for p in re.split(r'([/-])', w)]
    words.append(''.join(parts))
title = ' '.join(words)

# Folder names hold filesystem-safe characters only (PFT/CFT -> PFT-CFT).
folder = f"NAVMC{number} - {title}".replace('/', '-')
folder = re.sub(r'[^\w\s\().-]', '', folder).strip()
print(folder)
EOF
)"
echo "[import] identified: $FOLDER"

# --- 7. File into the repo --------------------------------------------------
DEST="$ROOT/public/templates/$FOLDER"
if [[ -d "$DEST" ]]; then
  echo "[import] $DEST exists — refreshing its pages"
fi
mkdir -p "$DEST"
rm -f "$DEST"/page*.pdf
mv "$STAGE"/page*.pdf "$DEST/"

# --- 8. Register ------------------------------------------------------------
python3 - "$ROOT/public/templates/index.json" "$FOLDER" "$DESC" "$TEXT" <<'EOF'
import json, os, re, sys
index_path, folder, desc, text_path = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
form_id = re.sub(r'[^a-z0-9]', '', folder.split(' - ')[0].lower())

# SSIC-derived category: official titles carry their subject code in
# parentheses ("UNIT PUNISHMENT BOOK (5812)"); the SSIC major group maps to a
# human category. Best-effort — a human refines it at promote time.
def ssic_category(text):
    m = re.search(r'\((\d{4,5})\)', text)
    if not m:
        return 'General'
    n = int(m.group(1))
    for lo, hi, cat in [
        (1700, 1799, 'Family & Support'),
        (1500, 1599, 'Training & Education'),
        (1000, 1999, 'Personnel & Records'),
        (3000, 3999, 'Operations'),
        (4000, 4999, 'Logistics & Supply'),
        (5100, 5199, 'Safety'),
        (5800, 5899, 'Legal & Discipline'),
        (5000, 5999, 'Administration'),
        (6100, 6199, 'Fitness & Body Composition'),
        (6000, 6999, 'Medical & Dental'),
        (10000, 10999, 'Logistics & Supply'),
    ]:
        if lo <= n <= hi:
            return cat
    return 'General'

try:
    category = ssic_category(open(text_path, errors='replace').read())
except OSError:
    category = 'General' 
def display_name(folder):
    """Folder token -> user-facing form number. The folder smooshes the prefix
    and number for filesystem tidiness ("OPNAV1650-3"); the catalog shows the
    number the way the form does. Every family needs this, not just NAVMC."""
    num, sep, title = folder.partition(' - ')
    num = re.sub(r'^NAVMCHQ(?=\d)', 'NAVMC HQ ', num)
    num = re.sub(r'^([A-Z]+)(?=\d)', r'\1 ', num)
    return f'{num}{sep}{title}' if sep else num


data = json.load(open(index_path))
if any(t['id'] == form_id for t in data['templates']):
    print(f"[import] registry: '{form_id}' already present — index.json unchanged")
    sys.exit(0)
pages = sorted(
    (f for f in os.listdir(os.path.join(os.path.dirname(index_path), folder)) if re.fullmatch(r'page\d+\.pdf', f)),
    key=lambda f: int(re.search(r'\d+', f).group()),
)
data['templates'].append({
    'id': form_id,
    # The folder smooshes NAVMC and the number for filesystem tidiness; the
    # display name is user-facing, so give the number its space back.
    'name': display_name(folder),
    'directory': folder,
    'description': desc or folder.split(' - ', 1)[-1],
    'category': category,
    'keywords': [],
    'verified': False,
    'pages': pages,
    'pageLabels': [f'Page {i + 1}' for i in range(len(pages))],
})
# Temp-file + atomic rename: index.json is the catalog's source of truth for
# every form, so a crash mid-write must not leave it half-written.
tmp = index_path + '.tmp'
with open(tmp, 'w') as fh:
    json.dump(data, fh, indent=2)
    fh.write('\n')
os.replace(tmp, index_path)
print(f"[import] registry: added '{form_id}' with {len(pages)} page(s)")
EOF

# --- 8b. Catalog thumbnail ---------------------------------------------------
pdftoppm -png -r 18 -f 1 -l 1 -singlefile "$DEST/page1.pdf" "$DEST/thumb" 2>/dev/null || true

# --- 9. Review contact sheet ------------------------------------------------
SHEET="$(mktemp -d)/contact"
mkdir -p "$SHEET"
for p in "$DEST"/page*.pdf; do
  pdftoppm -png -r 60 "$p" "$SHEET/$(basename "${p%.pdf}")" >/dev/null 2>&1
done
echo
echo "[import] done — review before committing:"
echo "  pages:         $DEST"
echo "  contact sheet: $SHEET/  (open the PNGs; verify the real form, not a placeholder)"
echo "  next:          refine pageLabels/description in public/templates/index.json"
