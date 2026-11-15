import { describe, expect, it } from 'vitest';
import type { Paragraph } from '@/types/document';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { generateBodyTex } from '@/services/latex/generator';
import { buildBaseline } from '../_helpers/compileMatrix';

function figure(level = 0): Paragraph {
  return { level, text: 'Synthetic training diagram', figure: {
    name: 'diagram.png', type: 'image/png', width: 480, height: 240,
    fileRef: { id: 'synthetic-figure', name: 'diagram.png', type: 'image/png', size: 1 },
  } };
}

function source(paragraphs: Paragraph[], mode: 'custom' | 'compliant' = 'custom') {
  const store = buildBaseline('business_letter');
  store.documentMode = mode;
  store.formData.sigLast = 'SIGNATURESENTINEL';
  store.paragraphs = paragraphs;
  return store;
}

function indentFor(tex: string, marker: string): string | undefined {
  return tex.split('\n').find(line => line.includes(marker))
    ?.match(/\\dondocs(?:first)?indent\{([\d.]+)in\}/)?.[1];
}

describe('Word paragraph numbering around business-letter figures', () => {
  it('keeps figure numbering separate from ordinary paragraph numbering', () => {
    const store = source([{ level: 0, text: 'FIRST' }, { level: 0, text: 'SECOND' },
      figure(), { level: 0, text: 'AFTERFIGURE' }]);
    expect(generateBodyTex(store)).toContain('3.~~AFTERFIGURE');
    const tex = generateFlatLatex(store);
    expect(tex).toContain('\\mbox{3.}~~AFTERFIGURE');
    expect(tex).toContain('\\textbf{Figure 1.');
    expect(tex.indexOf('AFTERFIGURE')).toBeLessThan(tex.indexOf('SIGNATURESENTINEL'));
  });

  it('preserves nested counters and ancestor indents across figures at other levels', () => {
    const tex = generateFlatLatex(source([
      { level: 0, text: 'FIRST' }, { level: 1, text: 'CHILDA' }, figure(),
      { level: 1, text: 'CHILDB' }, { level: 2, text: 'GRANDA' }, figure(0),
      { level: 2, text: 'GRANDB' }, { level: 0, text: 'NEXTTOP' },
      { level: 1, text: 'RESETCHILD' },
    ]));
    for (const [label, marker] of [['1.', 'FIRST'], ['a.', 'CHILDA'], ['b.', 'CHILDB'],
      ['(1)', 'GRANDA'], ['(2)', 'GRANDB'], ['2.', 'NEXTTOP'], ['a.', 'RESETCHILD']]) {
      expect(tex).toContain(`\\mbox{${label}}~~${marker}`);
    }
    expect(indentFor(tex, 'CHILDA')).toBeDefined();
    expect(indentFor(tex, 'GRANDA')).toBeDefined();
    expect(indentFor(tex, 'CHILDB')).toBe(indentFor(tex, 'CHILDA'));
    expect(indentFor(tex, 'GRANDB')).toBe(indentFor(tex, 'GRANDA'));
    expect(tex).toContain('\\textbf{Figure 1.');
    expect(tex).toContain('\\textbf{Figure 2.');
  });

  it('keeps compliant business body paragraphs unnumbered while numbering figures', () => {
    const tex = generateFlatLatex(source([{ level: 0, text: 'FIRST' }, figure(),
      { level: 0, text: 'AFTERFIGURE' }], 'compliant'));
    expect(tex).not.toMatch(/\\mbox\{\d+\.\}~~(?:FIRST|AFTERFIGURE)/);
    expect(tex).toContain('\\textbf{Figure 1.');
  });
});
