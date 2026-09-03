import type { Paragraph, PublicationTableRow } from '@/types/document';
import { findUndefinedAcronyms } from '@/lib/acronyms';

/**
 * Rules MIL-DTL-28999D, the specification for I-Type publications, states
 * about the text itself. Each is advisory, and each says which paragraph or
 * row it means.
 */

export interface RuleFinding {
  severity: 'warning';
  message: string;
}

const warn = (message: string): RuleFinding => ({ severity: 'warning', message });

/** 3.1.1.1a: "Acronyms shall not be used in headings." */
export function validateHeadingAcronyms(paragraphs: Paragraph[]): RuleFinding[] {
  const hits = paragraphs
    .map((p) => p.header?.trim() ?? '')
    .filter((h) => h && h !== h.toUpperCase())
    .flatMap((h) => findUndefinedAcronyms(h, { strict: true }).map((a) => `${a.acronym} in "${h}"`));
  return hits.length ? [warn(`Paragraph headings use no acronyms: ${hits.join('; ')}.`)] : [];
}

/** 3.1.4.3: warnings before cautions, cautions before notes, when they run together. */
const RANK = { warning: 0, caution: 1, note: 2 } as const;
export function validateCalloutOrder(paragraphs: Paragraph[]): RuleFinding[] {
  for (let i = 1; i < paragraphs.length; i++) {
    const a = paragraphs[i - 1].callout;
    const b = paragraphs[i].callout;
    if (a && b && RANK[a] > RANK[b]) {
      return [warn(`A ${b.toUpperCase()} follows a ${a.toUpperCase()} it should precede: when callouts run together, warnings come first, then cautions, then notes.`)];
    }
  }
  return [];
}

/** 3.3.2.4: "MIs are the only I-Type that shall be marked as URGENT ... TIs, LIs, and SIs shall not be published as time-restrictive." */
export function validateUrgencyByType(publicationType: string | undefined, urgency: string | undefined): RuleFinding[] {
  const type = publicationType ?? 'MI';
  return type !== 'MI' && urgency === 'urgent'
    ? [warn(`A ${type} is not published as time-restrictive; only a Modification Instruction is marked URGENT.`)]
    : [];
}

/** 3.3.2.14b: in a TI "the use of the word 'modification' shall be avoided." */
export function validateTiWording(publicationType: string | undefined, paragraphs: Paragraph[]): RuleFinding[] {
  if (publicationType !== 'TI') return [];
  const n = paragraphs.filter((p) => /\bmodif/i.test(p.text)).length;
  return n ? [warn(`A Technical Instruction avoids the word "modification"; ${n} paragraph${n === 1 ? '' : 's'} use${n === 1 ? 's' : ''} it.`)] : [];
}

/** 3.3.2.7: nomenclature "all caps up to the first comma then first letter capitalization for each word". */
export function validateNomenclatureCase(rows: PublicationTableRow[], table: string): RuleFinding[] {
  const bad = rows
    .map((r) => (r.values.description ?? '').trim())
    .filter((d) => d && d !== 'Consisting of:')
    .filter((d) => {
      const [head, ...rest] = d.split(',');
      if (head !== head.toUpperCase()) return true;
      return rest.some((part) => part.trim().split(/\s+/).some((w) => /^[a-z]/.test(w)));
    });
  return bad.length
    ? [warn(`${table}: nomenclature is all capitals up to the first comma, then each word capitalized, as TRAILER ASSEMBLY, Generator: ${bad.join('; ')}.`)]
    : [];
}

/** 3.3.2.9.4: "numbers shall be consecutive" — 1, 2, 3, kit items included. */
export function validateItemNumbers(rows: PublicationTableRow[], table: string): RuleFinding[] {
  const items = rows.map((r) => (r.values.item ?? '').trim()).filter(Boolean);
  if (items.length === 0) return [];
  const expected = items.map((_, i) => String(i + 1));
  return items.join(',') === expected.join(',')
    ? []
    : [warn(`${table}: item numbers run 1, 2, 3 in order, kit items included; they read ${items.join(', ')}.`)];
}

/** 3.1.3: "The reading grade level shall be at the ninth grade level." A
 *  Flesch-Kincaid estimate over the body; nomenclature inflates it, so only a
 *  clear excess is reported, with the estimate. */
export const GRADE_CEILING = 12;

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  const groups = w.replace(/e$/, '').match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

export function readingGrade(paragraphs: Paragraph[]): number | null {
  const text = paragraphs.filter((p) => !p.figure).map((p) => p.text).join(' ');
  const words = text.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  const sentences = Math.max(1, (text.match(/[.!?](\s|$)/g) ?? []).length);
  if (words.length < 40) return null;
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  return 0.39 * (words.length / sentences) + 11.8 * (syl / words.length) - 15.59;
}

export function validateReadingGrade(paragraphs: Paragraph[]): RuleFinding[] {
  const grade = readingGrade(paragraphs);
  return grade !== null && grade > GRADE_CEILING
    ? [warn(`The body reads at about grade ${Math.round(grade)}; the specification asks for the ninth grade. Shorter sentences and plainer words bring it down.`)]
    : [];
}
