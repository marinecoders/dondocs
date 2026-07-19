/**
 * Pure helpers for the authorized-abbreviation suggestion feature (issue #25):
 * build a fast lookup index from an abbreviation set, find which approved
 * abbreviations apply to a piece of text, and apply one. Suggestion only — the
 * drafter clicks to apply; nothing rewrites their text on its own.
 *
 * Leaf and unit-tested, independent of the data source and the UI.
 */

import type { AbbrevEntry } from '@/data/abbreviations';

/**
 * The shortest token length the fuzzy ("did you mean") pass will consider. Short
 * words are dense with near-neighbours — a one-edit slip turns too many of them
 * into an unrelated real word — so typo correction is confined to long tokens,
 * where a single-edit match is far more likely to be a genuine misspelling.
 */
export const MIN_FUZZY_LEN = 8;

export interface AbbrevIndex {
  /** lowercased word/phrase → entry. */
  byWord: Map<string, AbbrevEntry>;
  /** Longest phrase length (in words) present, so scanning can try phrases first. */
  maxWords: number;
  /**
   * Single-word entries whose word is >= MIN_FUZZY_LEN, bucketed by exact word
   * length, so the fuzzy pass only compares a token against the few entries that
   * could be one edit away (length ±1).
   */
  byLen: Map<number, AbbrevEntry[]>;
}

/** Build a lookup index, dropping compound-only entries (they can't stand alone). */
export function buildAbbrevIndex(entries: readonly AbbrevEntry[]): AbbrevIndex {
  const byWord = new Map<string, AbbrevEntry>();
  const byLen = new Map<number, AbbrevEntry[]>();
  let maxWords = 1;
  for (const e of entries) {
    if (e.compoundOnly) continue;
    const key = e.word.toLowerCase();
    if (!byWord.has(key)) {
      byWord.set(key, e);
      const words = key.split(/\s+/).length;
      if (words > maxWords) maxWords = words;
      // Only single, long words are fuzzy-correctable (phrases and short words
      // are excluded — the abbr must also be shorter, checked when we emit).
      if (words === 1 && key.length >= MIN_FUZZY_LEN) {
        const bucket = byLen.get(key.length);
        if (bucket) bucket.push(e);
        else byLen.set(key.length, [e]);
      }
    }
  }
  return { byWord, maxWords, byLen };
}

// Word tokens (letters, with internal ' / -), keeping their positions.
const TOKEN_RE = /[A-Za-z][A-Za-z'/-]*/g;

interface Token {
  text: string;
  start: number;
  end: number;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

/** A place in the text where an approved abbreviation applies. */
export interface AbbrevMatch {
  entry: AbbrevEntry;
  /** Offsets of the full word/phrase in the source text. */
  start: number;
  end: number;
  /** The matched source text (original casing). */
  text: string;
}

/**
 * Scan `text` for words/phrases that have an approved abbreviation, longest
 * phrase first, non-overlapping, left to right. Only returns a match when the
 * abbreviation is actually shorter and the text isn't already the abbreviation.
 */
export function scanAbbreviations(text: string, index: AbbrevIndex): AbbrevMatch[] {
  const tokens = tokenize(text);
  const matches: AbbrevMatch[] = [];
  let i = 0;
  while (i < tokens.length) {
    let matched: AbbrevMatch | null = null;
    const maxK = Math.min(index.maxWords, tokens.length - i);
    for (let k = maxK; k >= 1; k--) {
      const phraseTokens = tokens.slice(i, i + k);
      const key = phraseTokens.map((t) => t.text).join(' ').toLowerCase();
      const entry = index.byWord.get(key);
      if (!entry) continue;
      const start = phraseTokens[0].start;
      const end = phraseTokens[k - 1].end;
      const source = text.slice(start, end);
      // Not usable at this length — fall through to a shorter phrase at the same
      // start (`continue`, not `break`): e.g. a non-shortening multi-word entry
      // must not shadow a valid one-word entry nested at the same position.
      if (entry.abbr.length >= source.length) continue;
      if (source.toLowerCase() === entry.abbr.toLowerCase()) continue;
      matched = { entry, start, end, text: source };
      i += k; // consume the phrase
      break;
    }
    if (matched) matches.push(matched);
    else i += 1;
  }
  return matches;
}

/** Unique entries (first-occurrence order) that apply to `text`. */
export function findApplicableAbbreviations(text: string, index: AbbrevIndex): AbbrevEntry[] {
  const seen = new Set<string>();
  const out: AbbrevEntry[] = [];
  for (const m of scanAbbreviations(text, index)) {
    const key = m.entry.word.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(m.entry);
    }
  }
  return out;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replace every whole-word occurrence of `entry.word` in `text` with its
 * abbreviation. Boundaries use letter-lookarounds (not `\b`) so phrases that
 * start/end on punctuation ("a/c") still match cleanly.
 */
export function applyAbbreviation(text: string, entry: AbbrevEntry): string {
  const re = new RegExp(`(?<![A-Za-z])${escapeRegExp(entry.word)}(?![A-Za-z])`, 'gi');
  return text.replace(re, entry.abbr);
}

/**
 * Replace a set of scanned matches by their offsets, right-to-left in a single
 * pass. Unlike repeated whole-word replaces, this composes correctly: applying a
 * standalone "service" match can't clobber the "service record" phrase match,
 * because each match owns a fixed, non-overlapping span. Overlapping or
 * out-of-range matches are skipped defensively.
 */
export function applyMatches(text: string, matches: readonly AbbrevMatch[]): string {
  const ordered = [...matches].sort((a, b) => b.start - a.start);
  let out = text;
  let lastStart = out.length + 1;
  for (const m of ordered) {
    if (m.start < 0 || m.end > out.length || m.end > lastStart) continue; // out of range / overlaps a later splice
    out = out.slice(0, m.start) + m.entry.abbr + out.slice(m.end);
    lastStart = m.start;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fuzzy "did you mean" pass (issue #25 — typo-tolerant suggestions).
//
// Exact matching leaves a mistyped word unhelped: "battaion" never resolves to
// "battalion" -> "Bn". This pass offers a correction, but only under strict
// guards, because a careless fuzzy match is worse than none — silently steering
// a correctly spelled word toward a military abbreviation would erode trust in
// the whole feature. A token is only offered a correction when ALL hold:
//   1. it is at least MIN_FUZZY_LEN characters (short words are too dense);
//   2. it is not itself an approved entry (that's the exact pass's job);
//   3. it is not a common English word, and doesn't merely look like a typo of
//      one (the caller supplies that test — see isTypoOfCommonWord);
//   4. exactly one approved entry sits within a single edit of it (no ambiguity);
//   5. that entry's abbreviation is actually shorter.
// ---------------------------------------------------------------------------

/**
 * True when `a` and `b` are within one Damerau-Levenshtein edit — a single
 * insertion, deletion, substitution, or adjacent transposition (distance 0 or
 * 1). Bounded and allocation-free: it early-outs on the length gap and walks the
 * strings once, so it is cheap to call across a length-bucketed candidate set.
 */
export function withinOneEdit(a: string, b: string): boolean {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;

  if (la === lb) {
    // Equal length: at most one substitution, or one adjacent transposition.
    let i = 0;
    while (i < la && a[i] === b[i]) i++;
    if (i === la) return true; // identical
    let j = la - 1;
    while (j >= 0 && a[j] === b[j]) j--;
    if (i === j) return true; // one differing position → substitution
    // Two adjacent differing positions that swap → transposition.
    if (i + 1 === j && a[i] === b[j] && a[j] === b[i]) return true;
    return false;
  }

  // Lengths differ by one: one insertion/deletion. Walk with `s` the shorter.
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
      if (skipped) return false; // a second mismatch → distance > 1
      skipped = true;
      j++; // consume the extra character in the longer string
    }
  }
  return true;
}

/** A fuzzy suggestion: the approved entry, the mistyped source token, its span. */
export interface FuzzyMatch {
  entry: AbbrevEntry;
  /** Offsets of the mistyped token in the source text. */
  start: number;
  end: number;
  /** The mistyped source token (original casing). */
  typed: string;
}

/** The lone entry within one edit of `token`, or null if none or more than one. */
function uniqueFuzzyEntry(token: string, index: AbbrevIndex): AbbrevEntry | null {
  let found: AbbrevEntry | null = null;
  for (let n = token.length - 1; n <= token.length + 1; n++) {
    const bucket = index.byLen.get(n);
    if (!bucket) continue;
    for (const e of bucket) {
      if (!withinOneEdit(token, e.word.toLowerCase())) continue;
      if (found && found !== e) return null; // ambiguous — two candidates
      found = e;
    }
  }
  return found;
}

/**
 * Scan `text` for likely misspellings of an approved word and suggest the
 * correction. Returns a separate channel from {@link scanAbbreviations} so the UI
 * can present these as tentative "did you mean" prompts, distinct from the exact
 * matches. `nearestCommonWord(token)` returns the ordinary English word the token
 * is (or looks like a one-edit slip of), or null — a match to a *different* word
 * than the entry means the token is more likely an everyday-word typo, so it is
 * left alone. Tokens already covered by an exact match are skipped.
 */
export function scanTypos(
  text: string,
  index: AbbrevIndex,
  nearestCommonWord: (token: string) => string | null
): FuzzyMatch[] {
  if (index.byLen.size === 0) return [];
  const covered = scanAbbreviations(text, index);
  const out: FuzzyMatch[] = [];
  const seen = new Set<string>();
  let ci = 0;
  for (const tk of tokenize(text)) {
    if (tk.text.length < MIN_FUZZY_LEN) continue;
    // Skip tokens that fall inside an exact match's span (exact scan is ordered
    // left-to-right, so advance a pointer rather than rescanning).
    while (ci < covered.length && covered[ci].end <= tk.start) ci++;
    if (ci < covered.length && tk.start < covered[ci].end && tk.end > covered[ci].start) continue;

    const lc = tk.text.toLowerCase();
    if (index.byWord.has(lc)) continue; // exactly an approved entry — not a typo
    if (seen.has(lc)) continue;

    const entry = uniqueFuzzyEntry(lc, index);
    if (!entry) continue;
    if (entry.abbr.length >= tk.text.length) continue; // correction must save space

    // Leave the token alone if it is — or looks like a typo of — an ordinary word
    // OTHER than the entry itself. (When the nearby word IS the entry's word, the
    // token is simply a misspelling of that approved term, which is what we want
    // to catch: "battaion" -> "battalion", even though "battalion" is common.)
    const near = nearestCommonWord(lc);
    if (near && near !== entry.word.toLowerCase()) continue;

    seen.add(lc);
    out.push({ entry, start: tk.start, end: tk.end, typed: tk.text });
  }
  return out;
}

/**
 * Build the common-word lookup the fuzzy pass needs from a word list. Returns a
 * function that gives the ordinary English word a lowercased token IS, or is
 * within one edit of (or null) — so the scan can tell an everyday-word typo from
 * a mistyped military term.
 */
export function makeCommonWordLookup(words: readonly string[]): (token: string) => string | null {
  const set = new Set(words);
  const byLen = new Map<number, string[]>();
  for (const w of words) {
    const bucket = byLen.get(w.length);
    if (bucket) bucket.push(w);
    else byLen.set(w.length, [w]);
  }
  return (token: string): string | null => {
    if (set.has(token)) return token;
    for (let n = token.length - 1; n <= token.length + 1; n++) {
      const bucket = byLen.get(n);
      if (!bucket) continue;
      for (const w of bucket) if (withinOneEdit(token, w)) return w;
    }
    return null;
  };
}
