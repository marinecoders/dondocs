import { describe, expect, it } from 'vitest';
import { bodyTableText, bodyTableLiteral } from '@/services/latex/bodyTableText';
import { publicationReferenceText } from '@/services/latex/publicationReferenceText';

describe('safe table-cell wrapping', () => {
  it('keeps breaks outside escaped commands and preserves emphasis on each fallback glyph', () => {
    const value = bodyTableText('**ABC_DEF** __https://x.test/AB__');
    expect(value).toContain('\\textbf{ABC\\_DEF}');
    expect(value).toContain('\\dondocsTableGlyph{\\textbf{A}}\\allowbreak{}');
    expect(value).toContain('\\dondocsTableGlyph{\\uline{h}}');
    expect(value).not.toContain('textbf\\allowbreak');
    expect(bodyTableText('\\input{/private/file}')).toContain('\\textbackslash{}');
  });
  it('retains each explicit line break, including empty lines and Windows newlines', () => {
    expect(bodyTableText('First\n\nLast').match(/\\newline /g)).toHaveLength(2);
    expect(bodyTableLiteral('First\r\n\r\nLast').match(/\\newline /g)).toHaveLength(2);
  });
  it('preserves reference and placeholder semantics as explicitly checked atomic runs', () => {
    expect(bodyTableText('Reference (a) and Enclosure (12)')).toContain('\\dondocsTableAtomic{\\reflink{a}}');
    expect(bodyTableText('Enclosure (12)')).toContain('\\dondocsTableAtomic{\\enclref{12}}');
    expect(bodyTableText('{{NAME}}')).toContain('\\fcolorbox');
  });
  it('recognizes continued and legacy reference labels inside table-cell links', () => {
    const value = bodyTableText('Reference (AA), Ref (a0), and preference (ab)');
    expect(value).toContain('\\dondocsTableAtomic{\\reflink{aa}}');
    expect(value).toContain('\\dondocsTableAtomic{\\reflink{a0}}');
    expect(value).not.toContain('\\reflink{ab}');
  });
  it('preserves an I-Type hyperlink target while allowing only its visible label to wrap', () => {
    const value = publicationReferenceText('[Long identifier](https://example.test/synthetic_identifier)', [], false, (text, protectedTokens) => bodyTableText(text, [], 0, protectedTokens), bodyTableLiteral);
    expect(value).toContain('\\dondocsExternalLink{https://example.test/synthetic_identifier}');
    expect(value).toContain('\\dondocsTableWord{Long}');
    expect(value).not.toContain('ZZZPUBLICATIONLINK');
    expect(publicationReferenceText('Literal ZZZPUBLICATIONLINK0ZZZ', [], false, (text, protectedTokens) => bodyTableText(text, [], 0, protectedTokens), bodyTableLiteral)).toContain('ZZZPUBLICATIONLINK0ZZZ');
  });
});
