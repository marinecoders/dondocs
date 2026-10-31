import { expect } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdfRules } from './pdfRules';

/** Inspect exported text metrics and strokes, independently of generated TeX. */
export async function expectSl3SourceTypography(bytes: Uint8Array) {
  const pdf = await getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
  }).promise;
  try {
    const items = async (page: number) =>
      (await (await pdf.getPage(page)).getTextContent()).items.filter(
        (item) => 'str' in item,
      );
    const cover = await items(1);
    const nomenclature = cover.find((i) =>
      i.str.includes('TOOL KIT, TRAINING'),
    )!;
    expect(nomenclature).toBeDefined();
    expect(Math.abs(nomenclature.transform[0])).toBeCloseTo(9.963, 1);
    const auth = await items(2);
    const body = auth.find((i) =>
      i.str.includes('authenticated for Marine Corps'),
    )!;
    expect(body).toBeDefined();
    expect(Math.abs(body.transform[0])).toBeCloseTo(9.963, 1);
    const toc = await items(3);
    expect(toc.some((i) => i.str.includes('30 OCTOBER 2026'))).toBe(true);
    const rules = await pdfRules(bytes, 3);
    // Title underlines exist well outside the reserved page-number column.
    expect(
      rules.filter(
        (r) =>
          r.left < 200 &&
          r.right - r.left > 20 &&
          Math.abs(r.top - r.bottom) < 0.01,
      ).length,
    ).toBeGreaterThan(10);
  } finally {
    await pdf.destroy();
  }
}

/** Searchable labels must be painted after the opaque artwork, so they remain visible. */
export async function expectVisibleSl3Label(bytes: Uint8Array, page: number) {
  const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
  }).promise;
  try {
    const operators = await (await pdf.getPage(page)).getOperatorList();
    const image = operators.fnArray.findIndex(
      (op) => op === OPS.paintImageXObject,
    );
    const label = operators.fnArray.findIndex(
      (op, i) =>
        op === OPS.showText &&
        operators.argsArray[i][0]
          .map((glyph: { unicode?: string } | number) =>
            typeof glyph === 'number' ? '' : (glyph.unicode ?? ''),
          )
          .join('')
          .includes('VALVE'),
    );
    expect(image).toBeGreaterThanOrEqual(0);
    expect(label).toBeGreaterThan(image);
  } finally {
    await pdf.destroy();
  }
}
