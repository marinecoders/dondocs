/**
 * Word-level / sentence-level fuzz.
 *
 * Where `random-strings.fuzz.test.ts` throws raw character noise at
 * the API surface, this file uses `fc.lorem` (real English words) and
 * SECNAV-shaped paragraph synth to cover the path between "valid
 * input" and "weird input that nobody would write but might paste".
 *
 * Same contract: never throw. Different distribution.
 *
 * Why both flavors? `random-strings` catches "this regex panics on
 * a surrogate half"; `random-words` catches "this regex matches
 * partway through 'reference' and produces \\textbf with an
 * unbalanced brace". Both happen, both ship to users, both deserve
 * a fast-running guard.
 */
import { describe, it } from 'vitest';
import fc from 'fast-check';
import {
  adversarialSentence,
} from '../_helpers/fuzzArbitraries';

import {
  escapeLatex,
  processBodyText,
  convertRichTextToLatex,
  formatSubjectForLatex,
  formatAddressForLatex,
} from '@/services/latex/escaper';
import { wrapTextForForm } from '@/services/pdf/textWrap';
import {
  detectPlaceholders,
  replacePlaceholders,
} from '@/lib/placeholders';
import {
  countWords,
  calculateLabels,
  paragraphsToPlainText,
  getMaxDepth,
  type ParagraphLike,
} from '@/lib/paragraphUtils';
import { parseUnitAddress, composeUnitAddress } from '@/lib/unitAddress';
import {
  textToEditorHtml,
} from '@/components/ui/variable-chip-editor-text';
import { monoFont } from '../_helpers/monoFont';

const NUM_RUNS = 200;

describe('escaper.ts — sentence-level fuzz', () => {
  it('escapeLatex never throws on lorem-ipsum input', () => {
    fc.assert(
      fc.property(adversarialSentence, (s) => {
        escapeLatex(s);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('processBodyText never throws on multi-paragraph SECNAV-shaped input', () => {
    fc.assert(
      fc.property(adversarialSentence, (s) => {
        processBodyText(s);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('convertRichTextToLatex never throws on word sequences with embedded markers', () => {
    // Paragraph synth + injected markers: the rich-text converter is
    // greedy on `**...**`, `*...*`, `__...__` — make sure no input
    // shape sends it into infinite recursion or a broken \\textbf{}.
    const withMarkers = adversarialSentence.map((s) => {
      const inj = (m: string) => {
        const words = s.split(' ');
        if (words.length < 2) return s;
        const i = Math.floor(words.length / 2);
        return [...words.slice(0, i), m, ...words.slice(i)].join(' ');
      };
      return inj('**bold**') + ' ' + inj('*italic*') + ' ' + inj('__under__');
    });
    fc.assert(
      fc.property(withMarkers, (s) => {
        convertRichTextToLatex(s);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('formatSubjectForLatex never throws on long sentence input', () => {
    fc.assert(
      fc.property(adversarialSentence, (s) => {
        formatSubjectForLatex(s);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('formatAddressForLatex never throws on long sentence input', () => {
    fc.assert(
      fc.property(adversarialSentence, (s) => {
        formatAddressForLatex(s);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

describe('textWrap.ts — sentence-level fuzz', () => {
  it('wrapTextForForm produces lines whose count is bounded by input length (no infinite-wrap)', () => {
    fc.assert(
      fc.property(adversarialSentence, fc.integer({ min: 4, max: 80 }), (s, max) => {
        const lines = wrapTextForForm(s, max, monoFont, 1);
        // Generous bound — a real bug (loop fails to advance) would
        // explode by orders of magnitude.
        if (lines.length > s.length + 100) {
          throw new Error(
            `Wrap explosion: ${lines.length} lines for ${s.length}-char input`
          );
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('wrapTextForForm preserves words on lorem-ipsum input', () => {
    fc.assert(
      fc.property(
        // Restrict to plain word sequences (no leading WS, no labels)
        // so the multiset equality is meaningful.
        fc.lorem({ maxCount: 30, mode: 'words' }),
        fc.integer({ min: 12, max: 60 }),
        (text, max) => {
          const lines = wrapTextForForm(text, max, monoFont, 1);
          const inputWords = text.split(/\s+/).filter((w) => w.length > 0);
          const outputWords = lines.join(' ').split(/\s+/).filter((w) => w.length > 0);
          if (outputWords.sort().join(',') !== inputWords.sort().join(',')) {
            throw new Error(
              `Word loss: input=${JSON.stringify(inputWords)}, output=${JSON.stringify(outputWords)}`
            );
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

describe('placeholders.ts — sentence-level fuzz', () => {
  it('detect/replace round-trip on lorem-ipsum with embedded {{NAME}}', () => {
    fc.assert(
      fc.property(
        fc.lorem({ maxCount: 30, mode: 'words' }),
        fc.stringMatching(/^[A-Z][A-Z0-9_]{0,15}$/),
        fc.string({ minLength: 0, maxLength: 30 }).filter((v) => !v.includes('{{')),
        (sentence, name, value) => {
          const text = `${sentence} {{${name}}} more text`;
          const out = replacePlaceholders(text, { [name]: value });
          // After replacement, the placeholder name shouldn't appear
          // as a token.
          if (detectPlaceholders(out).includes(name)) {
            throw new Error(`Placeholder ${name} survived replacement: ${out}`);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

describe('paragraphUtils.ts — sentence-level fuzz', () => {
  const paragraphArb = fc
    .array(
      fc.record({
        level: fc.integer({ min: 0, max: 7 }),
        text: fc.lorem({ maxCount: 12, mode: 'words' }),
      }),
      { minLength: 0, maxLength: 20 }
    );

  it('countWords never throws on lorem text', () => {
    fc.assert(
      fc.property(adversarialSentence, (s) => {
        countWords(s);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('calculateLabels produces one label per paragraph for any tree', () => {
    fc.assert(
      fc.property(paragraphArb, (paras: ParagraphLike[]) => {
        const labels = calculateLabels(paras);
        if (labels.length !== paras.length) {
          throw new Error(`Label count mismatch: ${labels.length} vs ${paras.length}`);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('paragraphsToPlainText never throws and contains every paragraph text', () => {
    fc.assert(
      fc.property(paragraphArb, (paras: ParagraphLike[]) => {
        const out = paragraphsToPlainText(paras);
        for (const p of paras) {
          if (p.text && p.text.trim() && !out.includes(p.text)) {
            throw new Error(`Paragraph text dropped: ${JSON.stringify(p.text)}`);
          }
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('getMaxDepth never throws and returns a level present in input', () => {
    fc.assert(
      fc.property(
        paragraphArb.filter((arr) => arr.length > 0),
        (paras: ParagraphLike[]) => {
          const max = getMaxDepth(paras);
          if (!paras.some((p) => p.level === max)) {
            throw new Error(`getMaxDepth returned ${max} but no paragraph has that level`);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

describe('unitAddress.ts — sentence-level fuzz', () => {
  it('compose(parse(s)) is a fixed-point on lorem-ipsum', () => {
    fc.assert(
      fc.property(adversarialSentence, (s) => {
        const once = composeUnitAddress(parseUnitAddress(s));
        const twice = composeUnitAddress(parseUnitAddress(once));
        if (twice !== once) {
          throw new Error(
            `Fixed-point violation: once=${JSON.stringify(once)}, twice=${JSON.stringify(twice)}`
          );
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

describe('variable-chip-editor-text.ts — sentence-level fuzz', () => {
  it('textToEditorHtml never throws on lorem multi-line input', () => {
    fc.assert(
      fc.property(adversarialSentence, (s) => {
        textToEditorHtml(s);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
