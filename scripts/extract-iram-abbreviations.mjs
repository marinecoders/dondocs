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

// A page header/footer or chapter marker — noise between real rows.
const NOISE = /^\s*(6-\d+|600[0-9]|IRAM|CHAPTER.*|\d+)\s*$/;
// A dot-leader row: "FULL WORD/PHRASE ....... abbr".
const ROW = /^(.*?)\.{4,}\s*(\*?[A-Za-z0-9/().\- ]+?)\s*$/;
// A bare wrapped fragment (the head of a word that continued onto this line).
const WRAP = /^\s*[A-Z][A-Z /-]*$/;

/** Normalize the left side to a lookup key: drop the compound-only asterisk,
 *  the " -INC -ING" suffix-variant markers, and collapse whitespace. */
function cleanWord(raw) {
  return raw
    .replace(/\s+-\s*[A-Za-z]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const seen = new Map(); // lowercased word -> entry (first wins)
let buffer = '';

for (let i = start; i < end; i++) {
  const line = lines[i];
  const m = line.match(ROW);
  if (m) {
    const word = cleanWord(`${buffer} ${m[1]}`.trim());
    let abbr = m[2].trim();
    const compoundOnly = abbr.startsWith('*');
    if (compoundOnly) abbr = abbr.replace(/^\*/, '').trim();
    buffer = '';
    const key = word.toLowerCase();
    if (word && abbr && !seen.has(key)) {
      seen.set(key, compoundOnly ? { word, abbr, compoundOnly } : { word, abbr });
    }
    continue;
  }
  const s = line.trim();
  if (s && WRAP.test(s) && !NOISE.test(line)) {
    buffer = `${buffer} ${s}`.trim();
  } else if (!NOISE.test(line)) {
    buffer = '';
  }
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
