#!/usr/bin/env node
/**
 * Dev-only tool: extract the IRAM's authorized recordkeeping abbreviations
 * (MCO P1070.12K, ch. 6, ¶6002.10a "Commonly used Words, Acronyms and Their
 * Combinations") into a committed dataset the app ships.
 *
 * Not part of the build (no pdftotext at build time / on the air-gapped target).
 * Run manually when the source PDF changes:
 *
 *   node scripts/extract-iram-abbreviations.mjs
 *
 * Reads docs/"MCO P1070.12K W CH 1.pdf" via pdftotext and writes
 * src/data/abbreviations/iram.generated.json. Review the diff before committing.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PDF = resolve(ROOT, 'docs/MCO P1070.12K W CH 1.pdf');
const OUT = resolve(ROOT, 'src/data/abbreviations/iram.generated.json');

if (!existsSync(PDF)) {
  console.error(`[iram] source PDF not found: ${PDF}`);
  process.exit(1);
}

let text;
try {
  text = execFileSync('pdftotext', ['-layout', PDF, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (err) {
  console.error('[iram] pdftotext failed (install poppler): ' + (err?.message ?? err));
  process.exit(1);
}

const lines = text.split(/\r?\n/);

// The word list runs from its header entry ("ABBREVIATION ..... abbr") to the
// next sub-section ("b. Phrases, Sentences, ...").
const start = lines.findIndex((l) => /^\s*ABBREVIATION\s*\.{3,}\s*abbr\s*$/.test(l));
const end = lines.findIndex((l, i) => i > start && /^\s*b\.\s+Phrases/.test(l));
if (start === -1 || end === -1) {
  console.error('[iram] could not locate the ¶6002.10a word list bounds');
  process.exit(1);
}

// Page furniture between real rows: page numbers ("6-5"), the running header /
// footer ("6002", "IRAM", "6002   IRAM", "IRAM   6002"), chapter markers, or a
// bare number. These are ignored WITHOUT clearing the wrapped-word buffer.
const NOISE = /^\s*(?:6-\d+|CHAPTER.*|(?:600[0-9]|IRAM)(?:\s+(?:600[0-9]|IRAM))?|\d+)\s*$/;
// A dot-leader row: "FULL WORD/PHRASE ..... abbr". Threshold 2+ dots so a
// near-full-width term with only a short leader is still captured.
const ROW = /^(.*?)\.{2,}\s*(\*?[A-Za-z0-9/().\- ]+?)\s*$/;

/** Normalize the left side to a lookup key: drop the " -ING"/" -INC" grammatical
 *  suffix markers (hyphen directly attached — NOT " - AEROLOGY" specialty
 *  suffixes, which are distinct terms), and collapse whitespace. */
function cleanWord(raw) {
  return raw
    .replace(/\s+-[A-Za-z]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve an abbr field to a usable abbreviation + compound-only flag. The IRAM
 * marks only compound-only alternatives with a leading "*", and a field may list
 * alternatives as "X or Y" (e.g. "*Mer or coml"). Prefer the first alternative
 * that is NOT compound-only; the entry is compound-only only if every one is.
 */
function resolveAbbr(field) {
  const alts = field.split(/\s+or\s+/).map((a) => a.trim()).filter(Boolean);
  const usable = alts.find((a) => !a.startsWith('*'));
  if (usable) return { abbr: usable, compoundOnly: false };
  return { abbr: (alts[0] || field).replace(/^\*/, '').trim(), compoundOnly: true };
}

const seen = new Map(); // lowercased word -> entry (first wins)
const dropped = []; // same-word/different-abbr rows we couldn't keep
let buffer = '';

// The "ABBREVIATION ..... abbr" line that anchors the list is itself the FIRST
// DATA ROW (the word "abbreviation" -> "abbr"), not a column caption: headers in
// this manual (see section b's "PHRASE EQUIVALENT  MEANING") carry no dot
// leader, and the row sits exactly where alphabetical order puts it (before
// ABOARD). Start AT it, not past it.
for (let i = start; i < end; i++) {
  const line = lines[i];
  const m = line.match(ROW);
  if (m) {
    const word = cleanWord(`${buffer} ${m[1]}`.trim());
    const { abbr, compoundOnly } = resolveAbbr(m[2].trim());
    buffer = '';
    const key = word.toLowerCase();
    if (word && abbr) {
      if (!seen.has(key)) {
        seen.set(key, compoundOnly ? { word, abbr, compoundOnly } : { word, abbr });
      } else if (seen.get(key).abbr !== abbr) {
        dropped.push({ word, abbr, keptAbbr: seen.get(key).abbr });
      }
    }
    continue;
  }
  const s = line.trim();
  if (!s || NOISE.test(line)) continue; // blank / page furniture — keep the buffer
  buffer = `${buffer} ${s}`.trim(); // a wrapped word head — buffer it for the next row
}

if (dropped.length) {
  console.warn(`[iram] ${dropped.length} same-word rows with a different abbr were not kept (lookup is one-per-word):`);
  for (const d of dropped) console.warn(`  "${d.word}" -> ${d.abbr} (kept ${d.keptAbbr})`);
}

const entries = [...seen.values()].sort((a, b) => a.word.localeCompare(b.word));
const payload = {
  source: 'MCO P1070.12K (IRAM), ch. 6 ¶6002.10a',
  note: 'Authorized recordkeeping abbreviations. compoundOnly entries may only be used inside a compound abbreviation (IRAM ¶6001.2).',
  count: entries.length,
  entries,
};
writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
console.log(`[iram] wrote ${entries.length} abbreviations to ${OUT}`);
