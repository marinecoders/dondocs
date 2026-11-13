import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { normalizeDate, type DateFormatType } from '@/lib/dateFormatting';

describe('shared conservative date formatting', () => {
  it('preserves complete dates through ISO and spelled round trips', () => {
    fc.assert(fc.property(fc.date({ min: new Date('1901-01-01T00:00:00Z'), max: new Date('2099-12-31T00:00:00Z'), noInvalidDate: true }), date => {
      const iso = date.toISOString().slice(0, 10);
      const spelled = normalizeDate(iso, 'spelled');
      expect(spelled).not.toBeNull();
      expect(normalizeDate(spelled!, 'iso')).toBe(iso);
      expect(normalizeDate(spelled!, 'spelled')).toBe(spelled);
    }), { numRuns: 500 });
  });

  it.each(['military', 'spelled', 'iso'] satisfies DateFormatType[])('rejects every day/month ambiguity in %s', style => {
    for (let first = 1; first <= 12; first++) {
      for (let second = 1; second <= 12; second++) {
        if (first !== second) expect(normalizeDate(`${first}/${second}/2026`, style)).toBeNull();
      }
    }
  });

  it.each(['1900-02-29', '2025-02-29', '2026-04-31', '2026-00-12', '2026-12-00', '2026-13-12', '2026-12-32', '2026-11-12\n', '2026-11-12\u2028', '2026-11-12\u2029', '2026-11-12T00:00:00Z'])('rejects rollover and non-date-only input: %j', value => {
    expect(normalizeDate(value, 'iso')).toBeNull();
  });

  it('retains a short military year without expanding an unconfirmed century', () => {
    expect(normalizeDate('01 nov 99', 'military')).toBe('1 Nov 99');
    expect(normalizeDate('01 nov 99', 'spelled')).toBeNull();
    expect(normalizeDate('01 nov 99', 'iso')).toBeNull();
  });
});
