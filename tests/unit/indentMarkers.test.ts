/**
 * The Lua filter's indent markers become real w:ind attributes.
 *
 * `dondocs.lua` can't emit OpenXML from an inline, so it leaves a run of
 * marker characters at the head of the paragraph and this pass converts them.
 * Three macros, three characters, three different indents — and getting the
 * wrong one is silent: the paragraph still renders, just indented the wrong
 * way (or, if the markers survive, with stray blanks in the text).
 *
 * Worth unit-testing rather than leaning on the DOCX compile harness, which
 * deliberately skips the JSZip post-pass (see tests/_helpers/compileDocx.ts) —
 * so none of this had coverage before.
 */
import { describe, it, expect } from 'vitest';
import { applyIndentMarkers } from '@/services/docx/pandoc-converter';

const NBSP = ' '; // \dondocsindent      → whole block
const EM = ' ';   // \dondocsfirstindent → first line only
const FIG = ' ';  // \dondocshangindent  → runover only

/** A paragraph with `markers` at the head of its text, as pandoc emits one. */
function para(markers: string, text = 'Body text.', withPPr = true): string {
  const pPr = withPPr ? '<w:pPr><w:pStyle w:val="Compact"/></w:pPr>' : '';
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${markers}${text}</w:t></w:r></w:p>`;
}

describe('applyIndentMarkers', () => {
  it('turns non-breaking spaces into a whole-block indent', () => {
    const out = applyIndentMarkers(para(NBSP.repeat(3)));
    expect(out).toContain('<w:ind w:left="720"/>'); // 3/6 in = 0.5in = 720 twips
    expect(out).not.toContain(NBSP);
  });

  it('turns em-spaces into a first-line indent', () => {
    const out = applyIndentMarkers(para(EM.repeat(3)));
    expect(out).toContain('<w:ind w:firstLine="60"/>');
    expect(out).not.toContain(EM);
  });

  it('turns figure-spaces into a hanging indent', () => {
    // Ch 7 ¶10c: a Ref:/Encl: runover goes under the entry text, so the
    // paragraph shifts right and the first line is pulled back out by the
    // same amount — leaving the designator where it was.
    const out = applyIndentMarkers(para(FIG.repeat(3), '(a)  A long reference title.'));
    expect(out).toContain('<w:ind w:left="720" w:hanging="720"/>');
    expect(out).not.toContain(FIG);
  });

  it('never confuses the three kinds', () => {
    const doc = para(NBSP.repeat(3), 'block') + para(EM.repeat(3), 'first') + para(FIG.repeat(3), 'hang');
    const out = applyIndentMarkers(doc);
    expect((out.match(/w:ind w:left="720"\/>/g) || []).length).toBe(1);
    // Em-space markers run at 72 per inch, so three of them are 3pt, not half
    // an inch — the other two kinds are still 6 per inch.
    expect((out.match(/w:firstLine="60"/g) || []).length).toBe(1);
    expect((out.match(/w:hanging="720"/g) || []).length).toBe(1);
  });

  it('adds a pPr when the paragraph has none', () => {
    const out = applyIndentMarkers(para(FIG.repeat(2), 'x', false));
    expect(out).toContain('<w:p><w:pPr><w:ind w:left="480" w:hanging="480"/></w:pPr>');
  });

  it('converts every entry in a list, not just the first', () => {
    // Reverse-order splicing is what makes this work; a forward loop would
    // shift the indices of every later match after the first edit.
    const doc = [1, 2, 3].map((n) => para(FIG.repeat(2), `(${n})  Entry ${n}.`)).join('');
    const out = applyIndentMarkers(doc);
    expect((out.match(/w:hanging="480"/g) || []).length).toBe(3);
    expect(out).not.toContain(FIG);
  });

  it('leaves a paragraph with no markers untouched', () => {
    const plain = para('', 'Nothing to indent.');
    expect(applyIndentMarkers(plain)).toBe(plain);
  });

  it('ignores the marker characters when they are not at the head of the text', () => {
    // `~~` between a label and its text is itself a pair of non-breaking
    // spaces, so a whole-paragraph search would report an indent on every
    // numbered subparagraph.
    const mid = para('', `1.${NBSP}${NBSP}Body text.`);
    expect(applyIndentMarkers(mid)).toBe(mid);
  });
});
