/**
 * The ordering invariant in the DOCX escaping pass.
 *
 * `flat-generator` has three escapers and they all face the same hazard: a
 * replacement that INTRODUCES `{ }` must run after the `{ }` escaping, or its
 * own braces get escaped along with the user's. `escapeFlat` and `escapeTabular`
 * defer theirs behind sentinels; `processText` did not, so `\` became
 * `\textbackslash\{\}` and pandoc rendered it as a literal `\{}`.
 *
 * These are source-level assertions, which is the exception rather than the
 * rule here — the rendered round-trip lives in
 * `tests/integration/latex-compile-backslash.test.ts`. Their value is speed and
 * a precise failure message: they need no LaTeX or pandoc toolchain, so a
 * reordering regression fails in the unit suite instead of a skipped one.
 */
import { describe, it, expect } from 'vitest';
import { generateFlatLatex } from '@/services/latex/flat-generator';

function latexFor(fields: { body?: string; enclosure?: string; reference?: string }): string {
  return generateFlatLatex({
    docType: 'naval_letter',
    formData: {
      docType: 'naval_letter', fontSize: '12pt', fontFamily: 'times',
      pageNumbering: 'none', department: 'usmc',
      unitLine1: 'UNIT', unitAddress: 'ADDRESS', sealType: 'dow', letterheadColor: 'blue',
      ssic: '5216', serial: '271', date: '7 Sep 06',
      from: 'CO', to: 'CG', subject: 'SUBJECT',
      sigFirst: 'J', sigLast: 'DOE', sigRank: 'LtCol', classLevel: 'unclassified',
    },
    references: fields.reference ? [{ letter: 'a', title: fields.reference }] : [],
    enclosures: fields.enclosure ? [{ title: fields.enclosure }] : [],
    paragraphs: [{ text: fields.body ?? 'Body.', level: 0 }],
    copyTos: [], distributions: [],
  } as never);
}

/** The broken form: `\textbackslash` whose own braces got escaped after the fact. */
const RE_ESCAPED = '\\textbackslash\\{\\}';

describe('backslash escaping in the DOCX generator', () => {
  it('emits \\textbackslash{} for body text, with its braces intact', () => {
    const tex = latexFor({ body: 'See C:\\win\\path now.' });
    expect(tex).toContain('C:\\textbackslash{}win\\textbackslash{}path');
    expect(tex).not.toContain(RE_ESCAPED);
  });

  it('never emits the re-escaped form from any field', () => {
    const tex = latexFor({
      body: 'Body C:\\a\\b', enclosure: 'Encl C:\\c\\d', reference: 'Ref C:\\e\\f',
    });
    expect(tex).not.toContain(RE_ESCAPED);
  });

  it('leaves the other brace-introducing replacements intact too', () => {
    // `~` and `^` happened to be ordered correctly before; they are pinned so a
    // future reorder cannot break them the way `\` was broken.
    const tex = latexFor({ body: 'a~b and c^d' });
    expect(tex).toContain('\\textasciitilde{}');
    expect(tex).toContain('\\textasciicircum{}');
    expect(tex).not.toContain('\\textasciitilde\\{\\}');
    expect(tex).not.toContain('\\textasciicircum\\{\\}');
  });

  it('still escapes braces the user actually typed', () => {
    // The fix must not stop escaping real braces — that is what the ordering
    // step exists for.
    expect(latexFor({ body: 'Use {braces} here' })).toContain('\\{braces\\}');
  });

  it('leaves a lone underscore alone for the underline marker', () => {
    // `__text__` is consumed by the rich-text pass, so `_` is deliberately not
    // escaped in body text. Pinned because the reorder touched this function.
    const tex = latexFor({ body: 'The __deadline__ is firm.' });
    expect(tex).toContain('\\uline{deadline}');
  });
});
