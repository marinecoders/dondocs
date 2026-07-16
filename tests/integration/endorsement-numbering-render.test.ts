/**
 * Endorsement bodies are numbered, proved against a compiled PDF.
 *
 * The unit regression (tests/regressions/endorsement-numbered-paragraphs.test.ts)
 * asserts on LaTeX source, which is the wrong tier of proof for the most
 * user-visible change on this branch: source assertions pass even when the
 * template never renders the label. This reads the numbers off the page.
 *
 * The rule is Ch 7 ¶13a ("Identify all paragraphs or subparagraphs with a
 * number or letter"), to which Ch 9 states no exception. Fig 9-1 numbers a
 * single-paragraph body; Fig 9-2 numbers "1." and "2.".
 *
 * Requires pdflatex + pdftotext; fails rather than skips in CI.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileFixture } from '../_helpers/compileLatex';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

const toolchain = hasPdfToolchain;

async function renderEndorsement(paragraphs: { text: string; level: number }[]): Promise<string> {
  const result = await compileFixture({
    docType: 'same_page_endorsement',
    formData: {
      docType: 'same_page_endorsement',
      fontSize: '12pt',
      fontFamily: 'times',
      pageNumbering: 'none',
      department: 'usmc',
      classLevel: 'unclassified',
      from: 'Commander, Sea Based Anti-Submarine Warfare Wing, Atlantic',
      to: 'Commander, Fleet Forces Command',
      subject: 'HOW TO PREPARE AN ENDORSEMENT',
      basicLetterId: 'NAS Meridian ltr 5216 Ser 11/273 of 22 Apr 15',
      endorsementOrdinal: 'FIRST',
      sigFirst: 'Robert',
      sigLast: 'GABEL',
    },
    references: [],
    enclosures: [],
    paragraphs,
    copyTos: [],
    distributions: [],
  } as never);

  expect(result.ok, `pdflatex failed; work dir: ${result.workDir}`).toBe(true);
  const dir = await mkdtemp(join(tmpdir(), 'dondocs-endnum-'));
  const pdfPath = join(dir, 'out.pdf');
  await writeFile(pdfPath, result.pdfBytes!);
  const { stdout } = spawnSync('pdftotext', [pdfPath, '-'], { encoding: 'utf-8' });
  // A blank extraction would make the assertions below vacuous.
  expect(stdout.trim().length).toBeGreaterThan(0);
  return stdout;
}

describe('endorsement paragraph numbering — rendered PDF', () => {
  describeToolchainRequirement('endorsement-numbering-render');

  it.skipIf(!toolchain)('numbers a multi-paragraph body (Fig 9-2)', async () => {
    const text = await renderEndorsement([
      { text: 'Start an endorsement on a new page.', level: 0 },
      { text: 'Every new-page endorsement must repeat the basic letter subject.', level: 0 },
    ]);
    expect(text).toMatch(/1\.\s+Start an endorsement on a new page\./);
    expect(text).toMatch(/2\.\s+Every new-page endorsement must repeat/);
  });

  // Fig 9-1's body is a single paragraph and is still numbered "1." — the
  // lone-item exception Ch 9 grants Via addressees does not reach paragraphs.
  it.skipIf(!toolchain)('numbers a solitary paragraph (Fig 9-1)', async () => {
    const text = await renderEndorsement([
      { text: 'Forwarded, recommending approval.', level: 0 },
    ]);
    expect(text).toMatch(/1\.\s+Forwarded, recommending approval\./);
  });
});
