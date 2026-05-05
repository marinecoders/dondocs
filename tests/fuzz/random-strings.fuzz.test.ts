/**
 * Random-character fuzz across every string-taking exported function.
 *
 * Single contract: **none of these functions may throw on any string
 * input**. We don't assert anything about the output's semantic
 * correctness — that's what the property tests in `tests/unit/` are
 * for. Fuzz here is the safety net that catches "the user pasted
 * something the developer didn't anticipate" before it crashes a
 * download.
 *
 * Each function gets `numRuns: 200` adversarial inputs. With the
 * full surface listed below, that's ~6,000 random strings hitting
 * the production code paths per CI run.
 *
 * Adding a new function: drop it into the appropriate group's array.
 * No other test plumbing required.
 */
import { describe, it } from 'vitest';
import fc from 'fast-check';
import { adversarialString } from '../_helpers/fuzzArbitraries';

import {
  escapeLatex,
  escapeLatexUrl,
  processBodyText,
  convertRichTextToLatex,
  highlightPlaceholders,
  formatSubjectForLatex,
  formatAddressForLatex,
  wrapSubjectLine,
} from '@/services/latex/escaper';
import { wrapTextForForm } from '@/services/pdf/textWrap';
import {
  detectPlaceholders,
  replacePlaceholders,
} from '@/lib/placeholders';
import {
  countWords,
  getIndentString,
  isValidLevel,
  clampLevel,
  getParagraphLabel,
} from '@/lib/paragraphUtils';
import {
  parseUnitAddress,
  composeUnitAddress,
  canonicalizeUnitAddress,
  splitAddressForLetterhead,
} from '@/lib/unitAddress';
import {
  escapeLatex as escapeLatexLib,
  stripLatexFormatting,
} from '@/lib/encoding';
import {
  isClassificationAllowed,
  getDomainRestrictionMessage,
  getDomainClassificationRestriction,
  type ClassificationLevel,
} from '@/lib/domainClassification';
import { parseShareUrl, buildShareUrl } from '@/lib/shareCrypto';
import {
  lineToHtml,
  textToEditorHtml,
} from '@/components/ui/variable-chip-editor-text';
import { monoFont } from '../_helpers/monoFont';

const NUM_RUNS = 200;

/**
 * Helper: assert that fn(input) never throws on adversarial strings.
 * Wraps fc.assert + fc.property in one call so each function is one
 * line, easy to scan.
 */
function fuzzNoThrow(name: string, fn: (input: string) => unknown, runs = NUM_RUNS) {
  it(`${name} never throws on adversarial strings`, () => {
    fc.assert(
      fc.property(adversarialString, (s) => {
        fn(s);
      }),
      { numRuns: runs }
    );
  });
}

describe('escaper.ts — fuzz no-throw', () => {
  fuzzNoThrow('escapeLatex', (s) => escapeLatex(s));
  fuzzNoThrow('escapeLatexUrl', (s) => escapeLatexUrl(s));
  fuzzNoThrow('processBodyText', (s) => processBodyText(s));
  fuzzNoThrow('convertRichTextToLatex', (s) => convertRichTextToLatex(s));
  fuzzNoThrow('highlightPlaceholders', (s) => highlightPlaceholders(s));
  fuzzNoThrow('formatSubjectForLatex', (s) => formatSubjectForLatex(s));
  fuzzNoThrow('formatAddressForLatex', (s) => formatAddressForLatex(s));
  fuzzNoThrow('wrapSubjectLine (default 57)', (s) => wrapSubjectLine(s));

  it('wrapSubjectLine never throws across (string, integer maxLength)', () => {
    fc.assert(
      fc.property(adversarialString, fc.integer({ min: 1, max: 200 }), (s, max) => {
        wrapSubjectLine(s, max);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

describe('textWrap.ts — fuzz no-throw', () => {
  it('wrapTextForForm never throws across (string, maxWidth)', () => {
    fc.assert(
      fc.property(adversarialString, fc.integer({ min: 1, max: 200 }), (s, max) => {
        wrapTextForForm(s, max, monoFont, 1);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

describe('placeholders.ts — fuzz no-throw', () => {
  fuzzNoThrow('detectPlaceholders', (s) => detectPlaceholders(s));

  it('replacePlaceholders never throws across (string, valuesMap)', () => {
    fc.assert(
      fc.property(
        adversarialString,
        fc.dictionary(fc.string(), adversarialString),
        (text, values) => {
          replacePlaceholders(text, values);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

describe('paragraphUtils.ts — fuzz no-throw', () => {
  fuzzNoThrow('countWords', (s) => countWords(s));

  it('getIndentString never throws across (level, spaces)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10, max: 100 }),
        fc.integer({ min: -5, max: 16 }),
        (level, spaces) => {
          getIndentString(level, spaces);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it('isValidLevel / clampLevel never throw across all integers', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        isValidLevel(n);
        clampLevel(n);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('getParagraphLabel never throws across (level, count)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 1, max: 100 }),
        (level, count) => {
          getParagraphLabel(level, count);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

describe('unitAddress.ts — fuzz no-throw', () => {
  fuzzNoThrow('parseUnitAddress', (s) => parseUnitAddress(s));
  fuzzNoThrow('canonicalizeUnitAddress', (s) => canonicalizeUnitAddress(s));
  fuzzNoThrow('splitAddressForLetterhead', (s) => splitAddressForLetterhead(s));

  // composeUnitAddress takes UnitAddressParts, not a string — fuzz the
  // parts shape.
  it('composeUnitAddress never throws on adversarial parts', () => {
    fc.assert(
      fc.property(
        fc.record({
          street: adversarialString,
          city: adversarialString,
          state: adversarialString,
          zip: adversarialString,
        }),
        (parts) => {
          composeUnitAddress(parts);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

describe('encoding.ts — fuzz no-throw', () => {
  fuzzNoThrow('escapeLatex (lib)', (s) => escapeLatexLib(s));
  fuzzNoThrow('stripLatexFormatting', (s) => stripLatexFormatting(s));
});

describe('domainClassification.ts — fuzz no-throw', () => {
  fuzzNoThrow('getDomainClassificationRestriction', (s) => getDomainClassificationRestriction(s));
  fuzzNoThrow('getDomainRestrictionMessage', (s) => getDomainRestrictionMessage(s));

  it('isClassificationAllowed never throws across (level, domain)', () => {
    const levels: ClassificationLevel[] = [
      'unclassified',
      'cui',
      'confidential',
      'secret',
      'top_secret',
      'top_secret_sci',
    ];
    fc.assert(
      fc.property(fc.constantFrom(...levels), adversarialString, (level, domain) => {
        isClassificationAllowed(level, domain);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

describe('shareCrypto.ts — fuzz no-throw (parsing only — encrypt/decrypt are async + slow)', () => {
  fuzzNoThrow('parseShareUrl', (s) => parseShareUrl(s));
  fuzzNoThrow('buildShareUrl', (s) => buildShareUrl(s));
});

describe('variable-chip-editor-text.ts — fuzz no-throw', () => {
  fuzzNoThrow('lineToHtml', (s) => lineToHtml(s));
  fuzzNoThrow('textToEditorHtml', (s) => textToEditorHtml(s));
});
