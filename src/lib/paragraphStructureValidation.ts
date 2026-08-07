import type { Paragraph } from '@/types/document';
import { outlineParagraphs } from '@/services/latex/paragraphLabel';

/**
 * Paragraph-structure checks for a correspondence body, from the two rules
 * SECNAV M-5216.5 Ch 7 states about how paragraphs relate to their siblings:
 *
 *   ¶13  "If there is a paragraph 1a, there must be a paragraph 1b; if there
 *         is a paragraph 1a(1), there must be a paragraph 1a(2), etc."
 *   ¶13d "Be consistent across main paragraphs and subparagraphs. If paragraph
 *         1 has a heading, then paragraph 2 would need a heading; if paragraph
 *         1a has a heading, then paragraph 1b would need a heading."
 *
 * Both are author errors the app can't repair — it can't write the missing
 * paragraph 1b, and it can't guess the heading that belongs on it. So this
 * reports and the drafter decides, the same bargain `classificationValidation`
 * and the acronym check strike. Advisory, never blocking.
 *
 * Because it reads the paragraph model rather than either generator's output,
 * it covers the PDF and the DOCX by construction: both are built from this same
 * array, upstream of where the two pipelines diverge.
 *
 * Pure and leaf, so every rule is exhaustively unit-testable.
 */

export interface ParagraphStructureFinding {
  severity: 'error' | 'warning';
  message: string;
}

/** A paragraph nobody has written into yet — no text, no heading. */
function isBlank(p: Paragraph): boolean {
  return !(p.text ?? '').trim() && !(p.header ?? '').trim();
}

function hasHeading(p: Paragraph): boolean {
  return !!(p.header ?? '').trim();
}

/** Join citations for a message: "1a", "1a and 1b", "1a, 1b and 1c". */
function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function validateParagraphStructure(
  paragraphs: Paragraph[]
): ParagraphStructureFinding[] {
  const findings: ParagraphStructureFinding[] = [];
  if (paragraphs.length === 0) return findings;

  const outline = outlineParagraphs(paragraphs.map((p) => p.level));

  // Group by the paragraph each one subdivides. Siblings are same parent AND
  // same level, which is what both of the manual's examples compare: 1 against
  // 2, and 1a against 1b.
  const groups = new Map<string, number[]>();
  outline.forEach((entry, index) => {
    const key = `${entry.parentIndex}:${entry.level}`;
    const group = groups.get(key);
    if (group) group.push(index);
    else groups.set(key, [index]);
  });

  for (const indices of groups.values()) {
    const level = outline[indices[0]].level;

    // ¶13 — a subdivision of one. Level 0 is exempt: a letter whose body is a
    // single paragraph is a complete letter, not an unfinished subdivision.
    // Counted over every row, blank ones included — a row the drafter has added
    // but not yet typed into is still the paragraph 1b the rule asks for, and
    // warning about it mid-keystroke would be noise.
    if (level >= 1 && indices.length === 1) {
      const parentIndex = outline[indices[0]].parentIndex;
      const only = outline[indices[0]].citation;
      const parent = parentIndex === null ? null : outline[parentIndex].citation;
      findings.push({
        severity: 'warning',
        message: parent
          ? `Paragraph ${only} is the only subparagraph of ${parent}. Ch 7 ¶13 requires a `
            + `second one — add another, or fold ${only} back into ${parent}.`
          : `Paragraph ${only} is the only subparagraph at its level. Ch 7 ¶13 requires a `
            + 'second one — add another, or fold it into the paragraph above.',
      });
    }

    // ¶13d — headings applied to some siblings but not all. Blank rows are
    // skipped here: an empty row isn't a paragraph that "needs a heading" yet,
    // and a trailing one would otherwise flag every headed document.
    const written = indices.filter((i) => !isBlank(paragraphs[i]));
    const headed = written.filter((i) => hasHeading(paragraphs[i]));
    const bare = written.filter((i) => !hasHeading(paragraphs[i]));
    if (headed.length > 0 && bare.length > 0) {
      findings.push({
        severity: 'warning',
        message:
          `${headed.length === 1 ? 'Paragraph' : 'Paragraphs'} `
          + `${list(headed.map((i) => outline[i].citation))} `
          + `${headed.length === 1 ? 'has a heading but paragraph' : 'have headings but paragraph'}`
          + `${bare.length === 1 ? '' : 's'} ${list(bare.map((i) => outline[i].citation))} `
          + `${bare.length === 1 ? 'does not' : 'do not'}. `
          + 'Ch 7 ¶13d asks for headings to be consistent across siblings.',
      });
    }
  }

  return findings;
}
