import { describe, it, expect } from 'vitest';
import { distributionAccess, validateDistributionStatement } from '@/lib/classificationValidation';

describe('distribution access', () => {
  it('distinguishes public release from restricted distribution', () => {
    expect(distributionAccess('A')).toBe('Public release');
    for (const l of ['B', 'C', 'D', 'E', 'F']) {
      expect(distributionAccess(l), l).toBe('Restricted distribution');
    }
  });

  it('has no opinion until a statement is chosen', () => {
    expect(distributionAccess('')).toBeNull();
    expect(distributionAccess('Z')).toBeNull();
  });

  it('permits unclassified restricted-distribution documents', () => {
    for (const letter of ['B', 'C', 'D', 'E', 'F']) expect(validateDistributionStatement('unclassified', letter)).toEqual([]);
  });

  it('catches a public-release statement on a marked document', () => {
    const [f] = validateDistributionStatement('cui', 'A');
    expect(f.severity).toBe('warning');
    expect(f.message).toMatch(/public release/i);
  });

  it('is quiet when the two agree', () => {
    expect(validateDistributionStatement('cui', 'C')).toEqual([]);
    expect(validateDistributionStatement('unclassified', 'A')).toEqual([]);
  });
});
