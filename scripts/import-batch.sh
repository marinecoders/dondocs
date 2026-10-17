#!/usr/bin/env bash
# Download, flatten, harvest and prepare candidates from a TSV manifest.
# Usage: scripts/import-batch.sh <manifest.tsv> [cache-dir]
# Columns: id, folder, optional category, optional registry form number.
# Use "-" for an omitted category. REHARVEST=1 reuses existing source pages.
# Review and publication are separate commands; see docs/FORM_TEMPLATES.md.
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

# Read catalog flags per form so concurrent imports see current state.
row_flag() {
  python3 - "$1" "$2" <<'PYP'
import json, sys
folder, key = sys.argv[1], sys.argv[2]
idx = json.load(open('public/templates/index.json'))
sys.exit(0 if any(t.get('sourceDirectory', t['directory']) == folder and t.get(key) for t in idx['templates']) else 1)
PYP
}

imported=0 skipped=0 refused=0 failed=0 warned=0
while IFS=$'\t' read -r id folder category number || [[ -n "$id" ]]; do
  [[ -z "$id" || "$id" == \#* ]] && continue
  # acquire-form.sh writes "-" for "no category" because bash collapses an
  # empty tab-delimited field and shifts every later column left.
  [[ "$category" == "-" ]] && category=""
  formwarn=0  # harvest and preparation can both warn; the form still counts once
  if [[ -f "public/templates/$folder/boxes.json" ]] || row_flag "$folder" builtin; then
    echo "[protected] $folder — hand-built form; refusing to re-import"
    skipped=$((skipped+1)); continue
  fi
  if [[ -f "public/templates/$folder/form.candidate.json" && "${REHARVEST:-0}" != 1 ]]; then
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
    [[ ! -d "public/templates/$folder" ]] && { skipped=$((skipped+1)); continue; }
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
  hout="$(FORM_SOURCE_URL="$API/$id/file" FORM_REGISTRY_ID="$id" python3 scripts/harvest-fields.py "$pdf" "$folder" 2>&1)"
  if [[ $? -ne 0 ]]; then
    echo "[fail-harvest] $folder: $(grep -m1 'REFUSED\|Error\|error' <<<"$hout" || tail -1 <<<"$hout")"
    failed=$((failed+1)); continue
  fi
  if grep -q 'WARN:' <<<"$hout"; then
    formwarn=1
    echo "[warn] $folder — harvest dropped or mislocated fields:"
    grep 'WARN:' <<<"$hout" | head -4 | sed 's/^/  /'
  fi

  # Compile and measure a candidate; leave the published revision untouched.
  pout="$(python3 scripts/promote_form.py "$folder" "${category:-}" 2>&1)"
  if [[ $? -ne 0 ]]; then
    echo "[fail-prepare] $folder: $(tail -1 <<<"$pout")"; failed=$((failed+1)); continue
  fi
  if grep -q 'WARN:' <<<"$pout"; then
    formwarn=1
    echo "[warn] $folder — candidate preparation reported warnings:"
    grep 'WARN:' <<<"$pout" | head -4 | sed 's/^/  /'
  fi
  imported=$((imported+1))
  (( formwarn )) && warned=$((warned+1))
  (( imported % 25 == 0 )) && echo "[batch] $imported imported, $refused queued, $failed failed"
done < "$MANIFEST"

echo "[batch] DONE — prepared=$imported skipped=$skipped xfa-queued=$refused failed=$failed warned=$warned"
(( warned > 0 )) && echo "[batch] $warned form(s) imported WITH WARNINGS — review those before trusting their fields"
echo "[batch] xfa manual queue: $(($(wc -l < "$QUEUE") - 1)) forms in $QUEUE"

# Report failure in the exit code. This used to end on an echo, so the script
# returned that echo's status — always 0 — and a run that failed forty forms
# looked like a success to anything checking. acquire-form.sh propagates this
# exit status to its caller.
#
# Only `failed` is fatal. An xfa-queued form is an expected outcome parked in
# docs/xfa-manual-queue.tsv, and a warned form did import — it just needs a look
# before its fields are trusted. Both are reported above; neither is an error.
if (( failed > 0 )); then
  echo "[batch] FAILED — $failed form(s) did not import" >&2
  exit 1
fi
