/**
 * Property tests for `src/lib/unitAddress.ts`.
 *
 * Two consumers: (1) the Letterhead form UI parses the persisted
 * single-string address into Street/City/State/ZIP fields for editing,
 * and (2) the LaTeX generators read the same string. So the parse +
 * compose pair must round-trip stably or every save would slowly mutate
 * the user's letterhead.
 *
 * The module's docblock claims a stability invariant — verified at
 * landing time on 3,140 unit directory entries:
 *
 *     compose(parse(s)) === compose(parse(compose(parse(s))))
 *
 * That's a fixed-point property: applying the round-trip twice is
 * identical to applying it once. We pin it down here so any future
 * regex / canonicalization tweak that breaks this fixed-point fails CI
 * before shipping.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  parseUnitAddress,
  composeUnitAddress,
  canonicalizeUnitAddress,
  splitAddressForLetterhead,
} from '@/lib/unitAddress';

describe('parseUnitAddress + composeUnitAddress — fixed-point round trip', () => {
  // Realistic-shaped address arbitrary. Keeps the property meaningful
  // (truly random strings would mostly be parse-uninterpretable noise
  // and the round-trip is then necessarily lossy in a way the spec
  // already accepts — anything that fails to match the State+ZIP tail
  // gets stuffed into `city`, and re-composing puts it back as a comma-
  // joined city alone).
  const cityArb = fc
    .stringMatching(/^[A-Z][A-Z ]{2,30}$/)
    .filter((s) => s.trim().length > 0);
  const stateArb = fc.constantFrom(
    'CA',
    'VA',
    'NC',
    'TX',
    'FL',
    'NY',
    'WA',
    'AP',
    'AE',
    'AA'
  );
  const zipArb = fc.oneof(
    fc.stringMatching(/^[0-9]{5}$/),
    fc.stringMatching(/^[0-9]{5}-[0-9]{4}$/)
  );
  const streetArb = fc.oneof(
    fc.constant(''),
    fc.stringMatching(/^[A-Z0-9][A-Z0-9 ]{2,30}$/)
  );
  const realisticAddressArb = fc
    .tuple(streetArb, cityArb, stateArb, zipArb)
    .map(([street, city, state, zip]) =>
      street ? `${street}, ${city}, ${state} ${zip}` : `${city}, ${state} ${zip}`
    );

  it('compose(parse(s)) is a fixed point of itself for realistic addresses', () => {
    fc.assert(
      fc.property(realisticAddressArb, (s) => {
        const once = composeUnitAddress(parseUnitAddress(s));
        const twice = composeUnitAddress(parseUnitAddress(once));
        expect(twice).toBe(once);
      }),
      { numRuns: 300 }
    );
  });

  it('compose(parse(s)) is a fixed point for any string (lossy-but-stable)', () => {
    // Even on garbage input the SUT must converge — no infinite drift,
    // no crash. The first parse may put the whole input in `city`, but
    // the second pass should produce the same output.
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        const once = composeUnitAddress(parseUnitAddress(s));
        const twice = composeUnitAddress(parseUnitAddress(once));
        expect(twice).toBe(once);
      }),
      { numRuns: 300 }
    );
  });

  it('parse never throws on any input (including null / undefined)', () => {
    expect(() => parseUnitAddress(null)).not.toThrow();
    expect(() => parseUnitAddress(undefined)).not.toThrow();
    expect(() => parseUnitAddress('')).not.toThrow();
    fc.assert(
      fc.property(fc.string(), (s) => {
        parseUnitAddress(s);
      }),
      { numRuns: 200 }
    );
  });

  it('composeUnitAddress({}) → empty string', () => {
    expect(composeUnitAddress({ street: '', city: '', state: '', zip: '' })).toBe('');
  });
});

describe('parseUnitAddress — canonical cases', () => {
  it('full civilian address with street', () => {
    expect(parseUnitAddress('PSC BOX 8050, CHERRY POINT, NC 28533-0050')).toEqual({
      street: 'PSC BOX 8050',
      city: 'CHERRY POINT',
      state: 'NC',
      zip: '28533-0050',
    });
  });

  it('city + state + zip (no street)', () => {
    expect(parseUnitAddress('PRESIDIO OF MONTEREY, CA 93944')).toEqual({
      street: '',
      city: 'PRESIDIO OF MONTEREY',
      state: 'CA',
      zip: '93944',
    });
  });

  it('FPO/APO/DPO post designator (no comma between post and state)', () => {
    // Per USPS Pub 28 §38 — military mail uses "FPO AP NNNNN" without a
    // comma. The parser must accept this.
    const parsed = parseUnitAddress('FPO AP 96374');
    expect(parsed.state).toBe('AP');
    expect(parsed.zip).toBe('96374');
  });

  it('garbled input goes into city (no data dropped)', () => {
    // The docblock guarantees that anything not matching State+ZIP
    // ends up in `city` so the user can see + edit it. Critical for
    // the 17 unit directory entries with placeholder text.
    const parsed = parseUnitAddress('CONTACT MI TO UPDATE ADDRESS');
    expect(parsed.city).toBe('CONTACT MI TO UPDATE ADDRESS');
  });
});

describe('canonicalizeUnitAddress', () => {
  it('idempotent (property)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        const once = canonicalizeUnitAddress(s);
        const twice = canonicalizeUnitAddress(once);
        expect(twice).toBe(once);
      }),
      { numRuns: 200 }
    );
  });

  it('never throws', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        canonicalizeUnitAddress(s);
      }),
      { numRuns: 200 }
    );
  });
});

describe('splitAddressForLetterhead', () => {
  it('returns shape with `line1` and `line2` fields', () => {
    const out = splitAddressForLetterhead('PSC BOX 8050, CHERRY POINT, NC 28533-0050');
    expect(typeof out).toBe('object');
    expect(out).toHaveProperty('line1');
    expect(out).toHaveProperty('line2');
  });

  it('never throws', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        splitAddressForLetterhead(s);
      }),
      { numRuns: 200 }
    );
  });

  it('every input character ends up in line1 + line2 modulo whitespace + commas', () => {
    // Generators rely on splitAddressForLetterhead to NEVER drop content.
    // Lossy splits would silently truncate the address in the rendered
    // letterhead.
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Z0-9][A-Z0-9 ,-]{0,80}$/),
        (s) => {
          const { line1, line2 } = splitAddressForLetterhead(s);
          const inputChars = s.replace(/[\s,]/g, '');
          const outputChars = (line1 + line2).replace(/[\s,]/g, '');
          expect(outputChars).toBe(inputChars);
        }
      ),
      { numRuns: 200 }
    );
  });
});
