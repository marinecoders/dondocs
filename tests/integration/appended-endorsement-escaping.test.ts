/**
 * The acknowledgement is free text a Marine types, and it goes straight into
 * LaTeX. Every field is routed through an escaper, but nothing proved that the
 * result compiles — and an unescaped `&` or `%` is not a cosmetic bug, it is a
 * failed export at the moment someone is trying to sign an appointment.
 *
 * `%` is the sharpest: unescaped it comments out the rest of the line, so the
 * text silently vanishes rather than erroring. The assertions below therefore
 * check the characters survive *onto the page*, not merely that pdflatex
 * exited 0.
 *
 * Both generators are covered because they use different escapers for the same
 * data (escapeLatex vs escapeFlat/escapeTabular), which is exactly the shape of
 * a drift bug.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileFixture } from '../_helpers/compileLatex';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';
import { generateFlatLatex } from '@/services/latex/flat-generator';

const toolchain = hasPdfToolchain;

// Every LaTeX special character, in the fields a user actually types.
const NASTY_BODY =
  'Funds & equipment are 100% my responsibility under section #4.\n' +
  'Cost is $50 per item; see C:\\orders\\file and the ~approved^ list {final}.';
const NASTY_FROM = 'Sergeant J. A. DOE, USMC (S-3 & S-4)';
const NASTY_DUTY = 'MSG Rep. #1 — 100% Duty';

function store() {
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
      ssic: '5216',
      serial: '0123',
      date: '15 Jan 25',
      from: 'Commanding Officer, 1st Battalion, 6th Marines',
      to: NASTY_FROM,
      subject: 'APPOINTMENT',
      sigFirst: 'Robert',
      sigMiddle: 'L',
      sigLast: 'SMITH',
      classLevel: 'unclassified',
      appendEndorsement: true,
      endorsementBody: NASTY_BODY,
      endorsementSigFirst: 'John',
      endorsementSigMiddle: 'A',
      endorsementSigLast: 'DOE',
      endorsementSerial: 'Ser 1710/024 & 025',
      endorsementDate: '3 Feb 25',
    },
    references: [],
    enclosures: [],
    paragraphs: [{ text: `You are appointed as ${NASTY_DUTY}.`, level: 0 }],
    copyTos: [],
    distributions: [],
  } as never;
}

describe('appended acknowledgement — LaTeX metacharacters', () => {
  describeToolchainRequirement('appended-endorsement-escaping');

  it.skipIf(!toolchain)('compiles and prints the characters literally', async () => {
    const result = await compileFixture(store());
    expect(result.ok, `pdflatex failed on metacharacters; work dir: ${result.workDir}`).toBe(true);

    const dir = await mkdtemp(join(tmpdir(), 'dondocs-esc-'));
    const pdfPath = join(dir, 'out.pdf');
    await writeFile(pdfPath, result.pdfBytes!);
    const { stdout } = spawnSync('pdftotext', [pdfPath, '-'], { encoding: 'utf-8' });
    expect(stdout.trim().length).toBeGreaterThan(0);

    // An unescaped % would comment the rest of the line away silently, so the
    // text after it is the real assertion.
    expect(stdout).toMatch(/Funds & equipment are 100% my responsibility under section #4\./);
    expect(stdout).toMatch(/\$50 per item/);
    expect(stdout).toMatch(/C:\\orders\\file/);
    expect(stdout).toMatch(/\{final\}/);
    expect(stdout).toMatch(/Ser 1710\/024 & 025/);
    expect(stdout).toMatch(/Sergeant J\. A\. DOE, USMC \(S-3 & S-4\)/);
  });

  it.skipIf(!toolchain)('does not leak a raw control sequence into the tex', () => {
    const tex = generateFlatLatex(store());
    const ack = tex.slice(tex.indexOf('FIRST ENDORSEMENT'));
    // The escaper must have neutralised these; a bare & or % inside the
    // endorsement body would be a live LaTeX token.
    expect(ack).not.toMatch(/[^\\]&\s*equipment/);
    expect(ack).not.toMatch(/[^\\]%\s*my responsibility/);
    expect(ack).toMatch(/100\\%/);
    expect(ack).toMatch(/\\&/);
  });
});
