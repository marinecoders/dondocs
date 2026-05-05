/**
 * Regression: `\setInReplyReferTo{...}` was an undefined LaTeX
 * control sequence.
 *
 * Whenever `inReplyTo` was enabled, `generateDocumentTex` emitted both
 *   \enableInReplyReferTo
 *   \setInReplyReferTo{<inReplyToText>}
 * The first IS defined in `tex/main.tex` (it flips an `\if`-style
 * boolean). The second was not defined anywhere — the value was always
 * silently dropped. Templates use only the boolean (`\ifInReplyEnabled`
 * → render the static "IN REPLY REFER TO" header line); the
 * `inReplyToText` data field is not currently rendered anywhere
 * (separate UX concern).
 *
 * SwiftLaTeX in production tolerated the unknown control sequence;
 * xelatex's strict mode rejected it. Caught by the integration
 * compile matrix this PR added.
 *
 * Fix: removed the broken `\setInReplyReferTo{...}` line from
 * `src/services/latex/generator.ts`. The boolean toggle behavior is
 * preserved.
 */
import { describe, it, expect } from 'vitest';
import { generateDocumentTex } from '@/services/latex/generator';

function fixture(overrides: { inReplyTo: boolean; inReplyToText?: string }) {
  return {
    docType: 'naval_letter',
    formData: {
      docType: 'naval_letter',
      fontSize: '12pt',
      fontFamily: 'times',
      pageNumbering: 'none',
      department: 'usmc',
      unitLine1: '1ST BN, 6TH MARINES',
      unitLine2: '2D MARDIV, II MEF',
      unitAddress: 'PSC BOX 20123, CAMP LEJEUNE, NC 28542-0123',
      sealType: 'dow',
      letterheadColor: 'blue' as const,
      ssic: '1000',
      serial: '0123',
      date: '15 Jan 26',
      from: 'CO, 1st Bn, 6th Mar',
      to: 'CG, II MEF',
      subject: 'TEST',
      sigFirst: 'J',
      sigLast: 'DOE',
      sigRank: 'LtCol',
      sigTitle: 'CO',
      classLevel: 'unclassified',
      ...overrides,
    },
    references: [],
    enclosures: [],
    paragraphs: [],
    copyTos: [],
    distributions: [],
  };
}

describe('PR #66 regression: `\\setInReplyReferTo` undefined-macro fix', () => {
  it('inReplyTo=true emits \\enableInReplyReferTo and NOT the broken \\setInReplyReferTo', () => {
    const tex = generateDocumentTex(
      fixture({ inReplyTo: true, inReplyToText: '1000 Ser N00/12345 of 1 Jan 26' })
    );

    // The boolean toggle (defined in main.tex) survives.
    expect(tex).toContain('\\enableInReplyReferTo');

    // The broken setter must NOT be emitted in any form.
    expect(tex).not.toContain('\\setInReplyReferTo');
  });

  it('inReplyTo=false suppresses the toggle entirely', () => {
    const tex = generateDocumentTex(fixture({ inReplyTo: false }));
    expect(tex).not.toContain('\\enableInReplyReferTo');
    expect(tex).not.toContain('\\setInReplyReferTo');
  });
});
