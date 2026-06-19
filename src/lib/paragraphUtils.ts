/**
 * Paragraph Utilities for DONDOCS
 *
 * Consolidates paragraph labeling, counting, and word counting logic
 * used across LaTeX generation, DOCX generation, and the editor.
 */

import { PARAGRAPH } from './constants';
import { stripLatexFormatting } from './encoding';

/**
 * Paragraph label pattern generators
 * Each pattern takes a count (1-indexed) and returns the formatted label
 */
const LABEL_PATTERNS = [
  (n: number) => `${n}.`,                           // 1. 2. 3.
  (n: number) => `${String.fromCharCode(96 + n)}.`, // a. b. c.
  (n: number) => `(${n})`,                          // (1) (2) (3)
  (n: number) => `(${String.fromCharCode(96 + n)})`, // (a) (b) (c)
] as const;

/**
 * Get the label for a paragraph at a given level and count
 * Cycles through patterns for deep nesting
 */
export function getParagraphLabel(level: number, count: number): string {
  const patternIndex = level % LABEL_PATTERNS.length;
  return LABEL_PATTERNS[patternIndex](count);
}

/**
 * Paragraph structure for label calculation
 */
export interface ParagraphLike {
  level: number;
  text?: string;
}

/**
 * Calculate labels for a list of paragraphs
 * Handles counter resets when level decreases
 */
export function calculateLabels(paragraphs: ParagraphLike[]): string[] {
  const labels: string[] = [];
  const counters = new Array(PARAGRAPH.MAX_DEPTH + 1).fill(0);

  for (const para of paragraphs) {
    // Reset counters for deeper levels when we move back up
    for (let i = para.level + 1; i <= PARAGRAPH.MAX_DEPTH; i++) {
      counters[i] = 0;
    }

    // Increment current level counter
    counters[para.level]++;

    // Generate label
    labels.push(getParagraphLabel(para.level, counters[para.level]));
  }

  return labels;
}

/**
 * Count words in text, stripping LaTeX formatting
 */
export function countWords(text: string): number {
  if (!text || text.trim() === '') return 0;

  // Strip LaTeX formatting commands
  const cleanText = stripLatexFormatting(text);

  // Split on whitespace and filter empty strings
  const words = cleanText.split(/\s+/).filter((word) => word.length > 0);

  return words.length;
}

/**
 * Count total words across all paragraphs
 */
export function countTotalWords(paragraphs: ParagraphLike[]): number {
  return paragraphs.reduce((sum, para) => sum + countWords(para.text || ''), 0);
}

/**
 * Get indent string for a paragraph level (for plain text output).
 *
 * Clamps the resulting count to ≥ 0 so a negative `level` or
 * `spacesPerLevel` doesn't trip `String.prototype.repeat`'s
 * RangeError (it throws on negative counts). Surfaced by the fuzz
 * suite — in production, `level` is always 0..MAX_DEPTH, but
 * defensive clamping costs nothing and prevents a crash if a
 * corrupted-state path ever produces a negative.
 */
export function getIndentString(level: number, spacesPerLevel: number = 4): string {
  return ' '.repeat(Math.max(0, level * spacesPerLevel));
}

/**
 * Format paragraph as plain text with label and indentation
 */
export function formatParagraphAsText(
  text: string,
  level: number,
  label: string,
  spacesPerLevel: number = 4
): string {
  const indent = getIndentString(level, spacesPerLevel);
  return `${indent}${label}  ${text}`;
}

/**
 * Convert paragraphs to plain text body
 */
export function paragraphsToPlainText(
  paragraphs: ParagraphLike[],
  spacesPerLevel: number = 4
): string {
  const labels = calculateLabels(paragraphs);

  return paragraphs
    .map((para, i) => formatParagraphAsText(para.text || '', para.level, labels[i], spacesPerLevel))
    .join('\n\n');
}

/**
 * Get the maximum depth reached in a set of paragraphs
 */
export function getMaxDepth(paragraphs: ParagraphLike[]): number {
  if (paragraphs.length === 0) return 0;
  return Math.max(...paragraphs.map((p) => p.level));
}

/**
 * Validate paragraph level is within allowed range
 */
export function isValidLevel(level: number): boolean {
  return level >= 0 && level <= PARAGRAPH.MAX_DEPTH;
}

/**
 * Adjust level to be within valid range
 */
export function clampLevel(level: number): number {
  return Math.max(0, Math.min(level, PARAGRAPH.MAX_DEPTH));
}

/**
 * Check if a paragraph can be indented (increased level)
 */
export function canIndent(level: number): boolean {
  return level < PARAGRAPH.MAX_DEPTH;
}

/**
 * Check if a paragraph can be outdented (decreased level)
 */
export function canOutdent(level: number): boolean {
  return level > 0;
}

/**
 * Clamp a paragraph list back into the SECNAV nesting invariant: the first
 * paragraph is always top-level, and no paragraph may sit more than one level
 * deeper than the one directly above it. Run after every structural edit so the
 * editor can't emit an illegal-but-still-compiling outline — e.g. a Tab that
 * jumps two levels, or an outdent that strands its sub-paragraphs too deep.
 * Returns the same array reference contents but with offending levels lowered
 * (unchanged paragraph objects are preserved by identity).
 */
export function normalizeLevels<T extends { level: number }>(paragraphs: T[]): T[] {
  let prev = -1; // forces paragraphs[0] down to level 0
  return paragraphs.map((p) => {
    const level = Math.max(0, Math.min(clampLevel(p.level), prev + 1));
    prev = level;
    return level === p.level ? p : { ...p, level };
  });
}

/**
 * Normalize legacy portion markings on load. FOUO was retired into the CUI
 * program (DoDI 5200.48, 2020), and the block editor's mark palette only carries
 * U/CUI/C/S/TS — so a paragraph persisted with FOUO by an older build would
 * otherwise be mislabeled as (U) in the gutter and silently downgraded to U on
 * the first cycle-click, corrupting the marking (and, via overallClassification,
 * the document-wide banner). Rewriting FOUO -> CUI at every load boundary keeps
 * old drafts correct. Returns the same array reference when nothing changes, so
 * it never dirties an untouched document.
 */
export function migratePortionMarkings<T extends { portionMarking?: string }>(paragraphs: T[]): T[] {
  let changed = false;
  const next = paragraphs.map((p): T => {
    if (p.portionMarking === 'FOUO') {
      changed = true;
      return { ...p, portionMarking: 'CUI' } as T;
    }
    return p;
  });
  return changed ? next : paragraphs;
}

/**
 * Split pasted prose (from Word / Outlook / email) into paragraph segments so a
 * dropped draft becomes real blocks instead of one blob. Splits on blank lines
 * when present, otherwise on single newlines, and strips a leading auto-
 * enumerator (1. / a. / (1) / •) from each segment so it doesn't double up with
 * the editor's own SECNAV numbering.
 */
export function splitPastedParagraphs(raw: string): string[] {
  const normalized = raw.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const hasBlankLines = /\n[ \t]*\n/.test(normalized);
  const segments = normalized.split(hasBlankLines ? /\n[ \t]*\n+/ : /\n+/);
  return segments
    .map((s) => s.trim().replace(/^(?:\(?\d+[.)]|\(?[a-zA-Z][.)]|[•·▪◦*-])\s+/, '').trim())
    .filter((s) => s.length > 0);
}

/**
 * True when the paragraph at `index` may be indented one level deeper right now:
 * it isn't the first paragraph and isn't already one deeper than its predecessor
 * (and is under the max depth). Mirrors what normalizeLevels would allow, so the
 * UI can disable the control instead of offering a no-op.
 */
export function canIndentAt(paragraphs: { level: number }[], index: number): boolean {
  if (index <= 0) return false;
  const level = paragraphs[index].level;
  return level < PARAGRAPH.MAX_DEPTH && level <= paragraphs[index - 1].level;
}
