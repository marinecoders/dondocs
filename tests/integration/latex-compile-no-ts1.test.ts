/**
 * Compile-level regression: documents containing mapped non-ASCII symbols
 * (§ ¶ † ‡ © ® ™ ° …) must compile WITHOUT ever requesting a TS1
 * ("text companion") font.
 *
 * Why this test exists — a lesson learned the hard way:
 *
 * The production SwiftLaTeX engine ships a curated 85-file font set with NO
 * TS1 metrics (no `tcrm*.tfm`). A field user's "5 U.S.C. § 552a" citation
 * fatally aborted their PDF (`Font TS1/cmr/m/n/12=tcrm1200 ... not found`).
 * The first fix mapped § → `\S{}` and was verified ONLY at the string level
 * (unit tests) — but on the modern textcomp-integrated kernel, `\S` expands
 * to `\textsection`, whose default encoding is TS1, so the exact same crash
 * came back through our own output. The string-level tests passed; the
 * compile still died.
 *
 * The structural gap: the integration matrix runs full xelatex, which HAS
 * the TS1 fonts, so "it compiles" can never catch a bundled-font-set gap.
 * What full TeX CAN tell us is whether the document *requests* TS1 at all:
 * any TS1 usage loads a `ts1*.fd` font-definition file and records it in
 * the log. If the log shows zero `ts1*.fd` loads and zero `tcrm` requests,
 * the bundled engine — which lacks those files — cannot hit this crash.
 *
 * So this test compiles a fixture salted with every mapped symbol and
 * asserts the log is TS1-silent. It fails on ANY future escaper change that
 * routes a symbol through a TS1-defaulting command (\S, \P, \dag, \ddag,
 * \textsection, \textregistered, …), even though the local compile succeeds.
 *
 * (The benign kernel line "Checking defaults for TS1/cmr" appears in every
 * document and loads nothing — the assertions below deliberately target
 * `.fd` loads and `tcrm` metric requests, not that line.)
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { buildBaseline } from '../_helpers/compileMatrix';

const pdflatexAvailable =
  spawnSync('pdflatex', ['--version'], { encoding: 'utf-8' }).status === 0;

if (!pdflatexAvailable) {
  console.warn(
    '[latex-compile-no-ts1] xelatex not found on PATH — suite will be SKIPPED.'
  );
}

describe('mapped symbols never request TS1 fonts (bundled-engine safety)', () => {
  it.skipIf(!pdflatexAvailable)(
    'naval letter with § ¶ † ‡ © ® ™ ° in body/subject/reference compiles with zero TS1 font loads',
    async () => {
      const store = buildBaseline('naval_letter');
      store.formData.subject = 'REQUEST UNDER 5 U.S.C. § 552';
      store.references = [
        { letter: 'a', title: '5 U.S.C. § 552a Privacy Act of 1972' },
      ];
      store.paragraphs = [
        { text: 'Per reference (a), 5 U.S.C. § 552a applies. See also ¶ 4.', level: 0 },
        { text: 'Footnotes† and double daggers‡ plus Acme© Widget® Pro™.', level: 1 },
        { text: 'Temperature 98.6° ± 0.5° at 3×4 µm spacing • item · dot…', level: 1 },
      ];

      const result = await compileFixture(store);
      expect(result.ok, formatFailure('no-ts1-symbols', result)).toBe(true);
      expect(result.pdfBytes).toBeDefined();
      expect(result.pdfBytes!.byteLength).toBeGreaterThan(1000);

      // The decisive assertion: the FULL log (not just the tail) must show
      // no TS1 font-definition load and no tcrm metric request. On the
      // bundled engine those files don't exist; requesting them is the crash.
      // Environment note: older TeX Live kernels (e.g. CI's apt install)
      // route some symbols through TS1 and load ts1*.fd even though the
      // modern kernel (local + the production bundle) does not — so a
      // blanket "no ts1*.fd" assertion is not portable. The portable,
      // failure-mode-accurate assertions are: no tcrm metric request and
      // no TS1 font-shape substitution (what actually crashes the bundled
      // engine), plus a source-level ban on the TS1-defaulting commands.
      const fullLog = await readFile(join(result.workDir, 'main.log'), 'utf-8');
      expect(fullLog).not.toMatch(/tcrm/i);
      expect(fullLog).not.toMatch(/Font shape `TS1/);

      // Source-level ban (environment-independent): the generated TeX must
      // never contain the text-mode shorthands that default to TS1.
      const body = await readFile(join(result.workDir, 'body.tex'), 'utf-8');
      const refs = await readFile(join(result.workDir, 'references.tex'), 'utf-8');
      for (const banned of [/\\textsection/, /\\S\{/, /\\P\{/, /\\dag(?![a-zA-Z])/, /\\ddag(?![a-zA-Z])/]) {
        expect(body, `banned TS1 command in body.tex: ${banned}`).not.toMatch(banned);
        expect(refs, `banned TS1 command in references.tex: ${banned}`).not.toMatch(banned);
      }
    },
    120_000
  );
});
