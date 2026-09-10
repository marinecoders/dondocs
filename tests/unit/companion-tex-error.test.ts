/**
 * The line lifted out of a TeX log and reported to the caller.
 *
 * A failed render used to say only "LaTeX compilation failed (status 1)" while
 * the log held the cause. Pure string handling, so pinning it costs no compile.
 */
import { describe, it, expect } from 'vitest';
import { firstTexError } from '../../companion/render';

/** Trimmed from a real failure: a doc type whose template does not exist. */
const REAL_LOG = [
  '(/tex/preload_pdflscape.sty',
  '(/tex/preload_lscape.sty)) (letterhead.tex) (classification.tex) (document.tex)',
  ' (signatory.tex) (/tex/ot1ptm.fd)',
  '',
  "! LaTeX Error: File `memorandum.tex' not found.",
  '',
  'Type X to quit or <RETURN> to proceed,',
  'or enter new name. (Default extension: tex)',
  '',
  '! Emergency stop.',
  '<read *>',
  'l.1499 \\input{\\DocumentType}',
].join('\n');

describe('firstTexError', () => {
  it('lifts the first line TeX marked as an error', () => {
    expect(firstTexError(REAL_LOG)).toBe("LaTeX Error: File `memorandum.tex' not found.");
  });

  it('takes the FIRST marker, not a later one', () => {
    // `! Emergency stop.` is the consequence; the marker above it is the cause.
    expect(firstTexError(REAL_LOG)).not.toMatch(/Emergency stop/);
  });

  it('strips the marker and its padding', () => {
    expect(firstTexError('!    Undefined control sequence.')).toBe('Undefined control sequence.');
  });

  it('returns nothing when the log marks no error', () => {
    // The caller appends only when this is non-empty, so an empty string is how
    // the original message survives untouched rather than gaining a stray colon.
    expect(firstTexError('(/tex/preload.sty) [1] (main.aux)')).toBe('');
    expect(firstTexError('')).toBe('');
  });

  it('ignores a marker that is not at the start of a line', () => {
    expect(firstTexError('the paragraph ended with a ! character')).toBe('');
  });

  it('bounds a runaway line', () => {
    // This rides back in a tool result, where output is clipped.
    const long = firstTexError('! ' + 'x'.repeat(5_000));
    expect(long).toHaveLength(200);
  });

  it('handles a log with no trailing newline', () => {
    expect(firstTexError('! Missing $ inserted.')).toBe('Missing $ inserted.');
  });
});
