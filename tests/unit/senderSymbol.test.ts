/**
 * The originator's code line, against the manual's own examples.
 *
 * SECNAV M-5216.5 Ch 7 para 2a(2) prints, verbatim:
 *
 *     5216            5800            5216
 *     Code 13         N00J            Ser Code 13/271
 *
 * Those three shapes are the contract: code alone under the SSIC, code alone
 * when it already starts with a letter, and code fused with a serial.
 */
import { describe, it, expect } from 'vitest';
import { composeSenderSymbol } from '@/services/latex/senderSymbol';

describe("the manual's examples", () => {
  it('renders a numeric code alone as "Code 13"', () => {
    expect(composeSenderSymbol('13', '')).toBe('Code 13');
  });

  it('renders an alphanumeric code alone as "N00J" — no "Code" prefix', () => {
    expect(composeSenderSymbol('N00J', '')).toBe('N00J');
  });

  it('fuses code and serial as "Ser Code 13/271"', () => {
    expect(composeSenderSymbol('13', '271')).toBe('Ser Code 13/271');
  });

  it('fuses an alphanumeric code as "Ser N00J/S20"', () => {
    expect(composeSenderSymbol('N00J', 'S20')).toBe('Ser N00J/S20');
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

  it('does not double the "Code" prefix when the user typed it', () => {
    expect(composeSenderSymbol('Code 13', '271')).toBe('Ser Code 13/271');
  });
});

describe('shape', () => {
  it('never puts spaces around the slash', () => {
    expect(composeSenderSymbol('N00J', '20')).not.toMatch(/\s\/|\/\s/);
  });
});
