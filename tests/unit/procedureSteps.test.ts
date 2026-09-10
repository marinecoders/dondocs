import { describe, it, expect } from 'vitest';
import { validateProcedureSteps, MAX_STEP_DEPTH } from '@/lib/procedureSteps';
import type { Paragraph } from '@/types/document';

const step = (level: number, extra: Partial<Paragraph> = {}): Paragraph =>
  ({ text: 'Do the thing.', level, procedure: true, ...extra });

describe('procedural steps', () => {
  it('says nothing about a document with no steps', () => {
    expect(validateProcedureSteps([{ text: 'A paragraph.', level: 0 }])).toEqual([]);
  });

  it('accepts paired substeps within the depth limit', () => {
    expect(validateProcedureSteps([step(0), step(1), step(1), step(0)])).toEqual([]);
  });

  it('catches a substep with no sibling', () => {
    const [f] = validateProcedureSteps([step(0), step(1), step(0)]);
    expect(f.message).toMatch(/needs a sibling/i);
  });

  it(`refuses to go deeper than ${MAX_STEP_DEPTH} levels`, () => {
    const deep = validateProcedureSteps([step(0), step(1), step(1), step(2), step(2), step(3), step(3), step(4), step(4)]);
    expect(deep.some((f) => /no deeper/i.test(f.message))).toBe(true);
  });

  it('objects to a titled step', () => {
    const f = validateProcedureSteps([step(0, { header: 'Removal' }), step(0)]);
    expect(f.some((x) => /carry no titles/i.test(x.message))).toBe(true);
  });
});
