import type { Paragraph, PortionMarking } from '@/types/document';

/**
 * Consistency checks between a document's overall classification (the banner)
 * and its per-paragraph portion markings. The governing rule is "highest
 * classification wins": the banner must reflect the highest portion marking in
 * the document (DoDM 5200.01 for classified, DoDI 5200.48 / 32 CFR 2002 for
 * CUI). DonDocs renders both markings; this validates that they agree, so a
 * paragraph marked SECRET under an UNCLASSIFIED banner (an under-marking, the
 * serious case) can't leave the editor unnoticed.
 *
 * Advisory, never blocking — the editor surfaces the findings; the drafter
 * decides. Pure and leaf so the rules are exhaustively unit-testable.
 */

export interface ClassificationFinding {
  severity: 'error' | 'warning';
  message: string;
}

// Overall banner level → rank. 'custom' is the unaccredited, unclassified-only
// path, so it ranks with unclassified; an unknown value is treated the same.
const BANNER_RANK: Record<string, number> = {
  unclassified: 0,
  custom: 0,
  cui: 1,
  confidential: 2,
  secret: 3,
  top_secret: 4,
  top_secret_sci: 5,
};

// Portion marking → rank. FOUO is legacy CUI, so it ranks with CUI. There is no
// portion abbreviation for the SCI control system, so TS is the ceiling here.
const PORTION_RANK: Record<PortionMarking, number> = {
  U: 0,
  CUI: 1,
  FOUO: 1,
  C: 2,
  S: 3,
  TS: 4,
};

const RANK_LABEL = ['UNCLASSIFIED', 'CUI', 'CONFIDENTIAL', 'SECRET', 'TOP SECRET', 'TOP SECRET//SCI'];

function bannerRank(classLevel: string): number {
  return BANNER_RANK[classLevel] ?? 0;
}

function bannerLabel(classLevel: string): string {
  return classLevel === 'custom' ? 'the custom marking' : RANK_LABEL[bannerRank(classLevel)];
}

/** The highest portion marking present among body paragraphs, or null. */
function highestPortion(marked: PortionMarking[]): { marking: PortionMarking; rank: number } | null {
  let best: { marking: PortionMarking; rank: number } | null = null;
  for (const m of marked) {
    const rank = PORTION_RANK[m];
    if (!best || rank > best.rank) best = { marking: m, rank };
  }
  return best;
}

export function validateClassificationMarkings(
  classLevel: string,
  paragraphs: Paragraph[]
): ClassificationFinding[] {
  const findings: ClassificationFinding[] = [];

  // Only body paragraphs with real text carry portion markings; blank rows and
  // headings don't count toward "every paragraph is marked".
  const body = paragraphs.filter((p) => (p.text ?? '').trim() !== '');
  if (body.length === 0) return findings;

  const marked = body.map((p) => p.portionMarking).filter((m): m is PortionMarking => !!m);
  const highest = highestPortion(marked);
  const banner = bannerRank(classLevel);

  // 1. Under-marking (the serious one): a portion outranks the banner. The
  //    overall marking must be at least the highest portion.
  if (highest && highest.rank > banner) {
    findings.push({
      severity: 'error',
      message: `A paragraph is marked (${highest.marking}) — ${RANK_LABEL[highest.rank]} — but the document banner is ${bannerLabel(classLevel)}. The overall marking must be at least the highest portion.`,
    });
  }

  // Classified documents require portion markings; they are optional for CUI.
  if (banner >= 2 && marked.length === 0) {
    findings.push({
      severity: 'warning',
      message: `This document is marked ${bannerLabel(classLevel)} but no paragraphs carry a portion marking. Mark each paragraph with its classification.`,
    });
  }

  // 3. Partial marking: some body paragraphs marked, some not. Every paragraph
  //    must be marked, or none (an unclassified working draft).
  if (banner >= 1 && marked.length > 0 && marked.length < body.length) {
    findings.push({
      severity: 'warning',
      message: `${marked.length} of ${body.length} paragraphs are portion-marked. Mark every paragraph, not just some.`,
    });
  }

  // 4. Over-marking: the banner outranks the highest portion. Usually the
  //    overall marking equals the highest portion, so flag it (a warning, since
  //    a higher banner can be legitimate — e.g. a classified reference in the
  //    header the body doesn't repeat).
  if (highest && banner > highest.rank && classLevel !== 'custom') {
    findings.push({
      severity: 'warning',
      message: `The document banner is ${bannerLabel(classLevel)} but the highest paragraph marking is (${highest.marking}) — ${RANK_LABEL[highest.rank]}. The overall marking normally equals the highest portion.`,
    });
  }

  // 5. Mixed CUI and legacy FOUO in the same document — pick one scheme.
  if (marked.includes('CUI') && marked.includes('FOUO')) {
    findings.push({
      severity: 'warning',
      message: 'This document mixes CUI and the legacy FOUO marking. Use one scheme — CUI supersedes FOUO.',
    });
  }

  return findings;
}


import { DISTRIBUTION_STATEMENTS_BY_REASON } from '@/data/techpub/distributionStatements';

export function distributionAccess(statement: string): 'Public release' | 'Restricted distribution' | null {
  const letter = statement.trim().toUpperCase();
  if (letter === 'A') return 'Public release';
  return ['B', 'C', 'D', 'E', 'F'].includes(letter) ? 'Restricted distribution' : null;
}

/** DoDI 5230.24: distribution restrictions do not establish a CUI designation. */
export function validateDistributionStatement(classLevel: string, statement: string | undefined): ClassificationFinding[] {
  return distributionAccess(statement ?? '') === 'Public release' && bannerRank(classLevel) > 0
    ? [{ severity: 'warning', message: `Distribution Statement A requires public release approval and conflicts with the ${bannerLabel(classLevel)} marking. Resolve the release determination.` }]
    : [];
}

/**
 * Statements B through F are not complete as a letter: the template's own
 * wording carries "(category) (date of determination)" and names the
 * controlling DoD office, and says the author fills them in. Names what is
 * still missing. Advisory.
 */
export function validateDistributionFillIns(
  distributionStatement: string | undefined,
  fill: { reason?: string; date?: string; office?: string }
): ClassificationFinding[] {
  const letter = (distributionStatement ?? '').trim().charAt(0).toUpperCase();
  if (!['B', 'C', 'D', 'E', 'F'].includes(letter)) return [];
  const missing: string[] = [];
  if (letter !== 'F' && !fill.reason?.trim()) missing.push('a reason');
  if (!fill.date?.trim()) missing.push('a date of determination');
  if (!fill.office?.trim()) missing.push('the controlling office (on the Cover)');
  if (missing.length === 0) return [];
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
  return [{ severity: 'warning', message: `Distribution Statement ${letter} still needs ${list}.` }];
}

/** DoDI 5230.24 pairs each reason with the statements it may go with. */
export function validateReasonForStatement(distributionStatement: string | undefined, reason: string | undefined): ClassificationFinding[] {
  const letter = (distributionStatement ?? '').trim().charAt(0).toUpperCase();
  const chosen = reason?.trim();
  if (!chosen || !['B', 'C', 'D', 'E'].includes(letter)) return [];
  const allowed = DISTRIBUTION_STATEMENTS_BY_REASON[chosen];
  if (!allowed) return [{ severity: 'warning', message: `"${chosen}" is not a reason DoDI 5230.24 lists; choose one of its reasons.` }];
  return allowed.includes(letter)
    ? []
    : [{ severity: 'warning', message: `${chosen} goes with Statement ${allowed.join(' or ')}, not ${letter}.` }];
}
