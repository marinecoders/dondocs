import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { correspondenceRenderer } from '../_helpers/correspondenceRender';
import { endorsementFooterFixture } from '../_helpers/endorsementFooterFixture';

describe('endorsement footer position', () => {
  const render = correspondenceRenderer();
  it.each([1, 2, 3].flatMap(lines => [2, 10].map(start => [lines, start] as const)))('%i-line subject starting at %i keeps every footer half an inch from the paper edge', async (lines, start) => {
    const pdf = await getDocument({ data: await render(endorsementFooterFixture(lines, start)), useSystemFonts: false }).promise;
    try {
      expect(pdf.numPages).toBeGreaterThan(1);
      for (let i = 1; i <= pdf.numPages; i++) {
        const content = await (await pdf.getPage(i)).getTextContent();
        const footer = content.items.find(item => 'str' in item && item.str === String(start + i - 1) && item.transform[5] < 100);
        expect(footer, `page ${i}`).toBeDefined();
        expect(footer && 'transform' in footer ? footer.transform[5] : 0).toBeCloseTo(36, 0);
      }
    } finally { await pdf.destroy(); }
  }, 60_000);
});
