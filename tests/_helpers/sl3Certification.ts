import { expect } from 'vitest';
import { pdfRules } from './pdfRules';

/** Check the rendered vectors against the supplied templates, not TeX strings. */
export async function expectSl3Certification(
  bytes: Uint8Array,
  pageNumber: number,
  orientation: 'portrait' | 'landscape',
) {
  const expected =
    orientation === 'portrait'
      ? {
          lines: 21,
          pitch: 26.4,
          left: [69.3, 227.7, 394.05],
          width: [140.4, 152.85, 148.65],
        }
      : {
          lines: 12,
          pitch: 29.3,
          left: [36, 285.2, 552.9],
          width: [221.5, 240, 203.1],
        };
  const allRules = await pdfRules(new Uint8Array(bytes), pageNumber);
  const rules = allRules
    .filter(
      (rule) =>
        Math.abs(rule.top - rule.bottom) < 0.01 &&
        rule.right - rule.left > 100 &&
        rule.right - rule.left < 400,
    )
    .sort((a, b) => b.bottom - a.bottom || a.left - b.left);
  expect(rules).toHaveLength(expected.lines * 3);
  const separator = allRules.find(
    (r) => r.right - r.left > 400 && Math.abs(r.top - r.bottom) < 0.01,
  )!;
  expect(separator).toBeDefined();
  // Measured line-center distances from the supplied source forms. Portrait's
  // close first rule is the grid top border; its first writing baseline is next.
  expect(separator.bottom - rules[0].top).toBeCloseTo(
    orientation === 'portrait' ? 13.25 : 41.2,
    1,
  );
  for (let row = 0; row < expected.lines; row++) {
    const cells = rules
      .slice(row * 3, row * 3 + 3)
      .sort((a, b) => a.left - b.left);
    for (let column = 0; column < 3; column++) {
      const rule = cells[column];
      expect(rule.left).toBeCloseTo(expected.left[column], 1);
      expect(rule.right - rule.left).toBeCloseTo(expected.width[column], 1);
      expect(rule.bottom).toBeCloseTo(cells[0].bottom, 2);
      expect(rule.weight).toBeCloseTo(0.75, 2);
      expect(rule.bottom).toBeGreaterThan(61.2); // Clear the footer/control banner.
    }
    if (row)
      expect(rules[(row - 1) * 3].bottom - cells[0].bottom).toBeCloseTo(
        expected.pitch,
        1,
      );
  }
}
