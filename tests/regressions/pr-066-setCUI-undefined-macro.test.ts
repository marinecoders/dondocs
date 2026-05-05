/**
 * Regression: `\setCUI` was an undefined LaTeX control sequence.
 *
 * For every CUI document, `generateClassificationTex` emitted a bare
 * `\setCUI` line that no template defined anywhere. SwiftLaTeX in
 * production silently swallowed the unknown control sequence (so the
 * bug was invisible to users), but xelatex's strict mode rejects it
 * — surfaced by the integration compile matrix this PR added.
 *
 * The fix is in `src/services/latex/generator.ts`: the CUI branch now
 * emits `\setClassification{CUI}` (the canonical entry point that the
 * secret/top-secret branches already use; the template's
 * `\setClassification` macro detects the literal "CUI" arg and flips
 * `\CUIEnabledtrue`).
 *
 * This regression check works at the unit level (no TeX Live needed) so
 * it survives a future refactor of the integration harness.
 */
import { describe, it, expect } from 'vitest';
import { generateClassificationTex } from '@/services/latex/generator';

const cuiStore = {
  docType: 'naval_letter',
  formData: {
    classLevel: 'cui',
    cuiControlledBy: 'DOD',
    cuiCategory: 'PRVCY',
    cuiDissemination: 'FEDCON',
    cuiDistStatement: 'Distribution authorized to DoD and DoD contractors only.',
    pocEmail: 'cui.poc@usmc.mil',
  },
  references: [],
  enclosures: [],
  paragraphs: [],
  copyTos: [],
  distributions: [],
};

describe('PR #66 regression: `\\setCUI` undefined-macro fix', () => {
  it('CUI documents emit \\setClassification{CUI}, NOT bare \\setCUI', () => {
    const tex = generateClassificationTex(cuiStore);

    // The canonical macro must be present.
    expect(tex).toContain('\\setClassification{CUI}');

    // The broken bare macro must NOT be emitted. Match it as a token
    // (followed by whitespace or newline, not part of \setCUIControlledBy
    // etc. which DO legitimately exist).
    expect(tex).not.toMatch(/\\setCUI(?![A-Za-z])/);
  });

  it('the CUI* setter macros (which ARE defined) still pass through', () => {
    const tex = generateClassificationTex(cuiStore);
    // Sanity: the bug fix only removed the bare \setCUI line; the
    // suffixed setters that template main.tex DOES define remain.
    expect(tex).toContain('\\setCUIControlledBy{DOD}');
    expect(tex).toContain('\\setCUICategory{PRVCY}');
    expect(tex).toContain('\\setCUIDissemination{FEDCON}');
  });
});
