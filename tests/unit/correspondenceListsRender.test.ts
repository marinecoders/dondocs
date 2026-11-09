import { describe, expect, it } from 'vitest';
import { correspondenceRenderer } from '../_helpers/correspondenceRender';
import { buildBaseline } from '../_helpers/compileMatrix';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';

describe('breakable correspondence lists', () => {
  const render = correspondenceRenderer();
  it.each(['naval_letter', 'standard_memorandum'] as const)('%s paginates all references inside the paper', async type => {
    const store = buildBaseline(type);
    store.references = Array.from({ length: 20 }, (_, i) => ({ letter: String.fromCharCode(97 + i),
      title: `REF${i}START ${'Training coordination and operational readiness requirements for all assigned commands. '.repeat(4)} REF${i}END` }));
    store.enclosures = [];
    const { boxes } = await pdfTextLayout(await render(store));
    const text = boxes.map(b => b.text).join(' ');
    for (let i = 0; i < 20; i++) expect(text).toContain(`REF${i}END`);
    expect(Math.max(...boxes.map(b => b.page))).toBeGreaterThan(2);
    for (const box of boxes.filter(b => !/^\d+$/.test(b.text.trim()))) {
      expect(box.bottom, `${box.text} on page ${box.page}`).toBeGreaterThan(50);
      expect(box.right).toBeLessThan(542);
    }
  }, 60_000);

  it('paginates enclosure titles and a reference longer than a page', async () => {
    const store = buildBaseline('naval_letter');
    store.references = [{ letter: 'a', title: `LONGSTART ${'Training coordination requirements. '.repeat(400)} LONGEND` }];
    store.enclosures = Array.from({ length: 20 }, (_, i) => ({ title: `ENC${i}START ${'Training schedule and support responsibilities. '.repeat(5)} ENC${i}END` }));
    const { boxes } = await pdfTextLayout(await render(store));
    const text = boxes.map(b => b.text).join(' ');
    expect(text).toContain('LONGEND');
    for (let i = 0; i < 20; i++) expect(text).toContain(`ENC${i}END`);
    for (const box of boxes.filter(b => !/^\d+$/.test(b.text.trim()))) expect(box.bottom, box.text).toBeGreaterThan(50);
  }, 60_000);

  it('does not letter a single headquarters reference', async () => {
    const store = buildBaseline('standard_memorandum');
    store.references = [{ letter: 'a', title: 'SINGLEREFERENCE Training coordination guidance' }];
    const { boxes } = await pdfTextLayout(await render(store));
    const text = boxes.map(b => b.text).join(' ');
    expect(text).toContain('Reference:');
    expect(text).toContain('SINGLEREFERENCE');
    expect(text).not.toContain('(a)');
  }, 60_000);
});
