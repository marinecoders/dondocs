/**
 * Pure helpers for the authorized-abbreviation suggestion feature (issue #25):
 * build a fast lookup index from an abbreviation set, find which approved
 * abbreviations apply to a piece of text, and apply one. Suggestion only — the
 * drafter clicks to apply; nothing rewrites their text on its own.
 *
 * Leaf and unit-tested, independent of the data source and the UI.
 */

import type { AbbrevEntry } from '@/data/abbreviations';

export interface AbbrevIndex {
  /** lowercased word/phrase → entry. */
  byWord: Map<string, AbbrevEntry>;
  /** Longest phrase length (in words) present, so scanning can try phrases first. */
  maxWords: number;
}

/** Build a lookup index, dropping compound-only entries (they can't stand alone). */
export function buildAbbrevIndex(entries: readonly AbbrevEntry[]): AbbrevIndex {
  const byWord = new Map<string, AbbrevEntry>();
  let maxWords = 1;
  for (const e of entries) {
    if (e.compoundOnly) continue;
    const key = e.word.toLowerCase();
    if (!byWord.has(key)) {
      byWord.set(key, e);
      const words = key.split(/\s+/).length;
      if (words > maxWords) maxWords = words;
    }
  }
  return { byWord, maxWords };
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
      // Skip if it doesn't shorten, or the text is already the abbreviation.
      if (entry.abbr.length >= source.length) break;
      if (source.toLowerCase() === entry.abbr.toLowerCase()) break;
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
