import { findUndefinedAcronyms } from '@/lib/acronyms';

/**
 * Rules the MARCORSYSCOM template puts on a technical publication's titles.
 *
 *   Nomenclature: "Max of two lines of text is permitted."
 *   Long Title:   "Only four lines of text are permitted. Long Title is in all
 *                  caps and centered. Acronyms shall not be used."
 *
 * Line counts are estimated from character length against the width each
 * title sets at -- the nomenclature large and bold across the cover, the long
 * title in the header -- which is the safe direction to be wrong in, since a
 * title that just fits is flagged before one that overruns.
 *
 * Pure and leaf, like the other publication checks. Advisory.
 */

export interface TitleFinding {
  severity: 'error' | 'warning';
  message: string;
}

/** Characters that comfortably fill one line at each title's size. */
const NOMENCLATURE_LINE = 40;
const LONG_TITLE_LINE = 70;

export function validateNomenclature(text: string): TitleFinding[] {
  const lines = Math.ceil(text.trim().length / NOMENCLATURE_LINE);
  return lines > 2
    ? [{ severity: 'warning', message: 'The nomenclature runs past two lines. Shorten it, or move detail into the end item table.' }]
    : [];
}

export function validateLongTitle(text: string): TitleFinding[] {
  const findings: TitleFinding[] = [];
  const trimmed = text.trim();
  if (!trimmed) return findings;

  if (Math.ceil(trimmed.length / LONG_TITLE_LINE) > 4) {
    findings.push({ severity: 'warning', message: 'The long title runs past four lines.' });
  }
  // Acronyms are told apart by their capitals, and the title prints in all
  // caps -- so this checks what the author typed, not what prints. A title
  // typed entirely in capitals hides its acronyms and is left to the reader.
  // Every acronym counts: the rule is "shall not be used", so even one the
  // correspondence allowlist would let through is out of place here.
  if (trimmed !== trimmed.toUpperCase()) {
    const acronyms = findUndefinedAcronyms(trimmed, { strict: true });
    if (acronyms.length > 0) {
      const shown = acronyms.map((a) => a.acronym).join(', ');
      findings.push({ severity: 'error', message: `The long title uses no acronyms. Spell out ${shown}.` });
    }
  }
  return findings;
}
