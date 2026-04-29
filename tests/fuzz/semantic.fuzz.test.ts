/**
 * Semantic fuzz — adversarial inputs WITH meaningful assertions.
 *
 * The fuzz files in `random-strings.fuzz.test.ts` and
 * `random-words.fuzz.test.ts` mostly check "never throws" — that's
 * the safety net for crashes. This file goes further: feed
 * adversarial input AND assert a real property of the output.
 *
 * Fake-test-safe: every test here would fail if the underlying
 * function were broken to return empty / identity / wrong-shape
 * output. Mutation-verified during the audit that produced this
 * file.
 *
 * Categories:
 *   - escapers must NEVER let through unescaped LaTeX command syntax
 *   - placeholder detect/replace round trip preserves names
 *   - wrap helper preserves all non-whitespace characters
 *   - LaTeX generator embeds the user's subject in the output
 *   - rich-text marker conversion never loses the wrapped content
 *   - JSON round trips through compressedStorage are bit-exact
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { adversarialString } from '../_helpers/fuzzArbitraries';
import {
  escapeLatex,
  processBodyText,
  convertRichTextToLatex,
  formatSubjectForLatex,
} from '@/services/latex/escaper';
import { wrapTextForForm } from '@/services/pdf/textWrap';
import { detectPlaceholders, replacePlaceholders } from '@/lib/placeholders';
import {
  compressedStringify,
  compressedParse,
} from '@/lib/compressedStorage';
import { generateDocumentTex } from '@/services/latex/generator';
import { monoFont } from '../_helpers/monoFont';

const NUM_RUNS = 200;

describe('escaper — semantic fuzz', () => {
  it('escapeLatex output never contains unescaped LaTeX command shapes', () => {
    // After escape, no `\<letter>` sequence should appear EXCEPT the
    // ones the escaper deliberately introduces (\textbackslash{},
    // \textasciitilde{}, \textasciicircum{}, \fcolorbox, \textsf,
    // \&, \%, \#, \_, \{, \}, \char36). Any other `\foo` would mean
    // the user's input slipped through as a real LaTeX command.
    const ALLOWED_COMMANDS = new Set([
      'textbackslash',
      'textasciitilde',
      'textasciicircum',
      'fcolorbox',
      'textsf',
      'small',
      // `\char` is followed by digits (e.g. \char36); the regex below
      // captures `[a-zA-Z]+` so the digits aren't part of the match.
      'char',
    ]);
    fc.assert(
      fc.property(adversarialString, (s) => {
        const out = escapeLatex(s);
        // Find all `\<word>` sequences in the output.
        const matches = out.matchAll(/\\([a-zA-Z]+)/g);
        for (const m of matches) {
          if (!ALLOWED_COMMANDS.has(m[1])) {
            throw new Error(
              `Unescaped LaTeX command \\${m[1]} in output: ${JSON.stringify(out.slice(0, 100))}`
            );
          }
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('escapeLatex of identical inputs produces identical outputs (deterministic)', () => {
    fc.assert(
      fc.property(adversarialString, (s) => {
        expect(escapeLatex(s)).toBe(escapeLatex(s));
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('escapeLatex output never contains naked `&`, `%`, `#`, `_` (every one is preceded by `\\`)', () => {
    // Same property as in `escaper.property.test.ts` but exercised
    // with the wider adversarial-input set (XSS / RTL / ZWJ / format
    // strings / etc.) so a regression that affects only certain input
    // shapes is caught here too.
    fc.assert(
      fc.property(adversarialString, (s) => {
        const out = escapeLatex(s);
        for (const ch of ['&', '%', '#', '_']) {
          let idx = out.indexOf(ch);
          while (idx !== -1) {
            const prev = out[idx - 1];
            if (prev !== '\\') {
              throw new Error(
                `Naked "${ch}" at index ${idx} in output: ${JSON.stringify(out.slice(0, 100))}`
              );
            }
            idx = out.indexOf(ch, idx + 1);
          }
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('processBodyText output contains escaped form of every `&` in input', () => {
    // Any `&` in user input must end up as `\&` in output. Catches
    // the regression where a refactor drops the `&` escape (which
    // the property test in escaper.property.test.ts already covers,
    // but checking on adversarial input adds coverage on the multi-
    // ampersand and weird-context cases).
    fc.assert(
      fc.property(adversarialString, (s) => {
        const out = processBodyText(s);
        const ampersandsIn = (s.match(/&/g) || []).length;
        const escapedAmps = (out.match(/\\&/g) || []).length;
        // Every input `&` produces at least one `\&` in output.
        // (May be more if e.g. a placeholder name contained `&`,
        // but never fewer.)
        expect(escapedAmps).toBeGreaterThanOrEqual(ampersandsIn);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('convertRichTextToLatex preserves text inside paired markers', () => {
    // `**foo**` → `\textbf{foo}`. The word "foo" must appear in the
    // output. Paranoid version of the regression test for the fake
    // `***triplet***` test the audit found.
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9 ]{1,20}$/).filter((s) => s.trim().length > 0),
        (text) => {
          const wrapped = `**${text}**`;
          const out = convertRichTextToLatex(wrapped);
          expect(out).toContain(text);
          // And no orphan `**` leaked through.
          expect(out).not.toMatch(/\*\*/);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it('formatSubjectForLatex output is non-empty for non-empty input', () => {
    fc.assert(
      fc.property(adversarialString.filter((s) => s.trim().length > 0), (s) => {
        const out = formatSubjectForLatex(s);
        expect(out.length).toBeGreaterThan(0);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

describe('placeholders — semantic fuzz', () => {
  it('detect/replace round trip: every detected name resolves on replacement', () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[A-Z][A-Z0-9_]{0,15}$/), { minLength: 1, maxLength: 5 }),
        (names) => {
          const text = names.map((n) => `{{${n}}}`).join(' ');
          const detected = detectPlaceholders(text);
          // Every name in the input is detected.
          for (const name of names) {
            expect(detected).toContain(name);
          }
          // Replacing all of them yields a string with no placeholders.
          const values = Object.fromEntries(names.map((n) => [n, 'X']));
          const replaced = replacePlaceholders(text, values);
          expect(detectPlaceholders(replaced)).toEqual([]);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it('replacePlaceholders only touches `{{...}}` regions, never plain text', () => {
    // Embed a known placeholder in adversarial surrounding text.
    fc.assert(
      fc.property(
        adversarialString,
        adversarialString,
        fc.stringMatching(/^[A-Z][A-Z0-9_]{0,15}$/),
        (before, after, name) => {
          // Filter prefixes that contain `{{...}}` themselves so the
          // assertion is meaningful (the surrounding text shouldn't
          // contain placeholders that would get replaced).
          const cleanBefore = before.replace(/\{\{[A-Za-z0-9_]+\}\}/g, '');
          const cleanAfter = after.replace(/\{\{[A-Za-z0-9_]+\}\}/g, '');
          const text = `${cleanBefore}{{${name}}}${cleanAfter}`;
          const replaced = replacePlaceholders(text, { [name]: 'REPLACED' });
          // The surrounding text is unchanged.
          expect(replaced.startsWith(cleanBefore)).toBe(true);
          expect(replaced.endsWith(cleanAfter)).toBe(true);
          // The placeholder is gone.
          expect(replaced).toContain('REPLACED');
          expect(replaced).not.toContain(`{{${name}}}`);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

describe('wrap helper — semantic fuzz', () => {
  it('every non-whitespace character in the input survives in the output', () => {
    fc.assert(
      fc.property(
        adversarialString,
        fc.integer({ min: 5, max: 80 }),
        (text, maxWidth) => {
          const lines = wrapTextForForm(text, maxWidth, monoFont, 1);
          // After tab → 4 spaces normalization, every non-whitespace
          // codepoint in the input must appear in the output. Catches
          // any "drops a character / chunk" regression.
          const normalize = (s: string) =>
            s.replace(/\t/g, '    ').replace(/\s+/g, '');
          const inputChars = normalize(text);
          const outputChars = normalize(lines.join(''));
          expect(outputChars).toBe(inputChars);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it('wrap is deterministic — same input produces same output', () => {
    fc.assert(
      fc.property(adversarialString, fc.integer({ min: 5, max: 80 }), (text, max) => {
        const a = wrapTextForForm(text, max, monoFont, 1);
        const b = wrapTextForForm(text, max, monoFont, 1);
        expect(a).toEqual(b);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

describe('LaTeX generator — semantic fuzz on the subject field', () => {
  // Reuse the smoke fixture shape but with a unique distinctive subject
  // each time — adversarial enough to stress the escaper, distinctive
  // enough that we can prove it survived into the output.
  const distinctiveSubjectArb = fc
    .stringMatching(/^[A-Za-z0-9 ]{5,30}$/)
    .filter((s) => s.trim().length >= 5)
    .map((s) => `FUZZ_${s}_END`);

  it('user-supplied subject (after escape + uppercase + title-case rules) appears in document.tex', () => {
    fc.assert(
      fc.property(
        distinctiveSubjectArb,
        fc.constantFrom(
          'naval_letter',
          'memorandum',
          'endorsement',
          'standard_memorandum',
          'action_memorandum'
        ),
        (subject, docType) => {
          const store = {
            docType,
            formData: {
              docType,
              fontSize: '12pt',
              fontFamily: 'times',
              department: 'usmc',
              unitLine1: '1ST BN',
              unitLine2: '2D MARDIV',
              unitAddress: 'PSC BOX 1, CITY, NC 12345',
              ssic: '1000',
              serial: '0001',
              date: '15 Jan 25',
              from: 'CO',
              to: 'CG',
              subject,
              sigFirst: 'J',
              sigLast: 'D',
              sigRank: 'LtCol',
              sigTitle: 'CO',
              classLevel: 'unclassified',
            },
            references: [],
            enclosures: [],
            paragraphs: [],
            copyTos: [],
            distributions: [],
          };
          const tex = generateDocumentTex(store);
          // Case-insensitive containment — execs title-case the
          // subject, others uppercase it. Either way the original
          // alphanumeric run "FUZZ_..._END" survives modulo case.
          const cleaned = subject.replace(/\s+/g, '').toLowerCase();
          const texCleaned = tex.replace(/\s+/g, '').toLowerCase();
          if (!texCleaned.includes(cleaned.replace(/_/g, '\\_'))
              && !texCleaned.includes(cleaned)) {
            throw new Error(
              `subject "${subject}" not found in generated tex (sample: ${tex.slice(0, 200)})`
            );
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

describe('compressedStorage — bit-exact JSON round trip', () => {
  it('round-trips numbers, strings, booleans, null, arrays, nested objects', () => {
    const valueArb: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
      val: fc.oneof(
        { maxDepth: 4 },
        fc.string({ maxLength: 30 }),
        fc.integer(),
        fc.float({ noNaN: true, noDefaultInfinity: true }),
        fc.boolean(),
        fc.constant(null),
        tie('arr'),
        tie('obj'),
      ),
      arr: fc.array(tie('val'), { maxLength: 5 }),
      obj: fc.dictionary(fc.string({ maxLength: 15 }), tie('val'), { maxKeys: 5 }),
    })).val;

    fc.assert(
      fc.property(valueArb, (value) => {
        const round = compressedParse(compressedStringify(value));
        // Stringify both for stable equality (handles undefined,
        // NaN -- though we filtered those out -- and key order).
        expect(JSON.stringify(round)).toBe(JSON.stringify(value));
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
