#!/usr/bin/env bash
# Batch-import NAVMC/OPNAV/NAVPERS forms from a manifest through the full
# pipeline: acquire (DON Forms API by id, cached) -> flatten -> harvest ->
# promote to a live config form -> reconcile index.json. Idempotent and
# resumable (a finished form has a form.json and is skipped). Dynamic-XFA forms
# the flattener refuses are recorded in docs/xfa-manual-queue.tsv, never lost.
#
#   scripts/import-batch.sh <manifest.tsv> [cache-dir]
#
# Manifest: one form per line, tab-separated
# `id<TAB>folder[<TAB>category[<TAB>formNumber]]`. `#`-comment and blank lines
# are ignored. When category is "-" or omitted the importer derives it (SSIC
# from the page text); write "-" rather than an empty field, because tab is IFS
# whitespace and bash collapses "\t\t" into one delimiter, shifting the columns
# after it left. formNumber is the registry's own string ("OPNAV 1650/3"): the
# folder token cannot be inverted back into it, so passing it through is what
# lets the catalog show a non-NAVMC number the way the form prints it. This is
# the single committed batch tool — it replaces the per-family scratchpads.
#
# REHARVEST=1 re-runs the harvester on folders that ALREADY exist (after a
# harvester change), reusing their flattened pages: fetch original -> harvest
# -> promote, no re-flatten. New/missing folders are skipped in this mode.
#
# A re-harvest updates GEOMETRY only. The committed form.json stays the truth
# for labels, required/multiline/options, sections and row-group shape, so hand
# corrections survive — which also means an improved harvester label does NOT
# land on a form that already has one. Delete its form.json to force a fresh
# import. See scripts/promote_form.py.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || { echo "cannot cd to repo root: $ROOT" >&2; exit 1; }

MANIFEST="${1:-}"
CACHE="${2:-${TMPDIR:-/tmp}/dondocs-form-cache}"
if [[ -z "$MANIFEST" || ! -f "$MANIFEST" ]]; then
  echo "usage: $0 <manifest.tsv> [cache-dir]   (manifest: id<TAB>folder[<TAB>category])" >&2
  exit 2
fi
mkdir -p "$CACHE"
QUEUE="$ROOT/docs/xfa-manual-queue.tsv"
[[ -f "$QUEUE" ]] || printf 'form\tid\treason\n' > "$QUEUE"

UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
API='https://dso.dla.mil/DONNavyForms-RequestService/api/forms'

# `row_flag <folder> <key>` — true when index.json marks that form's row.
#
#   verified  hand-built forms whose geometry lives in TypeScript generators.
#             They carry boxes.json instead of form.json, so the "already has a
#             form.json" skip below cannot see them, and re-importing would
#             overwrite their reviewed pages and flip them to a robot draft.
#   config    the promote step finished. form.json ALONE does not mean finished:
#             a promote that died between writing the file and committing the
#             row leaves an orphan, and keying on the file made that folder
#             unreachable — skipped forever here, unregisterable under REHARVEST.
#
# Read per form rather than snapshotted at startup: a human (or a second batch)
# can mark a form verified while this run is still walking a manifest of
# thousands, and a stale snapshot would overwrite the pages they just reviewed.
row_flag() {
  python3 - "$1" "$2" <<'PYP'
import json, sys
folder, key = sys.argv[1], sys.argv[2]
idx = json.load(open('public/templates/index.json'))
sys.exit(0 if any(t['directory'] == folder and t.get(key) for t in idx['templates']) else 1)
PYP
}

imported=0 skipped=0 refused=0 failed=0 warned=0
while IFS=$'\t' read -r id folder category number || [[ -n "$id" ]]; do
  [[ -z "$id" || "$id" == \#* ]] && continue
  # acquire-form.sh writes "-" for "no category" because bash collapses an
  # empty tab-delimited field and shifts every later column left.
  [[ "$category" == "-" ]] && category=""
  formwarn=0  # harvest and promote can both warn; the form still counts once
  if [[ -f "public/templates/$folder/boxes.json" ]] || row_flag "$folder" verified; then
    echo "[protected] $folder — hand-built form; refusing to re-import"
    skipped=$((skipped+1)); continue
  fi
  exists=0
  if [[ -f "public/templates/$folder/form.json" ]]; then
    if row_flag "$folder" config; then
      exists=1
    else
      echo "[orphan]    $folder — form.json without a config row; re-importing"
    fi
  fi
  # Import mode skips finished folders; re-harvest mode only touches them.
  if [[ "${REHARVEST:-0}" == 1 ]]; then
    [[ $exists -eq 0 ]] && { skipped=$((skipped+1)); continue; }
  elif [[ $exists -eq 1 ]]; then
    skipped=$((skipped+1)); continue
  fi

  pdf="$CACHE/$id.pdf"
  if [[ ! -s "$pdf" ]]; then
    curl -sf -m 90 -A "$UA" -H 'accept: application/json' "$API/$id/file" -o "$pdf" || true
    sleep 0.25
  fi
  if [[ ! -s "$pdf" ]] || ! head -c4 "$pdf" | grep -q '%PDF'; then
    echo "[fail-dl]   $folder"; failed=$((failed+1)); rm -f "$pdf"; continue
  fi

  # Import mode flattens (import-navmc.sh); re-harvest reuses existing pages.
  if [[ "${REHARVEST:-0}" != 1 ]]; then
    out="$(scripts/import-navmc.sh "$pdf" "$folder" "" "${number:-}" 2>&1)"; rc=$?
    if [[ $rc -ne 0 ]]; then
      if grep -qiE "XFA|placeholder|please wait|REFUSED" <<<"$out"; then
        echo "[xfa-queue] $folder"; refused=$((refused+1))
        grep -qF "	$id	" "$QUEUE" || printf '%s\t%s\tdynamic-xfa (needs Acrobat flatten)\n' "$folder" "$id" >> "$QUEUE"
      else
        echo "[fail-import] $folder: $(tail -1 <<<"$out")"; failed=$((failed+1))
      fi
      continue
    fi
  fi

  # Capture rather than discard: the harvester warns when fields map to pages
  # the template does not have, or when a box falls outside the page. Both are
  # silent data loss — a 76-field form imported with 45 fields and reported as
  # a success — so the warnings are surfaced and counted, not sent to /dev/null.
  hout="$(python3 scripts/harvest-fields.py "$pdf" "$folder" 2>&1)"
  if [[ $? -ne 0 ]]; then
    echo "[fail-harvest] $folder: $(grep -m1 'REFUSED\|Error\|error' <<<"$hout" || tail -1 <<<"$hout")"
    failed=$((failed+1)); continue
  fi
  if grep -q 'WARN:' <<<"$hout"; then
    formwarn=1
    echo "[warn] $folder — harvest dropped or mislocated fields:"
    grep 'WARN:' <<<"$hout" | head -4 | sed 's/^/  /'
  fi

  # Promote draft -> live form.json and flip the index row to config:true.
  # The committed form.json wins on meaning and the draft only on geometry, so
  # a re-harvest cannot revert hand edits; what it stops seeing is kept and
  # warned about. The row is located before anything is written, so a missing
  # one is a refusal rather than a refusal plus an orphan.
  pout="$(python3 scripts/promote_form.py "$folder" "${category:-}" 2>&1)"
  if [[ $? -ne 0 ]]; then
    echo "[fail-promote] $folder: $(tail -1 <<<"$pout")"; failed=$((failed+1)); continue
  fi
  if grep -q 'WARN:' <<<"$pout"; then
    formwarn=1
    echo "[warn] $folder — promote kept edits this harvest disagrees with:"
    grep 'WARN:' <<<"$pout" | head -4 | sed 's/^/  /'
  fi
  imported=$((imported+1))
  (( formwarn )) && warned=$((warned+1))
  (( imported % 25 == 0 )) && echo "[batch] $imported imported, $refused queued, $failed failed"
done < "$MANIFEST"

echo "[batch] DONE — imported=$imported skipped=$skipped xfa-queued=$refused failed=$failed warned=$warned"
(( warned > 0 )) && echo "[batch] $warned form(s) imported WITH WARNINGS — review those before trusting their fields"
echo "[batch] xfa manual queue: $(($(wc -l < "$QUEUE") - 1)) forms in $QUEUE"

# Report failure in the exit code. This used to end on an echo, so the script
# returned that echo's status — always 0 — and a run that failed forty forms
# looked like a success to anything checking. acquire-form.sh `exec`s this, so
# the front door inherited the lie.
#
# Only `failed` is fatal. An xfa-queued form is an expected outcome parked in
# docs/xfa-manual-queue.tsv, and a warned form did import — it just needs a look
# before its fields are trusted. Both are reported above; neither is an error.
if (( failed > 0 )); then
  echo "[batch] FAILED — $failed form(s) did not import" >&2
  exit 1
fi
