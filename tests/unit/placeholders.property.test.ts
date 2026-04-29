/**
 * Property tests for `src/lib/placeholders.ts`.
 *
 * The placeholder system is the variable-substitution layer that bridges
 * form fields → rendered PDF. A bug here either silently drops a user's
 * data (hard to notice in a 5-page document) or renders raw `{{NAME}}`
 * markers in the output (loud but embarrassing). The properties below
 * pin down both failure modes.
 *
 * Round-trip discipline: detect → replace must be idempotent for keys
 * that are present in the values map, and a no-op for keys that aren't.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { detectPlaceholders, replacePlaceholders } from '@/lib/placeholders';

const placeholderNameArb = fc.stringMatching(/^[A-Z][A-Z0-9_]{0,15}$/);
const valueArb = fc.string({ minLength: 0, maxLength: 30 });

describe('detectPlaceholders', () => {
  it('empty input → empty array', () => {
    expect(detectPlaceholders('')).toEqual([]);
  });

  it('finds the names of all `{{NAME}}` occurrences (case-insensitive, uppercased)', () => {
    expect(detectPlaceholders('On {{date}}, {{NAME}} did X')).toEqual(['DATE', 'NAME']);
  });

  it('deduplicates repeated occurrences', () => {
    expect(detectPlaceholders('{{X}} {{X}} {{X}}')).toEqual(['X']);
  });

  it('never throws on any string input', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        detectPlaceholders(s);
      }),
      { numRuns: 300 }
    );
  });

  it('every detected name comes from a valid `{{...}}` token in the input (property)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const names = detectPlaceholders(s);
        for (const name of names) {
          // Either the literal name or a case-fold of it must appear
          // inside `{{...}}` somewhere in the input.
          const re = new RegExp(`\\{\\{${name}\\}\\}`, 'i');
          expect(s).toMatch(re);
        }
      }),
      { numRuns: 200 }
    );
  });
});

describe('replacePlaceholders', () => {
  it('substitutes `{{NAME}}` with values[NAME]', () => {
    expect(replacePlaceholders('Hello {{NAME}}', { NAME: 'World' })).toBe('Hello World');
  });

  it('case-insensitive lookup: `{{name}}` looks up `NAME`', () => {
    expect(replacePlaceholders('Hello {{name}}', { NAME: 'World' })).toBe('Hello World');
  });

  it('unknown placeholder is left in place (the highlight catches it downstream)', () => {
    expect(replacePlaceholders('Hello {{UNKNOWN}}', { NAME: 'X' })).toBe('Hello {{UNKNOWN}}');
  });

  it('multiple placeholders all substituted', () => {
    expect(replacePlaceholders('{{A}} {{B}} {{A}}', { A: 'x', B: 'y' })).toBe('x y x');
  });

  it('never throws on any input/values combo', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.dictionary(placeholderNameArb, valueArb),
        (text, values) => {
          replacePlaceholders(text, values);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('replacement is idempotent when the value contains no `{{...}}` (property)', () => {
    // If the value itself doesn't contain a placeholder syntax, applying
    // replacePlaceholders again is a no-op. This catches a regression
    // where a substituted value would itself be interpreted as a token
    // and re-substituted — a recursion / billion-laughs vector.
    fc.assert(
      fc.property(
        placeholderNameArb,
        // Filter out values that themselves contain `{{` so the property
        // is meaningful (otherwise re-substitution is expected).
        fc.string({ minLength: 1, maxLength: 30 }).filter((v) => !v.includes('{{')),
        (name, value) => {
          const text = `Hello {{${name}}}`;
          const once = replacePlaceholders(text, { [name]: value });
          const twice = replacePlaceholders(once, { [name]: value });
          expect(twice).toBe(once);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('after substitution, the substituted name no longer appears as a placeholder (property)', () => {
    fc.assert(
      fc.property(
        placeholderNameArb,
        fc.string({ minLength: 0, maxLength: 30 }).filter((v) => !v.includes('{{')),
        (name, value) => {
          const text = `prefix {{${name}}} suffix`;
          const out = replacePlaceholders(text, { [name]: value });
          expect(detectPlaceholders(out)).not.toContain(name);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('does not mangle text outside placeholders', () => {
    // Hand-curated edge cases in the surrounding text — the SUT must
    // touch only `{{...}}` regions.
    expect(replacePlaceholders('a&b', {})).toBe('a&b');
    expect(replacePlaceholders('100% sure', {})).toBe('100% sure');
    expect(replacePlaceholders('a\nb', {})).toBe('a\nb');
    expect(replacePlaceholders('{single} {{NAME}}', { NAME: 'X' })).toBe('{single} X');
  });
});
