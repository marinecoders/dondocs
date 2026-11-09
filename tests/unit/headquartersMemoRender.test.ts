import { describe, expect, it } from 'vitest';
import { paragraphHasLabel } from '@/services/latex/paragraphLayout';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { correspondenceRenderer } from '../_helpers/correspondenceRender';
import { headquartersFixture } from '../_helpers/headquartersFixture';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';

describe('headquarters memorandum layout', () => {
  const render = correspondenceRenderer();
  it.each(['standard_memorandum', 'executive_memorandum'] as const)('%s aligns every address/ATTN line and labels subparagraphs', async type => {
    const store = headquartersFixture(type);
    const { boxes } = await pdfTextLayout(await render(store));
    // Compare the active font's measured positions. Native and Word
    // metric checks are covered by their respective integration suites.
    const expected = boxes.find(b => b.text.includes('RUNOVERSTART'))!.left;
    expect(expected).toBeGreaterThan(190);
    expect(expected).toBeLessThan(240);
    for (const marker of ['RUNOVERSTART', 'ATTNSTART', 'ATTNTAIL']) {
      const box = boxes.find(b => b.text.includes(marker))!;
      expect(box, marker).toBeDefined();
      expect(Math.abs(box.left - expected), `${marker}: ${box.left} versus ${expected}`).toBeLessThan(1);
    }
    const text = boxes.map(b => b.text).join(' ');
    for (const label of ['a.', '(1)', '(2)', 'b.']) expect(text).toContain(label);
    expect(text).not.toMatch(/1\.\s+BODY0START/);
  }, 60_000);

  it('keeps action/info paragraph policy separate', () => {
    for (const type of ['action_memorandum', 'information_memorandum']) {
      expect(paragraphHasLabel(0, DOC_TYPE_CONFIG[type])).toBe(false);
      expect(paragraphHasLabel(1, DOC_TYPE_CONFIG[type])).toBe(false);
    }
  });
});
