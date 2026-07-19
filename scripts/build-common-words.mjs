#!/usr/bin/env node
/**
 * Dev-only tool: build the common-English-words guard list that keeps the fuzzy
 * ("did you mean") abbreviation suggester from firing on ordinary words.
 *
 * The fuzzy pass only offers an approved abbreviation for a mistyped term when
 * the typed word is NOT itself a common English word and does NOT merely look
 * like a typo of one. That test needs a word list; this bakes one into a
 * committed dataset so the app ships it (no runtime network — air-gap safe).
 *
 * Not part of the build. Run manually to refresh from the pinned source:
 *
 *   node scripts/build-common-words.mjs
 *
 * Source: first20hours/google-10000-english (the ~10k most frequent English
 * words), no-swears list. We keep words >=7 characters — the fuzzy pass only
 * considers tokens >=8 characters, and a distance-1 common word is >=7. Review
 * the diff before committing.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SOURCE =
  'https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-no-swears.txt';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/data/abbreviations/common-words.generated.json');
const MIN_LEN = 7;

const res = await fetch(SOURCE);
if (!res.ok) {
  console.error(`[common-words] fetch failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const raw = (await res.text()).split(/\r?\n/).map((w) => w.trim().toLowerCase());
const words = [...new Set(raw.filter((w) => /^[a-z]+$/.test(w) && w.length >= MIN_LEN))].sort();

const payload = {
  source: 'google-10000-english (first20hours), no-swears list',
  note: `Common English words (>=${MIN_LEN} chars) used to suppress fuzzy abbreviation suggestions: a typed word that IS a common word, or looks like a typo of one, is left alone.`,
  count: words.length,
  words,
};
writeFileSync(OUT, JSON.stringify(payload) + '\n');
console.log(`[common-words] wrote ${words.length} words to ${OUT}`);
