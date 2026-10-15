import type { Paragraph } from '@/types/document';

export interface ProcedureFinding {
  severity: 'error' | 'warning';
  message: string;
}
export const MAX_STEP_DEPTH = 4;

/** Count subdivisions within each procedure, retaining the non-step parent boundaries. */
export function validateProcedureSteps(paragraphs: Paragraph[]): ProcedureFinding[] {
  const findings: ProcedureFinding[] = [];
  let root: number | undefined;
  const counts = new Map<number, number>();
  let lone = false;
  let deep = false;
  const close = (level: number) => {
    for (const [depth, count] of counts) {
      if (depth >= level) {
        if (depth > 0 && count === 1) lone = true;
        counts.delete(depth);
      }
    }
  };
  for (const p of paragraphs) {
    if (p.callout || p.figure) continue;
    if (!p.procedure) {
      close(p.appendix ? 0 : p.level);
      root = undefined;
      continue;
    }
    root = root === undefined ? p.level : Math.min(root, p.level);
    if (p.level - root + 1 > MAX_STEP_DEPTH) deep = true;
    close(p.level + 1);
    counts.set(p.level, (counts.get(p.level) ?? 0) + 1);
  }
  close(0);
  if (deep) findings.push({ severity: 'error', message: `Procedural steps go no deeper than ${MAX_STEP_DEPTH} levels within a procedure.` });
  if (lone) findings.push({ severity: 'warning', message: 'A substep needs a sibling: a step a. requires a step b., a substep (1) requires a (2).' });
  return findings;
}
