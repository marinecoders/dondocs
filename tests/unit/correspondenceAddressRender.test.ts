import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNodeEngine, loadAssets } from '../../companion/nodeEngine';
import { compileDocument, prepareEngine } from '@/services/latex/renderDocument';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { wrapAddressLines } from '@/services/latex/escaper';
import { buildBaseline } from '../_helpers/compileMatrix';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';

describe('correspondence address rows', () => {
  let engine: Awaited<ReturnType<typeof createNodeEngine>>;
  const previous = process.env.DONDOCS_TEXLIVE_BUNDLE_ONLY;
  beforeAll(async () => {
    process.env.DONDOCS_TEXLIVE_BUNDLE_ONLY = '1';
    engine = await createNodeEngine();
    prepareEngine(engine, await loadAssets());
  }, 60_000);
  afterAll(async () => {
    if (previous === undefined) delete process.env.DONDOCS_TEXLIVE_BUNDLE_ONLY;
    else process.env.DONDOCS_TEXLIVE_BUNDLE_ONLY = previous;
    await engine?.dispose();
  });

  it.each([0, 1, 2, 4, 5, 6, 10])('retains all %i Via addressees in the bundled PDF engine', async count => {
    const store = buildBaseline('naval_letter');
    store.formData.via = Array.from({ length: count }, (_, i) => `ROUTE${i + 1} Training Command`).join('\n');
    const { texFiles } = generateAllLatexFiles(store);
    const { boxes } = await pdfTextLayout(await compileDocument(engine, texFiles));
    const text = boxes.map(box => box.text).join(' ');
    for (let i = 1; i <= count; i++) expect(text.match(new RegExp(`ROUTE${i}\\b`, 'g'))).toHaveLength(1);
    if (count === 1) expect(text).not.toContain('(1) ROUTE');
    if (count > 1) expect(text).toMatch(new RegExp(`\\(${count}\\)\\s+ROUTE${count}\\b`));
  }, 60_000);

  it('starts each action addressee on its own rendered line', async () => {
    const store = buildBaseline('multiple_address_letter');
    store.formData.to = 'ALPHAUNIT Training Battalion\r\nBRAVOUNIT Training Battalion';
    const { texFiles } = generateAllLatexFiles(store);
    const { boxes } = await pdfTextLayout(await compileDocument(engine, texFiles));
    const alpha = boxes.find(box => box.text.includes('ALPHAUNIT'))!;
    const bravo = boxes.find(box => box.text.includes('BRAVOUNIT'))!;
    expect(alpha).toBeDefined();
    expect(bravo).toBeDefined();
    expect(alpha.left).toBeCloseTo(bravo.left, 1);
    expect(alpha.top - bravo.top).toBeGreaterThan(10);
  }, 60_000);

  it.each([10, 14])('rejects %i wrapped Via rows that cannot fit on the opening page', async count => {
    const store = buildBaseline('naval_letter');
    store.formData.via = Array.from({ length: count }, (_, i) =>
      `ROUTE${i + 1} Commanding General, Example Regional Headquarters, Training Coordination, Readiness and Operational Planning Directorate, Headquarters Support Division`).join('\n');
    const { texFiles } = generateAllLatexFiles(store);
    const error = await compileDocument(engine, texFiles).then(() => null, error => error);
    expect(error?.message).toContain('does not fit on the opening page');
  }, 60_000);

  it('preserves LF/CRLF rows and wraps within each row', () => {
    expect(wrapAddressLines('Alpha Battalion\r\n\r\nBravo Battalion')).toEqual(['Alpha Battalion', '', 'Bravo Battalion']);
    expect(wrapAddressLines('Alpha Battalion\nBravo Battalion', 10)).toEqual(['Alpha', 'Battalion', 'Bravo', 'Battalion']);
  });
});
