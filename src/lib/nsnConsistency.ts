/**
 * "NSN formatting should be consistent throughout the document. The use of
 * dashes is dependent on Program Office requirements."
 *
 * So either form is fine -- 5895-01-520-4360 or 5895015204360 -- but not both
 * in one publication. Pure and leaf. Advisory.
 */

export interface NsnFinding {
  severity: 'warning';
  message: string;
}

const DASHED = /^\d{4}-\d{2}-\d{3}-\d{4}$/;
const PLAIN = /^\d{13}$/;

export function validateNsnConsistency(nsns: string[]): NsnFinding[] {
  const filled = nsns.map((n) => n.trim()).filter(Boolean);
  const dashed = filled.filter((n) => DASHED.test(n)).length;
  const plain = filled.filter((n) => PLAIN.test(n)).length;
  if (dashed > 0 && plain > 0) {
    return [{
      severity: 'warning',
      message: `NSNs are written both with dashes (${dashed}) and without (${plain}). Use one form throughout the publication.`,
    }];
  }
  return [];
}
