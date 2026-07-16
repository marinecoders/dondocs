/**
 * Rendered-output check for endorsement sequence continuation (Ch 9 ¶3).
 *
 * The unit tests cover the pure offset helpers; this proves the offsets survive
 * all the way onto the page — the reference line prints "(g)" and the enclosure
 * line prints "(2)" rather than restarting at (a)/(1). Compiles a real PDF and
 * reads it back, so a generator that ignores the start value is caught.
 *
 * Requires pdflatex + pdftotext; skipped (not falsely passed) without them.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileFixture } from '../_helpers/compileLatex';

const toolchain =
  spawnSync('pdflatex', ['--version'], { encoding: 'utf-8' }).status === 0 &&
  spawnSync('pdftotext', ['-v'], { encoding: 'utf-8' }).status === 0;

if (!toolchain) {
  console.warn('[endorsement-continuation-render] pdflatex/pdftotext missing — SKIPPING.');
}

/** A same-page endorsement carrying one reference and one enclosure. */
function store(opts: {
  docType?: string;
  startingReferenceLetter?: string;
  startingEnclosureNumber?: number;
}) {
  const docType = opts.docType ?? 'same_page_endorsement';
  return {
    docType,
    formData: {
      docType,
      fontSize: '12pt',
      fontFamily: 'times',
      pageNumbering: 'none',
      department: 'usmc',
      unitLine1: '1ST BATTALION, 6TH MARINES',
      unitAddress: 'PSC BOX 20123, CAMP LEJEUNE, NC 28542-0123',
      sealType: 'dow',
      letterheadColor: 'blue',
      ssic: '1000',
      date: '15 Jan 25',
      from: 'Commanding Officer, 1st Battalion, 6th Marines',
      to: 'Commanding General, II MEF',
      subject: 'CONTINUATION RENDER CHECK',
      endorsementOrdinal: 'FIRST',
      basicLetterId: 'CG II MEF ltr 1000 Ser 01/23 of 1 Jan 25',
      sigFirst: 'John',
      sigLast: 'DOE',
      classLevel: 'unclassified',
      startingReferenceLetter: opts.startingReferenceLetter,
      startingEnclosureNumber: opts.startingEnclosureNumber,
    },
    // The letter the store would have derived for a start of (g).
    references: [{ letter: opts.startingReferenceLetter === 'g' ? 'g' : 'a', title: 'MCO 1500.52', url: '' }],
    enclosures: [{ title: 'Training Record' }],
    paragraphs: [{ text: 'Forwarded, concurring.', level: 0 }],
    copyTos: [],
    distributions: [],
  } as never;
}

async function renderedText(s: ReturnType<typeof store>): Promise<string> {
  const result = await compileFixture(s);
  expect(result.ok, `pdflatex failed; work dir: ${result.workDir}`).toBe(true);
  const dir = await mkdtemp(join(tmpdir(), 'dondocs-cont-'));
  const pdfPath = join(dir, 'out.pdf');
  await writeFile(pdfPath, result.pdfBytes!);
  const { stdout } = spawnSync('pdftotext', [pdfPath, '-'], { encoding: 'utf-8' });
  expect(stdout.trim().length).toBeGreaterThan(0);
  return stdout;
}

describe('endorsement continuation — rendered PDF', () => {
  it.skipIf(!toolchain)('continues the reference lettering and enclosure numbering', async () => {
    const text = await renderedText(
      store({ startingReferenceLetter: 'g', startingEnclosureNumber: 2 })
    );
    expect(text).toMatch(/\(g\)\s*MCO 1500\.52/);
    expect(text).toMatch(/\(2\)\s*Training Record/);
  });

  it.skipIf(!toolchain)('starts at (a)/(1) when no continuation is given', async () => {
    const text = await renderedText(store({}));
    expect(text).toMatch(/\(a\)\s*MCO 1500\.52/);
    expect(text).toMatch(/\(1\)\s*Training Record/);
  });

  it.skipIf(!toolchain)('ignores a stale start value on a basic letter', async () => {
    // Guards the footgun: set a start, then switch away from an endorsement.
    const text = await renderedText(
      store({ docType: 'naval_letter', startingEnclosureNumber: 5 })
    );
    expect(text).toMatch(/\(1\)\s*Training Record/);
    expect(text).not.toMatch(/\(5\)\s*Training Record/);
  });
});
