#!/usr/bin/env bash
# Acquire fillable forms from the DON Forms registry — the committed front door
# to the import pipeline. Resolves a form number (or walks the whole registry),
# derives a template folder, and hands off to import-batch.sh
# (acquire -> flatten -> harvest -> promote -> reconcile).
#
#   scripts/acquire-form.sh "NAVMC 11675"                 # dry-run: show the plan
#   scripts/acquire-form.sh --yes "NAVMC 11675" "OPNAV 1650/3"
#   scripts/acquire-form.sh --yes --category "Training & Education" "NAVMC 10277"
#   scripts/acquire-form.sh --yes --folder "MyName" "NAVMC 11675"   # 1 arg only
#
#   scripts/acquire-form.sh --active                      # every Active form
#   scripts/acquire-form.sh --active --family NAVMC        # one family
#   scripts/acquire-form.sh --active --limit 20 --yes      # a trial slice
#
# --active pages through the registry's entire catalog instead of searching for
# numbers you name: an empty SearchQuery returns everything (13,859 rows, about
# 10,000 Active), so the set of forms worth importing is DERIVED each run and no
# list has to be kept anywhere. Two consequences worth knowing: the count drifts
# as the Navy cancels and adds forms, and whether a form survives the flattener
# is only knowable by trying it — so expect "about" this many, not exactly.
#
# Resolution rules learned the hard way: NAVMC numbers query with a SPACE
# ("NAVMC 11620"), OPNAV/NAVPERS with a SLASH ("OPNAV 1650/3"); the folder uses
# a dash. Always prefer status=Active and the "(EF)" electronic variant — the
# Canceled duplicate 400s on the anonymous /file endpoint. A Chrome UA clears
# Akamai. Folder and id derivation lives in scripts/form-names.py, where the
# registry's messier shapes are handled and unit-tested. Defaults to a DRY RUN;
# pass --yes to actually import. There is NO re-harvest path here (that would
# revert hand-applied form.json fixes).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || { echo "cannot cd to repo root: $ROOT" >&2; exit 1; }

CONFIRM=0 FOLDER="" CATEGORY="" MODE="query" FAMILY="" LIMIT=0 ; QUERIES=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) CONFIRM=1; shift;;
    --active|--all) MODE="active"; shift;;
    --family) FAMILY="${2:-}"; shift 2;;
    --limit) LIMIT="${2:-0}"; shift 2;;
    --folder) FOLDER="${2:-}"; shift 2;;
    --category) CATEGORY="${2:-}"; shift 2;;
    -h|--help) sed -n '2,30p' "$0"; exit 0;;
    --*) echo "unknown flag: $1" >&2; exit 2;;
    *) QUERIES+=("$1"); shift;;
  esac
done
if [[ "$MODE" == "query" && ${#QUERIES[@]} -eq 0 ]]; then
  echo "usage: $0 [--yes] [--folder NAME] [--category CAT] <form-number-or-query>..." >&2
  echo "       $0 --active [--family PREFIX] [--limit N] [--yes]" >&2
  exit 2
fi
if [[ "$MODE" == "active" && ${#QUERIES[@]} -gt 0 ]]; then
  echo "--active walks the whole registry; it takes no form numbers (use --family to narrow)" >&2
  exit 2
fi
if [[ "$MODE" == "active" && -n "$FOLDER" ]]; then
  echo "--folder names a single form and cannot be combined with --active" >&2
  exit 2
fi
if [[ -n "$FOLDER" && ${#QUERIES[@]} -ne 1 ]]; then
  echo "--folder overrides the derived name and only makes sense for a single form" >&2
  exit 2
fi

MANIFEST="$(mktemp)"; trap 'rm -f "$MANIFEST"' EXIT

# Resolve to  id<TAB>folder<TAB>category<TAB>formNumber  (or a diagnostic on
# stderr), honoring the Active/(EF) preference and the index skip guards.
FOLDER="$FOLDER" MODE="$MODE" FAMILY="$FAMILY" LIMIT="$LIMIT" \
python3 - "$MANIFEST" ${QUERIES[@]+"${QUERIES[@]}"} <<'PY'
import importlib.util, json, os, pathlib, re, subprocess, sys, urllib.parse, time

manifest_path, queries = sys.argv[1], sys.argv[2:]
override_folder = os.environ.get('FOLDER', '')
mode = os.environ.get('MODE', 'query')
family = os.environ.get('FAMILY', '').strip().upper()
limit = int(os.environ.get('LIMIT') or 0)

# Folder/id/title derivation is shared with import-navmc.sh and unit-tested by
# scripts/test-form-names.py — the registry's shapes are messier than they look.
# The caller cd'd to the repo root, so resolve the module from there.
_spec = importlib.util.spec_from_file_location(
    'form_names', pathlib.Path.cwd() / 'scripts' / 'form-names.py')
fn = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fn)

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')
API = 'https://dso.dla.mil/DONNavyForms-RequestService/api/forms'


def api(url):
    for attempt in range(3):
        try:
            out = subprocess.run(['curl', '-sf', '-m', '45', '-A', UA,
                                  '-H', 'accept: application/json', url],
                                 capture_output=True, text=True, timeout=60)
            if out.stdout:
                return json.loads(out.stdout)
        except Exception:
            pass
        time.sleep(1.5 * (attempt + 1))
    return None


def search(q):
    d = api(f'{API}/search?SearchQuery={urllib.parse.quote(q)}&Page=1&PageSize=50')
    return (d or {}).get('collection') or []


def walk_catalog():
    """Every row in the registry. An empty SearchQuery returns the whole
    catalog, so the importable set never has to be written down anywhere."""
    first = api(f'{API}/search?SearchQuery=&Page=1&PageSize=100')
    if not first:
        sys.exit('[acquire] could not reach the DON Forms registry')
    rows, pages = list(first.get('collection') or []), first.get('totalPages') or 1
    print(f"[acquire] registry has {first.get('totalCount')} forms across {pages} pages",
          file=sys.stderr)
    missed = []
    for page in range(2, pages + 1):
        d = api(f'{API}/search?SearchQuery=&Page={page}&PageSize=100')
        if not d:
            missed.append(page)
            continue
        rows.extend(d.get('collection') or [])
        if page % 25 == 0:
            print(f'  … page {page}/{pages}', file=sys.stderr)
        time.sleep(0.12)
    if missed:
        # Silence here would read as "the registry has nothing else"; say what
        # was not seen so a short run is never mistaken for a complete one.
        print(f'  [warn] {len(missed)} page(s) failed after retries and were '
              f'skipped: {missed[:10]} — this run is INCOMPLETE', file=sys.stderr)
    return rows


# Everything already in the catalog, to skip re-acquiring it. EVERY id, not
# just config forms: the two hand-built forms (10274, 118(11)) keep their
# geometry in TypeScript, and reusing their id would collide in the registry.
idx = json.load(open('public/templates/index.json'))
have_ids = {t['id'] for t in idx['templates']}
have_dirs = {t['directory'] for t in idx['templates']}

rows, problems = [], []
skipped = {'exists': 0, 'not-a-form': 0, 'untitled': 0, 'inactive': 0,
           'retired': 0, 'other-family': 0}


def plan(best, note_problems=True):
    """One registry row -> a manifest row, or a counted reason it was skipped."""
    number = fn.clean_number(best.get('formNumber'))
    if not fn.is_form_number(number):
        # 113 Active rows are not forms at all ("LITHO" 39 times, "N/A", two
        # blanks). A form number contains a digit; that drops all of them.
        skipped['not-a-form'] += 1
        return None
    api_title = (best.get('formTitle') or '').strip()
    if fn.is_retired(number, api_title):
        # 47 rows the registry still calls Active say in their own number or
        # title that they are cancelled or inactive. Trusting status alone
        # staged a dead form under the id "navmc11428cancelledbyusmc".
        skipped['retired'] += 1
        if note_problems:
            problems.append(f'[retired] {number!r} announces itself cancelled/inactive; skipping')
        return None
    if not fn.has_title(api_title) and not override_folder:
        # The registry returns an empty formTitle for a handful of forms
        # (NAVMC 11036 is one), which produced the folder "NAVMC11036 -" and a
        # catalog row with no title. Refuse rather than fabricate: the page
        # heading is the place to read the real name from.
        # Always named, even in walk mode where the other diagnostics are
        # suppressed: there are only about a dozen, each one is actionable, and
        # a bare count tells you nothing about which form to go and look at.
        skipped['untitled'] += 1
        problems.append(
            f'[no-title] {number!r} -> the registry has no formTitle; '
            'rerun with --folder "NUMBER - Real Title"')
        return None
    folder = override_folder or fn.folder_name(number, api_title)
    form_id = fn.form_id(folder)
    if form_id in have_ids or folder in have_dirs:
        skipped['exists'] += 1
        if note_problems:
            problems.append(f'[exists] {number!r} -> {form_id} is already in the catalog; skipping')
        return None
    # Claim the name so two rows in one run cannot both take it.
    have_ids.add(form_id)
    have_dirs.add(folder)
    return (str(best.get('id')), folder, number)


def prefer(cands):
    """Pick the row to download: Active first, then the (EF) electronic variant,
    then the newest revision. The Canceled duplicate 400s on the anonymous
    /file endpoint, and the paper variant has no fillable fields to harvest."""
    def rank(f):
        return (f.get('status', '') != 'Active',
                '(EF)' not in (f.get('formNumber') or ''))
    best = min(rank(f) for f in cands)
    tied = [f for f in cands if rank(f) == best]
    return max(tied, key=lambda f: str(f.get('lastRevisionDate') or ''))


if mode == 'active':
    groups = {}
    for r in walk_catalog():
        if r.get('status') != 'Active':
            continue
        number = fn.clean_number(r.get('formNumber'))
        if family and not number.upper().startswith(family):
            skipped['other-family'] += 1
            continue
        # One form, many rows: the (EF) variant and each revision are separate
        # registry entries that must not become separate template folders.
        groups.setdefault(fn.norm(number), []).append(r)
    print(f'[acquire] {len(groups)} distinct Active forms'
          + (f' in family {family}' if family else ''), file=sys.stderr)
    for key in sorted(groups):
        if limit and len(rows) >= limit:
            break
        row = plan(prefer(groups[key]), note_problems=False)
        if row:
            rows.append(row)
else:
    for q in queries:
        # Query variants: as given, letter/digit-spaced, and the slash form for
        # OPNAV/NAVPERS.
        spaced = re.sub(r'(?<=[A-Za-z])(?=\d)', ' ', q)
        variants = [q, spaced, spaced.replace('-', '/')]
        want = fn.norm(q.split(' - ')[0])
        matches = []
        for v in dict.fromkeys(variants):
            for f in search(v):
                if fn.norm(f.get('formNumber', '')) == want:
                    matches.append(f)
            if matches:
                break
            time.sleep(0.15)
        if not matches:
            near = [f.get('formNumber') for f in (search(spaced) or [])][:5]
            problems.append(f'[no-match] {q!r}   nearby: {near}')
            continue
        best = prefer(matches)
        if best.get('status') != 'Active':
            skipped['inactive'] += 1
            problems.append(
                f"[inactive] {q!r} -> only {best.get('status')} "
                f"({best.get('formNumber')}); anonymous download will 400")
            continue
        row = plan(best)
        if row:
            rows.append(row)

with open(manifest_path, 'w') as fh:
    for did, folder, number in rows:
        # id, folder, category, number. The category placeholder is a literal
        # "-", never an empty field: tab counts as IFS whitespace, so bash
        # collapses a "\t\t" into one delimiter and every later column shifts
        # left — which silently put the form number into the category.
        fh.write(f'{did}\t{folder}\t-\t{number}\n')

print('Resolved:', file=sys.stderr)
for did, folder, number in rows[:40]:
    print(f'  id={did:>6}  {number:<24} -> {folder}', file=sys.stderr)
if len(rows) > 40:
    print(f'  … and {len(rows) - 40} more', file=sys.stderr)
for p in problems[:40]:
    print('  ' + p, file=sys.stderr)
if len(problems) > 40:
    print(f'  … and {len(problems) - 40} more diagnostics', file=sys.stderr)

detail = ', '.join(f'{k}={v}' for k, v in skipped.items() if v)
print(f'\n{len(rows)} to import' + (f' — skipped: {detail}' if detail else ''), file=sys.stderr)
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

# Optionally stamp the category on each manifest row (column 3).
if [[ -n "$CATEGORY" ]]; then
  awk -F'\t' -v c="$CATEGORY" 'BEGIN{OFS="\t"} {print $1,$2,c,$4}' "$MANIFEST" > "$MANIFEST.cat" \
    && mv "$MANIFEST.cat" "$MANIFEST"
fi

echo "[acquire] importing $(wc -l < "$MANIFEST" | tr -d ' ') form(s) via import-batch.sh …"
exec scripts/import-batch.sh "$MANIFEST"
