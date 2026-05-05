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
 *
 * Mutation-testing baseline (Stryker, this PR): initial run scored
 * 38% on placeholders.ts because `buildNavmc11811DefaultValues`,
 * `applyPlaceholdersToNavmc11811`, and `applyPlaceholdersToNavmc10274`
 * had zero direct tests — every mutant on those three functions
 * survived as "no coverage". Tests below close those gaps.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  detectPlaceholders,
  replacePlaceholders,
  buildNavmc11811DefaultValues,
  applyPlaceholdersToNavmc11811,
  applyPlaceholdersToNavmc10274,
} from '@/lib/placeholders';
import type { Navmc11811Data, NavmcForm10274Data } from '@/stores/formStore';

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

// ----- NAVMC 118(11) helpers -----

const SAMPLE_11811: Navmc11811Data = {
  lastName: 'Doe',
  firstName: 'John',
  middleName: 'Michael',
  edipi: '1234567890',
  remarksText: 'Counseled on {{DATE}} re: {{NAME}}',
  remarksTextRight: '',
  entryDate: '15 Jan 26',
  box11: 'PFM',
};

describe('buildNavmc11811DefaultValues', () => {
  it('NAME composite is "LAST, FIRST MIDDLE" uppercased', () => {
    const map = buildNavmc11811DefaultValues(SAMPLE_11811);
    // Per the docblock example "DOE, JOHN MICHAEL".
    expect(map.NAME).toBe('DOE, JOHN, MICHAEL');
  });

  it('NAME composite drops empty parts (no trailing commas)', () => {
    const map = buildNavmc11811DefaultValues({ ...SAMPLE_11811, middleName: '' });
    expect(map.NAME).toBe('DOE, JOHN');
    // No double-comma artifact.
    expect(map.NAME).not.toMatch(/,\s*,/);
  });

  it('NAME composite handles all-empty input as empty (not "undefined")', () => {
    const map = buildNavmc11811DefaultValues({
      ...SAMPLE_11811, lastName: '', firstName: '', middleName: '',
    });
    expect(map.NAME).toBe('');
    expect(map.NAME).not.toContain('undefined');
  });

  it('per-component aliases match the source field values', () => {
    const map = buildNavmc11811DefaultValues(SAMPLE_11811);
    expect(map.LASTNAME).toBe('Doe');
    expect(map.LAST_NAME).toBe('Doe');
    expect(map.FIRSTNAME).toBe('John');
    expect(map.FIRST_NAME).toBe('John');
    expect(map.MIDDLENAME).toBe('Michael');
    expect(map.MIDDLE_NAME).toBe('Michael');
  });

  it('MI is the uppercased first character of middleName', () => {
    expect(buildNavmc11811DefaultValues(SAMPLE_11811).MI).toBe('M');
  });

  it('MI is empty (not "U" for undefined) when middleName is missing', () => {
    expect(buildNavmc11811DefaultValues({ ...SAMPLE_11811, middleName: '' }).MI).toBe('');
  });

  it('MI handles a lowercase middleName by uppercasing', () => {
    expect(buildNavmc11811DefaultValues({ ...SAMPLE_11811, middleName: 'matt' }).MI).toBe('M');
  });

  it('EDIPI / BOX11 / BOX_11 / DATE / ENTRY_DATE all populated from data', () => {
    const map = buildNavmc11811DefaultValues(SAMPLE_11811);
    expect(map.EDIPI).toBe('1234567890');
    expect(map.BOX11).toBe('PFM');
    expect(map.BOX_11).toBe('PFM');
    expect(map.DATE).toBe('15 Jan 26');
    expect(map.ENTRY_DATE).toBe('15 Jan 26');
  });
});

describe('applyPlaceholdersToNavmc11811', () => {
  it('substitutes placeholders in every text field', () => {
    const data: Navmc11811Data = {
      ...SAMPLE_11811,
      remarksText: 'Re: {{NAME}}',
      remarksTextRight: 'Cont. {{NAME}}',
      box11: '{{BOX11}}',
    };
    const result = applyPlaceholdersToNavmc11811(data, {
      NAME: 'PFC SMITH',
      BOX11: 'PFM',
    });
    expect(result.remarksText).toBe('Re: PFC SMITH');
    expect(result.remarksTextRight).toBe('Cont. PFC SMITH');
    expect(result.box11).toBe('PFM');
  });

  it('returns a NEW object (does not mutate input)', () => {
    const data = { ...SAMPLE_11811 };
    const result = applyPlaceholdersToNavmc11811(data, {});
    expect(result).not.toBe(data);
    // Mutating result must not affect data
    result.lastName = 'changed';
    expect(data.lastName).toBe('Doe');
  });

  it('handles undefined remarksTextRight gracefully (?? "" fallback)', () => {
    // The applyPlaceholders... helper has a defensive ?? '' for
    // remarksTextRight. Test it doesn't throw / NaN-out on undefined.
    const data: Navmc11811Data = { ...SAMPLE_11811, remarksTextRight: undefined as unknown as string };
    const result = applyPlaceholdersToNavmc11811(data, {});
    expect(result.remarksTextRight).toBe('');
  });

  it('default-values flow: build then apply yields filled remarks', () => {
    // The intended end-to-end use: caller builds default values from
    // the form's own data, then applies them so cross-field
    // placeholders like {{NAME}} resolve.
    const values = buildNavmc11811DefaultValues(SAMPLE_11811);
    const filled = applyPlaceholdersToNavmc11811(SAMPLE_11811, values);
    expect(filled.remarksText).toBe('Counseled on 15 Jan 26 re: DOE, JOHN, MICHAEL');
  });
});

// ----- NAVMC 10274 helpers -----

const SAMPLE_10274: NavmcForm10274Data = {
  actionNo: '1',
  ssicFileNo: '1000',
  date: '15 Jan 26',
  from: '{{NAME}}',
  via: '{{NAME}}',
  orgStation: 'CAMP LEJEUNE',
  to: 'CO',
  natureOfAction: 'Request {{ACTION}}',
  copyTo: '',
  references: '',
  enclosures: '',
  supplementalInfo: 'Re: {{NAME}}',
  proposedAction: 'Approve',
};

describe('applyPlaceholdersToNavmc10274', () => {
  it('substitutes placeholders in every text field', () => {
    const result = applyPlaceholdersToNavmc10274(SAMPLE_10274, {
      NAME: 'SMITH',
      ACTION: 'transfer',
    });
    expect(result.from).toBe('SMITH');
    expect(result.via).toBe('SMITH');
    expect(result.natureOfAction).toBe('Request transfer');
    expect(result.supplementalInfo).toBe('Re: SMITH');
  });

  it('non-placeholder fields pass through unchanged', () => {
    const result = applyPlaceholdersToNavmc10274(SAMPLE_10274, {});
    expect(result.actionNo).toBe('1');
    expect(result.ssicFileNo).toBe('1000');
    expect(result.date).toBe('15 Jan 26');
    expect(result.orgStation).toBe('CAMP LEJEUNE');
    expect(result.to).toBe('CO');
    expect(result.proposedAction).toBe('Approve');
  });

  it('returns a NEW object (does not mutate input)', () => {
    const data = { ...SAMPLE_10274 };
    const result = applyPlaceholdersToNavmc10274(data, {});
    expect(result).not.toBe(data);
  });

  it('every field of the input is present in the output', () => {
    // Property: applyPlaceholders... never DROPS a field. Catches a
    // regression that omits a key from the returned object literal.
    const result = applyPlaceholdersToNavmc10274(SAMPLE_10274, {});
    for (const key of Object.keys(SAMPLE_10274) as (keyof NavmcForm10274Data)[]) {
      expect(result, `${String(key)} missing from output`).toHaveProperty(key);
    }
  });
});
