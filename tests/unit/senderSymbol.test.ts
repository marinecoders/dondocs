/**
 * The originator's code line, against the manual's own examples.
 *
 * SECNAV M-5216.5 Ch 7 para 2a(2) prints, verbatim:
 *
 *     5216            5800            5216
 *     Code 13         N00J            Ser Code 13/271
 *
 * Two shapes are the contract: the code alone under the SSIC, and the code fused
 * with a serial as `Ser <code>/<serial>`. The code itself is printed as the
 * activity writes it — see senderSymbol.ts on why "Code" is not added here.
 */
import { describe, it, expect } from 'vitest';
import { composeSenderSymbol } from '@/services/latex/senderSymbol';

describe("the manual's examples", () => {
  // The code prints as the activity writes it — ¶2a(2) leaves its makeup to the
  // command. A bare numeric code is the norm across the manual's examples.
  it.each([
    ['02', '318', 'Ser 02/318'],
    ['00', '451', 'Ser 00/451'],
    ['301', '403', 'Ser 301/403'],
    ['945', '321', 'Ser 945/321'],
    ['N00J', 'S20', 'Ser N00J/S20'],
    ['N1', '123', 'Ser N1/123'],
    ['09B33', '6U317731', 'Ser 09B33/6U317731'],
    ['DDG 78', '437', 'Ser DDG 78/437'],
    ['SSN 756', '001', 'Ser SSN 756/001'],
  ])('fuses %s with %s as "%s"', (code, serial, expected) => {
    expect(composeSenderSymbol(code, serial)).toBe(expected);
  });

  it('reaches "Ser Code 13/271" when the activity writes its code that way', () => {
    // Prefixing "Code" automatically would rewrite the eight bare-numeric
    // examples above; ¶7a's "Code" rule is for the "To:" line, not this one.
    expect(composeSenderSymbol('Code 13', '271')).toBe('Ser Code 13/271');
    expect(composeSenderSymbol('Code 10', '049')).toBe('Ser Code 10/049');
  });

  it('leaves a code alone under the SSIC when there is no serial', () => {
    expect(composeSenderSymbol('N00J', '')).toBe('N00J');
    expect(composeSenderSymbol('Code 13', '')).toBe('Code 13');
  });
});

describe('partial input', () => {
  it('prefixes a lone serial with "Ser"', () => {
    // Previously this rendered bare — "001" sitting under the SSIC.
    expect(composeSenderSymbol('', '001')).toBe('Ser 001');
  });

  it('returns nothing when neither is set, so the line is omitted', () => {
    expect(composeSenderSymbol('', '')).toBe('');
    expect(composeSenderSymbol(undefined, undefined)).toBe('');
  });

  it('ignores surrounding whitespace', () => {
    expect(composeSenderSymbol('  S-6  ', '  042  ')).toBe('Ser S-6/042');
  });

  it('does not rewrite a numeric code', () => {
    // "02" stays "02" — the manual prints it bare.
    expect(composeSenderSymbol('02', '318')).not.toContain('Code');
  });
});

describe('a value the user already composed', () => {
  // Anyone who typed the whole symbol into the serial field was working around
  // the missing code. Prefixing again would produce "Ser Ser ...".
  it('passes through a serial that already starts with "Ser"', () => {
    expect(composeSenderSymbol('', 'Ser 12/001')).toBe('Ser 12/001');
    expect(composeSenderSymbol('13', 'Ser Code 13/271')).toBe('Ser Code 13/271');
  });

  it('matches "Ser" case-insensitively but not as a prefix of another word', () => {
    expect(composeSenderSymbol('', 'ser N00/1')).toBe('ser N00/1');
    // "Serial" is not the marker — treat it as a value needing the prefix.
    expect(composeSenderSymbol('', 'Serial')).toBe('Ser Serial');
  });
});

describe('shape', () => {
  it('never puts spaces around the slash', () => {
    expect(composeSenderSymbol('N00J', '20')).not.toMatch(/\s\/|\/\s/);
  });
});
