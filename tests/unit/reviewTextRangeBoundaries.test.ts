import { describe, expect, it, vi } from 'vitest';
import { isTextRangeBoundary } from '@/lib/reviewTextRanges';

describe('selected-text grapheme boundaries', () => {
  it('agrees with Unicode segmentation at every UTF-16 offset', () => {
    for (const text of ['ASCII', 'A 😀 e\u0301 👨‍👩‍👧‍👦 Z', '🇺🇸🇨🇦\r\nक्‍षि', '\u0600A\u200BZ', '']) {
      const boundaries = new Set([...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].map(part => part.index));
      boundaries.add(text.length);
      for (let offset = -1; offset <= text.length + 1; offset++)
        expect(isTextRangeBoundary(text, offset), `${JSON.stringify(text)} at ${offset}`).toBe(boundaries.has(offset));
    }
    for (const text of ['ok\ud800', '\udc00ok', '\ud800\ud800'])
      for (const offset of [0, 1, text.length]) expect(isTextRangeBoundary(text, offset)).toBe(false);
    for (const offset of [NaN, Infinity, 0.5]) expect(isTextRangeBoundary('plain', offset)).toBe(false);
  });

  it('checks a nearby boundary without traversing the whole allowed paragraph', () => {
    const segment = Intl.Segmenter.prototype.segment;
    let traversed = 0;
    const spy = vi.spyOn(Intl.Segmenter.prototype, 'segment').mockImplementation(function (this: Intl.Segmenter, text: string) {
      const segments = segment.call(this, text);
      return new Proxy(segments, {
        get(target, property) {
          if (property === Symbol.iterator) return function* () {
            for (const part of target) { traversed++; yield part; }
          };
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    });
    try {
      expect(isTextRangeBoundary('a'.repeat(20_000), 1)).toBe(true);
      expect(traversed).toBeLessThan(100);
    } finally { spy.mockRestore(); }
  });
});
