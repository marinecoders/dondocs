#!/usr/bin/env bash
# Acquire a NEW fillable form by its official number — the committed front door
# to the import pipeline. Resolves a form number (or search phrase) to a DON
# Forms id via the public search API, derives a template folder, and hands off
# to import-batch.sh (acquire -> flatten -> harvest -> promote -> reconcile).
#
#   scripts/acquire-form.sh "NAVMC 11675"                 # dry-run: show the plan
#   scripts/acquire-form.sh --yes "NAVMC 11675" "OPNAV 1650/3"
#   scripts/acquire-form.sh --yes --category "Training & Education" "NAVMC 10277"
#   scripts/acquire-form.sh --yes --folder "MyName" "NAVMC 11675"   # 1 arg only
#
# Resolution rules learned the hard way: NAVMC numbers query with a SPACE
# ("NAVMC 11620"), OPNAV/NAVPERS with a SLASH ("OPNAV 1650/3"); the folder uses
# a dash. Always prefer status=Active and the "(EF)" electronic variant — the
# Canceled duplicate 400s on the anonymous /file endpoint. A Chrome UA clears
# Akamai. Defaults to a DRY RUN; pass --yes to actually import. There is NO
# re-harvest path here (that would revert hand-applied form.json fixes).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || { echo "cannot cd to repo root: $ROOT" >&2; exit 1; }

CONFIRM=0 FOLDER="" CATEGORY="" ; QUERIES=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) CONFIRM=1; shift;;
    --folder) FOLDER="${2:-}"; shift 2;;
    --category) CATEGORY="${2:-}"; shift 2;;
    -h|--help) sed -n '2,20p' "$0"; exit 0;;
    --*) echo "unknown flag: $1" >&2; exit 2;;
    *) QUERIES+=("$1"); shift;;
  esac
done
if [[ ${#QUERIES[@]} -eq 0 ]]; then
  echo "usage: $0 [--yes] [--folder NAME] [--category CAT] <form-number-or-query>..." >&2
  exit 2
fi
if [[ -n "$FOLDER" && ${#QUERIES[@]} -ne 1 ]]; then
  echo "--folder overrides the derived name and only makes sense for a single form" >&2
  exit 2
fi

MANIFEST="$(mktemp)"; trap 'rm -f "$MANIFEST"' EXIT

# Resolve each query to  id<TAB>folder  (or a diagnostic on stderr), honoring the
# Active/(EF) preference, the number-format quirks, and the index-id skip guard.
FOLDER="$FOLDER" python3 - "$MANIFEST" "${QUERIES[@]}" <<'PY'
import json, os, re, subprocess, sys, urllib.parse, time

manifest_path, queries = sys.argv[1], sys.argv[2:]
override_folder = os.environ.get('FOLDER', '')
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
API = 'https://dso.dla.mil/DONNavyForms-RequestService/api/forms'

# Comparison key: strip everything but alphanumerics so "OPNAV 1650/3",
# "OPNAV1650-3" and "OPNAV 1650/3 (EF)" all compare equal.
def norm(s): return re.sub(r'[^A-Z0-9]', '', s.upper()).removesuffix('EF')


def folder_token(form_number: str) -> str:
    """API form number -> the folder's leading token.

    The API writes the number with a SLASH ("OPNAV 1650/3") but the template
    folders keep it as a DASH ("OPNAV1650-3"), so the separator has to be
    translated rather than stripped — dropping it produced "OPNAV16503",
    which neither matches the existing folders nor the derived form id.
    """
    s = re.sub(r'\(\s*EF\s*\)', '', form_number or '', flags=re.I)  # drop the (EF) marker
    s = s.replace('/', '-')                                          # API slash -> folder dash
    s = re.sub(r'[^A-Za-z0-9-]', '', s)                              # drop spaces/punctuation
    return re.sub(r'-{2,}', '-', s).upper().strip('-')

def search(q):
    url = f'{API}/search?SearchQuery={urllib.parse.quote(q)}&Page=1&PageSize=50'
    for attempt in range(3):
        try:
            out = subprocess.run(['curl', '-sf', '-m', '30', '-A', UA,
                                  '-H', 'accept: application/json', url],
                                 capture_output=True, text=True, timeout=40)
            if out.stdout:
                return json.loads(out.stdout).get('collection') or []
        except Exception:
            pass
        time.sleep(1.5 * (attempt + 1))
    return []

def title_folder(number_token, form_title):
    # "NAVMC11620" + "MAP EVALUATION" -> "NAVMC11620 - Map Evaluation"
    words = re.sub(r'\s+', ' ', (form_title or '').strip()).split(' ')
    titled = ' '.join(w if (w.isupper() and len(w) <= 4) else w.capitalize() for w in words)
    return f'{number_token} - {titled}'.strip(' -')

# Existing config-form ids, to skip re-acquiring what's already in the catalog.
idx = json.load(open('public/templates/index.json'))
have_ids = {t['id'] for t in idx['templates'] if t.get('config')}
have_dirs = {t['directory'] for t in idx['templates']}

rows, problems = [], []
for q in queries:
    # Query variants: as given, letter/digit-spaced, and slash form for OPNAV/NAVPERS.
    spaced = re.sub(r'(?<=[A-Za-z])(?=\d)', ' ', q)
    variants = [q, spaced, spaced.replace('-', '/')]
    want = norm(q.split(' - ')[0])
    matches = []
    for v in dict.fromkeys(variants):
        for f in search(v):
            if norm(f.get('formNumber', '')) == want:
                matches.append(f)
        if matches:
            break
        time.sleep(0.15)
    if not matches:
        # Report near-misses to help the user correct the number.
        near = [f.get('formNumber') for f in (search(spaced) or [])][:5]
        problems.append(f'[no-match] {q!r}   nearby: {near}')
        continue
    # Prefer Active, then the (EF) electronic variant.
    matches.sort(key=lambda f: (f.get('status', '') != 'Active', '(EF)' not in (f.get('formNumber') or '')))
    best = matches[0]
    if best.get('status') != 'Active':
        problems.append(f"[inactive] {q!r} -> only {best.get('status')} ({best.get('formNumber')}); anonymous download will 400")
        continue
    number_token = folder_token(best.get('formNumber', ''))  # NAVMC11620 / OPNAV1650-3
    # The API sometimes returns an empty formTitle (NAVMC 11036 is one), which
    # produced the folder "NAVMC11036 -" and a catalog row with no title at
    # all. Refuse rather than fabricate: pass --folder with a real name, and
    # the page heading is the place to read it from.
    api_title = (best.get('formTitle') or '').strip()
    if not api_title and not override_folder:
        problems.append(
            f'[no-title] {q!r} -> the API has no formTitle for {best.get("formNumber")}; '
            'rerun with --folder "NUMBER - Real Title"')
        continue
    folder = override_folder or title_folder(number_token, api_title)
    form_id = re.sub(r'[^a-z0-9]', '', folder.split(' - ')[0].lower())
    if form_id in have_ids:
        problems.append(f'[exists] {q!r} -> {form_id} already a config form; skipping')
        continue
    if folder in have_dirs:
        problems.append(f'[exists-dir] {q!r} -> folder {folder!r} already present; skipping')
        continue
    rows.append((str(best.get('id')), folder, best.get('formNumber'), best.get('formTitle')))

with open(manifest_path, 'w') as fh:
    for did, folder, *_ in rows:
        fh.write(f'{did}\t{folder}\n')

print('Resolved:', file=sys.stderr)
for did, folder, num, title in rows:
    print(f'  id={did:>6}  {num:<20} -> {folder}', file=sys.stderr)
for p in problems:
    print('  ' + p, file=sys.stderr)
print(f'\n{len(rows)} to import, {len(problems)} skipped/failed.', file=sys.stderr)
sys.exit(0 if rows else 3)
PY
rc=$?
if [[ $rc -ne 0 || ! -s "$MANIFEST" ]]; then
  echo "[acquire] nothing to import." >&2
  exit $rc
fi

if [[ $CONFIRM -ne 1 ]]; then
  echo
  echo "[acquire] DRY RUN — re-run with --yes to import the resolved form(s) above."
  exit 0
fi

# Optionally stamp the category on each manifest row (import-batch reads a 3rd column).
if [[ -n "$CATEGORY" ]]; then
  awk -F'\t' -v c="$CATEGORY" 'BEGIN{OFS="\t"} {print $1,$2,c}' "$MANIFEST" > "$MANIFEST.cat" && mv "$MANIFEST.cat" "$MANIFEST"
fi

echo "[acquire] importing $(wc -l < "$MANIFEST" | tr -d ' ') form(s) via import-batch.sh …"
exec scripts/import-batch.sh "$MANIFEST"
