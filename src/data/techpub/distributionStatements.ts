/**
 * Distribution statements as they print on a technical publication cover,
 * worded as the MARCORSYSCOM template gives them (DoDI 5230.24). The editor
 * stores the letter; B through E take a reason and a date of determination
 * and name the controlling office, F names the office and the date, A takes
 * nothing.
 */

/** The reasons DoDI 5230.24 allows for restricting distribution. */
export const DISTRIBUTION_REASONS = [
  'Administrative or Operational Use',
  'Contractor Performance Evaluation',
  'Critical Technology',
  'Direct Military Support',
  'Export Controlled',
  'Foreign Government Information',
  'Operations Security',
  'Premature Dissemination',
  'Proprietary Information',
  'Software Documentation',
  'Specific Authority',
  'Test and Evaluation',
  'Vulnerability Information',
] as const;

export interface DistributionFillIns {
  reason?: string;
  /** Date of determination, already formatted for print. */
  date?: string;
  /** The controlling DoD office. */
  office?: string;
}

const AUTHORIZED: Record<string, string> = {
  B: 'Distribution authorized to U.S. Government agencies only',
  C: 'Distribution authorized to U.S. Government agencies and their contractors',
  D: 'Distribution authorized to the Department of Defense and U.S. DoD contractors only',
  E: 'Distribution authorized to DoD Components only',
};

const paren = (v: string | undefined) => (v?.trim() ? ` (${v.trim()})` : '');

/** The full statement for a letter, or '' when no statement is chosen. A part
 *  not yet given is left out rather than printed as a placeholder; the editor
 *  says what is missing. */
export function composeDistributionStatement(letter: string, fill: DistributionFillIns = {}): string {
  const key = letter.trim().charAt(0).toUpperCase();
  const office = fill.office?.trim();
  if (key === 'A') return 'DISTRIBUTION STATEMENT A: Approved for public release. Distribution is unlimited.';
  if (key === 'F') {
    const by = office ? ` by ${office}` : '';
    return `DISTRIBUTION STATEMENT F: Further dissemination only as directed${by}${paren(fill.date)} or higher DoD authority.`;
  }
  const authorized = AUTHORIZED[key];
  if (!authorized) return '';
  const referral = office ? ` Other requests${key === 'B' || key === 'C' ? ' for this document' : ''} must be referred to ${office}.` : '';
  return `DISTRIBUTION STATEMENT ${key}: ${authorized}${paren(fill.reason)}${paren(fill.date)}.${referral}`;
}
