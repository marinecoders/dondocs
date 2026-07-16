/**
 * Rendered-output check for the "By direction" signature block.
 *
 * The unit regression (tests/regressions/by-direction-bare-form.test.ts)
 * asserts the generators emit the right LaTeX *source*. That passes even if a
 * template never renders the macro — `generator.ts` only calls
 * `\setByDirection{...}`; the per-doc-type templates are what actually print it
 * via `\optionalField{\ByDirection}`. This test closes that gap: it compiles a
 * real PDF and reads the signature block off the page, so dropping the
 * `\ByDirection` render site is caught rather than shipping a silently missing
 * signature line.
 *
 * Requires pdflatex + pdftotext; skipped (not falsely passed) without them.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileFixture } from '../_helpers/compileLatex';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

const toolchain = hasPdfToolchain;

function store(byDirectionAuthority: string) {
  return {
    docType: 'naval_letter',
    formData: {
      docType: 'naval_letter',
      fontSize: '12pt',
      fontFamily: 'times',
      pageNumbering: 'none',
      department: 'usmc',
      unitLine1: '1ST BATTALION, 6TH MARINES',
      unitLine2: '2D MARINE DIVISION, II MEF',
      unitAddress: 'PSC BOX 20123, CAMP LEJEUNE, NC 28542-0123',
      sealType: 'dow',
      letterheadColor: 'blue',
      ssic: '1000',
      serial: '0123',
      date: '15 Jan 25',
      from: 'Commanding Officer, 1st Battalion, 6th Marines',
      to: 'Commanding General, II MEF',
      subject: 'BY DIRECTION RENDER CHECK',
      sigFirst: 'John',
      sigMiddle: 'A',
      sigLast: 'DOE',
      sigRank: 'Lieutenant Colonel',
      sigTitle: 'Commanding Officer',
      classLevel: 'unclassified',
      byDirection: true,
      byDirectionAuthority,
    },
    references: [],
    enclosures: [],
    paragraphs: [{ text: 'Render check.', level: 0 }],
    copyTos: [],
    distributions: [],
  } as never;
}

/** Compile the fixture and return the text pdftotext reads off the page. */
async function renderedText(authority: string): Promise<string> {
  const result = await compileFixture(store(authority));
  expect(result.ok, `pdflatex failed; work dir: ${result.workDir}`).toBe(true);
  const dir = await mkdtemp(join(tmpdir(), 'dondocs-bd-'));
  const pdfPath = join(dir, 'out.pdf');
  await writeFile(pdfPath, result.pdfBytes!);
  const { stdout } = spawnSync('pdftotext', [pdfPath, '-'], { encoding: 'utf-8' });
  // A blank extraction would make the assertions below vacuous.
  expect(stdout.trim().length).toBeGreaterThan(0);
  return stdout;
}

describe('by-direction signature — rendered PDF', () => {
  describeToolchainRequirement('by-direction-render');

  it.skipIf(!toolchain)('prints a bare "By direction" when no authority is named', async () => {
    const text = await renderedText('');
    expect(text).toMatch(/By direction/);
    expect(text).not.toMatch(/By direction of/);
  });

  it.skipIf(!toolchain)('prints the long form when an authority is named', async () => {
    expect(await renderedText('the Commanding Officer')).toMatch(
      /By direction of the Commanding Officer/
    );
  });
});
