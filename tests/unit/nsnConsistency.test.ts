import { describe, it, expect } from 'vitest';
import { validateNsnConsistency } from '@/lib/nsnConsistency';

describe('NSN consistency', () => {
  it('accepts one form used throughout', () => {
    expect(validateNsnConsistency(['5895-01-520-4360', '5975-00-984-6582'])).toEqual([]);
    expect(validateNsnConsistency(['5895015204360', '5975009846582'])).toEqual([]);
  });

  it('flags dashes and plain digits mixed in one publication', () => {
    const [f] = validateNsnConsistency(['5895-01-520-4360', '5975009846582']);
    expect(f.message).toMatch(/one form/i);
  });

  it('ignores blanks and unrecognised entries', () => {
    expect(validateNsnConsistency(['', '  ', 'CAGE 1VPW8'])).toEqual([]);
  });
});
