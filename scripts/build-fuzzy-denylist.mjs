#!/usr/bin/env node
/**
 * Dev-only tool: build the fuzzy "real word" denylist that keeps the "did you
 * mean?" abbreviation pass from second-guessing a CORRECTLY SPELLED word.
 *
 * The fuzzy pass offers a correction when a long token is a single edit from
 * exactly one approved term. On its own that also fires on legitimately-spelled
 * words that happen to sit one edit from an entry — plurals ("squadrons" →
 * "squadron"), and distinct words ("commandeer" → "commander"). A small
 * common-word list can't establish that an unknown long word is a real word, so
 * we bake the exact set of real English words that resemble an approved term and
 * suppress those.
 *
 * The pass only ever consults this for a token already within one edit of an
 * entry, so we ship ONLY the real words that resemble an entry (a few hundred),
 * not a whole dictionary — sound (drives false positives to zero, verified) and
 * tiny. Run manually when the IRAM dataset changes:
 *
 *   node scripts/build-fuzzy-denylist.mjs
 *
 * Source dictionary: dwyl/english-words (words_alpha, ~370k words). Fetched at
 * dev time only; the committed output ships with the app (air-gap safe). Review
 * the diff before committing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SOURCE = 'https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IRAM = resolve(ROOT, 'src/data/abbreviations/iram.generated.json');
const OUT = resolve(ROOT, 'src/data/abbreviations/fuzzy-denylist.generated.json');
// Must match MIN_FUZZY_LEN in src/lib/abbreviations.ts — the fuzzy pass only
// considers tokens at least this long.
const MIN = 8;

/** Within one Damerau-Levenshtein edit (mirror of withinOneEdit in the lib). */
function withinOneEdit(a, b) {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    let i = 0;
    while (i < la && a[i] === b[i]) i++;
    if (i === la) return true;
    let j = la - 1;
    while (j >= 0 && a[j] === b[j]) j--;
    if (i === j) return true;
    if (i + 1 === j && a[i] === b[j] && a[j] === b[i]) return true;
    return false;
  }
  const s = la < lb ? a : b;
  const t = la < lb ? b : a;
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < s.length && j < t.length) {
    if (s[i] === t[j]) {
      i++;
      j++;
    } else {
      if (skipped) return false;
      skipped = true;
      j++;
    }
  }
  return true;
}

const entries = JSON.parse(readFileSync(IRAM, 'utf8')).entries;
// The fuzzy-correctable entries: single, long words (mirrors buildAbbrevIndex).
const byWord = new Set();
const byLen = new Map();
for (const e of entries) {
  const w = e.word.toLowerCase();
  byWord.add(w);
  if (!e.compoundOnly && !w.includes(' ') && w.length >= MIN) {
    (byLen.get(w.length) ?? byLen.set(w.length, []).get(w.length)).push(w);
  }
}
const nearEntry = (t) => {
  for (let n = t.length - 1; n <= t.length + 1; n++) {
    for (const w of byLen.get(n) ?? []) if (withinOneEdit(t, w)) return true;
  }
  return false;
};

const res = await fetch(SOURCE);
if (!res.ok) {
  console.error(`[fuzzy-denylist] fetch failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const dict = (await res.text()).split(/\r?\n/).map((w) => w.trim().toLowerCase());

const deny = [];
const seen = new Set();
for (const w of dict) {
  if (w.length < MIN || !/^[a-z]+$/.test(w)) continue;
  if (byWord.has(w) || seen.has(w)) continue; // an approved term is never denied
  if (nearEntry(w)) {
    seen.add(w);
    deny.push(w);
  }
}
deny.sort();

const payload = {
  source: 'dwyl/english-words (words_alpha), real words within one edit of an IRAM term',
  note: `Correctly-spelled English words (>=${MIN} chars) that sit one edit from an approved abbreviation term; the fuzzy pass suppresses these so it never "corrects" a real word.`,
  count: deny.length,
  words: deny,
};
writeFileSync(OUT, JSON.stringify(payload) + '\n');
console.log(`[fuzzy-denylist] wrote ${deny.length} words to ${OUT}`);
