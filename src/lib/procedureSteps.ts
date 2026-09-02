import type { Paragraph } from '@/types/document';

/**
 * Rules MIL-STD-38784C 4.7.11.5.3 states about procedural steps:
 *
 *   "Steps may be further divided into substeps, but shall not exceed four
 *    levels of depth. There shall be at least two of each subdivision used as
 *    a minimum, i.e., if there is a step a., there must be a step b., if there
 *    is a substep (1), there must be a substep (2) ... Procedural steps shall
 *    not have titles."
 *
 * The lone-substep rule is the one worth catching: a single a. with no b. is
 * usually a step that was never finished, or one that should have been folded
 * into its parent.
 *
 * Note the depth limit is four, not the five the MIL-STD-40051 example in the
 * MARCORSYSCOM template shows — that example belongs to the other standard.
 *
 * Pure and leaf, like the classification and time-compliance checks. Advisory.
 */

export interface ProcedureFinding {
  severity: 'error' | 'warning';
  message: string;
}

/** Deepest subdivision the standard allows: the step and three substeps. */
export const MAX_STEP_DEPTH = 4;

export function validateProcedureSteps(paragraphs: Paragraph[]): ProcedureFinding[] {
  const findings: ProcedureFinding[] = [];
  const steps = paragraphs.filter((p) => p.procedure);
  if (steps.length === 0) return findings;

  if (steps.some((p) => p.level >= MAX_STEP_DEPTH)) {
    findings.push({
      severity: 'error',
      message: `Procedural steps go no deeper than ${MAX_STEP_DEPTH} levels. Flatten the deepest substeps, or split the procedure.`,
    });
  }

  if (steps.some((p) => (p.header ?? '').trim() !== '')) {
    findings.push({
      severity: 'warning',
      message: 'Procedural steps carry no titles. Move the heading into the step above it.',
    });
  }

  // A subdivision needs a sibling. Walk the steps in order and count how many
  // sit at each level within the run they belong to; a run ends when the level
  // rises back above it.
  const counts: number[] = [];
  const flagged = new Set<number>();
  for (const step of steps) {
    for (let deeper = step.level + 1; deeper < counts.length; deeper++) {
      if (counts[deeper] === 1) flagged.add(deeper);
      counts[deeper] = 0;
    }
    counts[step.level] = (counts[step.level] ?? 0) + 1;
  }
  for (let level = 1; level < counts.length; level++) {
    if (counts[level] === 1) flagged.add(level);
  }
  if (flagged.size > 0) {
    findings.push({
      severity: 'warning',
      message: 'A substep needs a sibling: a step a. requires a step b., a substep (1) requires a (2).',
    });
  }

  return findings;
}
