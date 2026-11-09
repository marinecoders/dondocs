/**
 * One abbreviation for every typed-name signer (endorsement acknowledgement,
 * AA form originator, profile fills). This function exists because two copies
 * had already diverged — the second one reintroduced the middle-initial slide
 * that the first had fixed.
 */
import { describe, it, expect } from 'vitest';
import { abbreviatedSignatoryName, abbreviatedFullSignatoryName } from '@/lib/signatoryName';

describe('abbreviatedSignatoryName', () => {
  it('abbreviates to initials and surname', () => {
    expect(abbreviatedSignatoryName('Robert', 'Lee', 'Smith')).toBe('R. L. SMITH');
  });

  it('handles a missing middle', () => {
    expect(abbreviatedSignatoryName('Robert', '', 'Smith')).toBe('R. SMITH');
  });

  it('never lets a middle initial slide into the first slot', () => {
    // A middle without a first must not print "L. SMITH" as if L were the
    // first initial — positional truth over prettiness.
    expect(abbreviatedSignatoryName('', 'Lee', 'Smith')).toBe('SMITH');
  });

  it('surname only', () => {
    expect(abbreviatedSignatoryName(undefined, undefined, 'Smith')).toBe('SMITH');
  });

  it('empty in, empty out', () => {
    expect(abbreviatedSignatoryName('', '', '')).toBe('');
  });

  it('trims and uppercases', () => {
    expect(abbreviatedSignatoryName('  robert ', ' lee ', '  smith ')).toBe('R. L. SMITH');
  });
});

describe('abbreviated agreement signatory names', () => {
  it.each([
    ['JORDAN M. RIVERA', 'J. M. RIVERA'],
    ['Alex Thomas Morgan', 'A. T. MORGAN'],
    ['J. M. RIVERA', 'J. M. RIVERA'],
    ['J.M. Rivera', 'J. M. RIVERA'],
    ['Jordan M.L. Rivera', 'J. M. L. RIVERA'],
    ['J.M.L. Rivera', 'J. M. L. RIVERA'],
    ['Jordan Rivera', 'J. RIVERA'],
    ['Jordan M. Rivera Jr.', 'J. M. RIVERA JR.'],
    ['Rivera Jr.', 'RIVERA JR.'],
    ['Jordan M. Rivera III', 'J. M. RIVERA III'],
    ['Jordan Marie de la Cruz', 'J. M. DE LA CRUZ'],
    ['J. M. de la Cruz', 'J. M. DE LA CRUZ'],
    ['Alex van der Meer', 'A. VAN DER MEER'],
    ['J.M Rivera', 'J. M. RIVERA'],
    ['J.M.L Rivera', 'J. M. L. RIVERA'],
    ['Jordan Marie Lee Rivera', 'J. M. L. RIVERA'],
    ['  Jordan\t M.  Rivera  ', 'J. M. RIVERA'],
    ['Rivera', 'RIVERA'],
    ['', ''],
    ['   ', ''],
    [undefined, ''],
  ])('formats %s as %s', (name, expected) => {
    expect(abbreviatedFullSignatoryName(name)).toBe(expected);
  });
});
