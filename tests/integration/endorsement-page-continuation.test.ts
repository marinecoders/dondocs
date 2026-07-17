/**
 * An endorsement's pages continue the basic letter's sequence, proved on a
 * compiled PDF. Ch 9, Fig 9-2 body: "Number each page of your endorsement and
 * continue the sequence of numbers from the previous endorsement or from the
 * basic letter if you are the first endorser" — and the figure prints the
 * number ("2") on the endorsement's own sheet, so a continued first sheet is
 * NOT suppressed the way a document's true page 1 is.
 *
 * Before this, "First page number" was a dead field in PDF export: the
 * generator never emitted it and main.tex had no counter to receive it.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileFixture } from '../_helpers/compileLatex';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

const toolchain = hasPdfToolchain;

const store = (startingPageNumber?: number) =>
  ({
    docType: 'new_page_endorsement',
    formData: {
      docType: 'new_page_endorsement',
      fontSize: '12pt',
      fontFamily: 'times',
      pageNumbering: 'simple',
      ...(startingPageNumber ? { startingPageNumber } : {}),
      department: 'usmc',
      unitLine1: '1ST BATTALION, 6TH MARINES',
      unitLine2: '2D MARINE DIVISION, II MEF',
      unitAddress: 'PSC BOX 20123, CAMP LEJEUNE, NC 28542-0123',
      sealType: 'dow',
      letterheadColor: 'blue',
      ssic: '5216',
      serial: '0456',
      date: '20 Jan 25',
      from: 'Commanding Officer, 1st Battalion, 6th Marines',
      to: 'Commanding General, 2d Marine Division',
      subject: 'PAGE CONTINUATION RENDER CHECK',
      basicLetterId: 'NAS Meridian ltr 5216 Ser 11/273 of 22 Apr 15',
      endorsementOrdinal: 'FIRST',
      sigFirst: 'Robert',
      sigLast: 'GABEL',
      classLevel: 'unclassified',
    },
    references: [],
    enclosures: [],
    paragraphs: [{ text: 'Forwarded, recommending approval.', level: 0 }],
    copyTos: [],
    distributions: [],
  }) as never;

async function renderPages(startingPageNumber?: number): Promise<string[]> {
  const result = await compileFixture(store(startingPageNumber));
  expect(result.ok, `pdflatex failed; work dir: ${result.workDir}`).toBe(true);
  const dir = await mkdtemp(join(tmpdir(), 'dondocs-pagecont-'));
  const pdfPath = join(dir, 'out.pdf');
  await writeFile(pdfPath, result.pdfBytes!);
  const { stdout } = spawnSync('pdftotext', [pdfPath, '-'], { encoding: 'utf-8' });
  expect(stdout.trim().length).toBeGreaterThan(0);
  return stdout.split('\f');
}

describe('endorsement page continuation — rendered PDF', () => {
  describeToolchainRequirement('endorsement-page-continuation');

  it.skipIf(!toolchain)('a first page number of 4 prints "4" on the endorsement sheet', async () => {
    const pages = await renderPages(4);
    // One-sheet endorsement, its printed number continuing the letter's three.
    expect(pages[0]).toMatch(/\b4\b\s*$/m);
    expect(pages[0]).not.toMatch(/^\s*1\s*$/m);
  });

  it.skipIf(!toolchain)('without a continuation the sequence starts at 1', async () => {
    const pages = await renderPages(undefined);
    expect(pages[0]).not.toMatch(/\b4\b\s*$/m);
  });
});
