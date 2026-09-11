/**
 * A reference letter reaches the .tex through both generators. It is placed
 * inside a macro argument, so it must be escaped like every other field.
 */
import { describe, it, expect } from 'vitest';
import { generateAllLatexFiles } from '../../src/services/latex/generator';
import { generateFlatLatex } from '../../src/services/latex/flat-generator';
import { buildBaseline } from '../_helpers/compileMatrix';

const HOSTILE = 'a}\\input{/etc/passwd}{';

function storeWith(letter: string) {
  const store = buildBaseline('naval_letter');
  store.references = [{ letter, title: 'A reference', url: '' }];
  return store;
}

describe('a reference letter is escaped', () => {
  it('in the pdf generator', () => {
    const tex = Object.values(generateAllLatexFiles(storeWith(HOSTILE) as never).texFiles).join('\n');
    expect(tex).not.toContain('\\input{/etc/passwd}');
    expect(tex).toContain('\\textbackslash');
  });

  it('in the docx generator', () => {
    const tex = generateFlatLatex(storeWith(HOSTILE) as never);
    expect(tex).not.toContain('\\input{/etc/passwd}');
    expect(tex).toContain('\\textbackslash');
  });
});
