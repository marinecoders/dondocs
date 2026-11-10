import { describe, expect, it } from 'vitest';
import { correspondenceRenderer } from '../_helpers/correspondenceRender';
import { buildBaseline } from '../_helpers/compileMatrix';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';
import { closingTailStart } from '@/lib/correspondenceClosing';

describe('correspondence closing pagination', () => {
  const render = correspondenceRenderer();
  it.each(['naval_letter', 'business_letter', 'standard_memorandum', 'mf'] as const)('%s keeps prose with the signature across page boundaries', async type => {
    for (const count of [6, 7, 8, 9, 10, 11, 12, 16, 17]) {
      const store = buildBaseline(type);
      Object.assign(store.formData, { fontFamily: 'times', fontSize: '12pt', sigTitle: 'Director, Example Command' });
      store.references = []; store.enclosures = []; store.copyTos = [];
      store.paragraphs = Array.from({ length: count }, (_, i) => ({ level: 0,
        text: `BODY${i}START The training staff reviews the coordinating instructions for the scheduled command exercise and returns consolidated comments before the published suspense. BODY${i}END` }));
      const { boxes } = await pdfTextLayout(await render(store));
      const signer = boxes.find(b => /J\. A\. DOE|JOHN A DOE|John A DOE/.test(b.text));
      expect(signer, `${type} with ${count} paragraphs`).toBeDefined();
      const lines = boxes.filter(b => b.page === signer!.page && b.top > signer!.top && /BODY|training staff|coordinating|scheduled|consolidated|published suspense/.test(b.text));
      expect(new Set(lines.map(b => Math.round(b.top))).size, `${type} with ${count} paragraphs`).toBeGreaterThanOrEqual(2);
    }
  }, 120_000);

  it('links a one-line final paragraph despite trailing empty rows', async () => {
    const store = buildBaseline('naval_letter');
    store.paragraphs = Array.from({ length: 12 }, () => ({ level: 0, text: 'Training staff coordinate the scheduled review and consolidate comments. '.repeat(4) }));
    store.paragraphs.push({ level: 0, text: 'BODYTAIL Approved for coordination.' }, { level: 0, text: '' }, { level: 0, text: ' ' });
    expect(closingTailStart(store.docType, store.paragraphs)).toBe(11);
    const { boxes } = await pdfTextLayout(await render(store));
    const signer = boxes.find(b => b.text.includes('J. A. DOE'))!;
    const lines = boxes.filter(b => b.page === signer.page && b.top > signer.top && /Training staff|scheduled|consolidate|BODYTAIL/.test(b.text));
    expect(new Set(lines.map(b => Math.round(b.top))).size).toBeGreaterThanOrEqual(2);
  }, 60_000);
});
