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
# The registry's own form number ("OPNAV 1650/3"). Optional, and only used for
# the catalog's display name: folder_token() translates the slash to a dash for
# the filesystem and that is not reversible, so when the caller knows the real
# string it beats re-spacing the token.
NUMBER="${4:-}"
if [[ -z "$SRC" ]]; then
  echo "usage: $0 <source.pdf | https://…> [\"<Form Folder Name>\"] [\"description\"] [\"FORM NUMBER\"]" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# Shared with acquire-form.sh so both front doors derive the same folder and id.
export FORM_NAMES="$ROOT/scripts/form-names.py"
[[ -f "$FORM_NAMES" ]] || { echo "[import] missing $FORM_NAMES" >&2; exit 1; }
# On sys.path for the register heredoc, which imports index_json for the lock.
export SCRIPTS="$ROOT/scripts"

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

FOLDER="$(python3 - "$TEXT" "$SRC" "$FOLDER_OVERRIDE" "$NUMBER" <<'EOF'
import importlib.util, os, re, subprocess, sys
text_path, src, override, number_arg = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
if override:
    print(override); sys.exit(0)

# Passed in by the caller: reading __file__ here gives the string "<stdin>",
# whose parent resolves to whatever cwd the user happened to run this from.
_spec = importlib.util.spec_from_file_location('form_names', os.environ['FORM_NAMES'])
fn = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fn)

text = open(text_path, errors="replace").read()

# Form number, in trust order: the one the caller passed (the registry string),
# then the "NAVMC 10132 (REV. …)" footer on the form, then the same footer for
# any other family, then the source filename. The general pattern comes last
# because page text is full of all-caps tokens that look like a prefix.
# NOTE: no apostrophes in this heredoc — an odd number of them unbalances the
# enclosing $( … ) and bash fails to parse the script at all.
NAVMC = r'NAVMC[ .]*(\d{3,5}[A-Za-z]?)'
ANY = r'\b([A-Z][A-Z&-]{1,14}(?:\s+HQ)?)[ .]+(\d{2,5}[A-Za-z]?(?:/\d{1,4}[A-Za-z]?)?)\b'
if number_arg and fn.is_form_number(number_arg):
    number = fn.clean_number(number_arg)
else:
    m = re.search(NAVMC, text) or re.search(NAVMC, src)
    if m:
        number = f'NAVMC {m.group(1)}'
    else:
        m = re.search(ANY, text) or re.search(ANY, src)
        if not m:
            sys.exit('[import] could not find a form number in the pages or filename — '
                     'pass the folder name explicitly, or the number as argument 4')
        number = f'{m.group(1)} {m.group(2)}'
        # The general pattern can latch onto any all-caps word followed by
        # digits, so it can be wrong in a way the NAVMC footer never is. Say so
        # rather than let a guessed number become a folder name in silence; the
        # batch path always passes the registry number and never lands here.
        print(f'[import] WARNING: form number GUESSED from the page text as '
              f'{number!r}. Verify it, or pass the number as argument 4.',
              file=sys.stderr)

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

# Tidy: drop a trailing "(1234)" SSIC and a trailing "FORM". The rest — title
# casing, path-safe characters, the length cap — belongs to form-names.py,
# shared with acquire-form.sh so both front doors file a form the same way.
title_raw = re.sub(r'\s*\(\d+\)\s*$', '', title_raw)
title_raw = re.sub(r'\s+FORM\s*$', '', title_raw, flags=re.I)
print(fn.folder_name(number, title_raw))
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
python3 - "$ROOT/public/templates/index.json" "$FOLDER" "$DESC" "$TEXT" "$NUMBER" <<'EOF'
import importlib.util, os, re, sys
index_path, folder, desc, text_path = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
number = sys.argv[5] if len(sys.argv) > 5 else ''

# Passed in by the caller: reading __file__ here gives the string "<stdin>",
# whose parent resolves to whatever cwd the user happened to run this from.
_spec = importlib.util.spec_from_file_location('form_names', os.environ['FORM_NAMES'])
fn = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fn)
form_id = fn.form_id(folder)

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
pages = sorted(
    (f for f in os.listdir(os.path.join(os.path.dirname(index_path), folder)) if re.fullmatch(r'page\d+\.pdf', f)),
    key=lambda f: int(re.search(r'\d+', f).group()),
)

# index.json is the catalog's source of truth for every form, so the write goes
# through the shared lock: re-read inside it, append, atomic-rename. Reading the
# file out here and replacing it wholesale is what let a batch run in another
# terminal lose the row it had just added.
sys.path.insert(0, os.environ['SCRIPTS'])
import index_json


class AlreadyPresent(Exception):
    """Raised out of the mutation so update() leaves index.json untouched."""


def register(data):
    if any(t['id'] == form_id for t in data['templates']):
        raise AlreadyPresent
    data['templates'].append({
        'id': form_id,
        # The folder smooshes the prefix and number for filesystem tidiness
        # ("OPNAV1650-3"); the catalog shows the number the way the form prints
        # it. The registry's own string is used when the caller passed it,
        # because the token cannot be inverted — "OPNAV1650-3" could have been
        # 1650/3 or 1650-3.
        'name': fn.display_name(folder, number),
        'directory': folder,
        'description': desc or folder.split(' - ', 1)[-1],
        'category': category,
        'keywords': [],
        'verified': False,
        'pages': pages,
        'pageLabels': [f'Page {i + 1}' for i in range(len(pages))],
    })


try:
    index_json.update(register, index_path)
    print(f"[import] registry: added '{form_id}' with {len(pages)} page(s)")
except AlreadyPresent:
    print(f"[import] registry: '{form_id}' already present — index.json unchanged")
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
