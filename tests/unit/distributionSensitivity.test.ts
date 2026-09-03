import { describe, it, expect } from 'vitest';
import { sensitivityFor, validateDistributionStatement } from '@/lib/classificationValidation';

describe('distribution statement → sensitivity', () => {
  it('maps A to uncontrolled and B–F to controlled', () => {
    expect(sensitivityFor('A')).toBe('Uncontrolled / General');
    for (const l of ['B', 'C', 'D', 'E', 'F']) {
      expect(sensitivityFor(l), l).toBe('Controlled / CUI');
    }
  });

  it('has no opinion until a statement is chosen', () => {
    expect(sensitivityFor('')).toBeNull();
    expect(sensitivityFor('Z')).toBeNull();
  });

  it('catches a restricted distribution left unmarked', () => {
    const [f] = validateDistributionStatement('unclassified', 'D');
    expect(f.severity).toBe('error');
    expect(f.message).toMatch(/controlled/i);
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
