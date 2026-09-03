/**
 * Distribution statements as DoDI 5230.24 (January 2023) words them. The
 * editor stores the letter; B through E take a reason and a date of
 * determination and name the controlling office, F names the office and the
 * date, A takes nothing.
 */

/** The reasons the instruction allows, and the statements each may go with:
 *  Direct Military Support only with E; a handful only with B or E. */
export const DISTRIBUTION_STATEMENTS_BY_REASON: Record<string, readonly string[]> = {
  'Controlled Technical Information': ['B', 'C', 'D', 'E'],
  'Contractor Performance Evaluation': ['B', 'E'],
  'Critical Technology': ['B', 'C', 'D', 'E'],
  'Direct Military Support': ['E'],
  'Export Controlled': ['B', 'C', 'D', 'E'],
  'Foreign Government Information': ['B', 'C', 'D', 'E'],
  'International Agreements': ['B', 'C', 'D', 'E'],
  'Operations Security': ['B', 'E'],
  'Patents and Inventions': ['B', 'E'],
  'Proprietary Business Information': ['B', 'E'],
  'Small Business Innovation Research': ['B', 'E'],
  'Software Documentation': ['B', 'C', 'D', 'E'],
  'Test and Evaluation': ['B', 'E'],
  'Vulnerability Information': ['B', 'C', 'D', 'E'],
};

export const DISTRIBUTION_REASONS = Object.keys(DISTRIBUTION_STATEMENTS_BY_REASON);

/** The reasons a statement may carry. */
export const reasonsFor = (letter: string): string[] =>
  DISTRIBUTION_REASONS.filter((r) => DISTRIBUTION_STATEMENTS_BY_REASON[r].includes(letter.trim().charAt(0).toUpperCase()));

export interface DistributionFillIns {
  reason?: string;
  /** Date of determination, already formatted for print. */
  date?: string;
  /** The controlling DoD office. */
  office?: string;
}

const AUTHORIZED: Record<string, string> = {
  B: 'Distribution authorized to U.S. Government agencies',
  C: 'Distribution authorized to U.S. Government agencies and their contractors',
  D: 'Distribution authorized to Department of Defense and U.S. DoD contractors only',
  E: 'Distribution authorized to DoD Components only',
};

const paren = (v: string | undefined) => (v?.trim() ? ` (${v.trim()})` : '');

/** The full statement for a letter, or '' when no statement is chosen. A part
 *  not yet given is left out rather than printed as a placeholder; the editor
 *  says what is missing. */
export function composeDistributionStatement(letter: string, fill: DistributionFillIns = {}): string {
  const key = letter.trim().charAt(0).toUpperCase();
  const office = fill.office?.trim();
  if (key === 'A') return 'DISTRIBUTION STATEMENT A: Approved for public release: distribution is unlimited.';
  if (key === 'F') {
    const by = office ? ` by ${office}` : '';
    return `DISTRIBUTION STATEMENT F: Further distribution only as directed${by}${paren(fill.date)} or higher DoD authority.`;
  }
  const authorized = AUTHORIZED[key];
  if (!authorized) return '';
  const referral = office ? ` Other requests for this document must be referred to ${office}.` : '';
  return `DISTRIBUTION STATEMENT ${key}: ${authorized}${paren(fill.reason)}${paren(fill.date)}.${referral}`;
}
