import { describe, expect, it } from 'vitest';
import { toTitleCase } from '@/lib/titleCase';
import { generateDocumentTex } from '@/services/latex/generator';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { buildBaseline } from '../_helpers/compileMatrix';

describe('author-preserving subject case', () => {
  it.each([
    ['FY 2027 DON CIO AND USMC AI/IT READINESS', 'FY 2027 DON CIO AND USMC AI/IT READINESS'],
    ['coordination of eCASS and USMC AI/IT', 'Coordination of eCASS and USMC AI/IT'],
    ['MedEvac and HqDON guidance', 'MedEvac and HqDON Guidance'],
    ['  review\tfor  eCASS\nreadiness', '  Review\tfor  eCASS\nReadiness'],
  ])('preserves identifiers and spacing in %s', (input, expected) => {
    expect(toTitleCase(input)).toBe(expected);
    expect(toTitleCase(expected)).toBe(expected);
  });

  it.each(['standard_memorandum', 'action_memorandum', 'information_memorandum', 'executive_correspondence'] as const)('%s preserves capitals in both export paths without changing the draft', type => {
    const store = buildBaseline(type);
    store.formData.subject = 'FY 2027 DON CIO AND USMC AI/IT READINESS';
    const before = structuredClone(store);
    for (const tex of [generateDocumentTex(store), generateFlatLatex(store)]) {
      for (const token of ['FY', 'DON', 'CIO', 'USMC', 'AI/IT', 'READINESS']) expect(tex).toContain(token);
      expect(tex).not.toContain('Ai/it');
    }
    expect(store).toEqual(before);
  });
});
