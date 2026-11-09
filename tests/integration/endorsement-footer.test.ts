import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { compileFixture } from '../_helpers/compileLatex';
import { endorsementFooterFixture } from '../_helpers/endorsementFooterFixture';

describe('native endorsement footer geometry', () => {
  it.each([1, 2, 3].flatMap(lines => [2, 10].map(start => [lines, start] as const)))('%i-line subject starting at %i preserves opening/later baselines', async (lines, start) => {
    const result = await compileFixture(endorsementFooterFixture(lines, start));
    expect(result.ok, result.logTail).toBe(true);
    const pdf = await getDocument({ data: result.pdfBytes!, useSystemFonts: false }).promise;
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        const content = await (await pdf.getPage(i)).getTextContent();
        const footer = content.items.find(item => 'str' in item && item.str === String(start + i - 1) && item.transform[5] < 100);
        expect(footer).toBeDefined();
        expect(footer && 'transform' in footer ? footer.transform[5] : 0).toBeCloseTo(36, 0);
      }
    } finally { await pdf.destroy(); }
  }, 60_000);
});
