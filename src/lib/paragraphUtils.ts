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
 * Get indent string for a paragraph level (for plain text output)
 */
export function getIndentString(level: number, spacesPerLevel: number = 4): string {
  return ' '.repeat(level * spacesPerLevel);
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
