/**
 * Rendered-output check for the appended acknowledgement (#203).
 *
 * The unit tests (tests/unit/appendedEndorsement.test.ts) assert the generators
 * emit the right LaTeX *source*. That is not enough here: `generator.ts` only
 * calls `\setAppendedEndorsement{...}`, and it is `main.tex`'s
 * `\printAppendedEndorsement` that actually prints it. A source-only test stays
 * green even if the render site is dropped and the appointee's half silently
 * vanishes from the page.
 *
 * The whole point of the feature is that both halves land on ONE sheet, so the
 * page count is the assertion that matters most — a two-page result would be a
 * regression even with every string present.
 *
 * Requires pdflatex + pdftotext + pdfinfo; skipped (not falsely passed) without.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileFixture } from '../_helpers/compileLatex';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

const toolchain = hasPdfToolchain;

function store(extra: Record<string, unknown>) {
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
      to: 'Sergeant J. A. DOE, USMC',
      subject: 'APPOINTMENT AS MARINE SECURITY GUARD REPRESENTATIVE',
      sigFirst: 'Robert',
      sigMiddle: 'L',
      sigLast: 'SMITH',
      classLevel: 'unclassified',
      ...extra,
    },
    references: [],
    enclosures: [],
    paragraphs: [
      { text: 'Per the references, you are hereby appointed as the MSG Representative.', level: 0 },
      { text: 'This appointment is automatically revoked upon your transfer.', level: 0 },
    ],
    copyTos: [],
    distributions: [],
  } as never;
}

const acknowledgement = {
  appendEndorsement: true,
  endorsementBody:
    'I have read and understand the references listed above.\nI hereby assume the duties and responsibilities as the MSG Representative.',
  endorsementSigFirst: 'John',
  endorsementSigMiddle: 'A',
  endorsementSigLast: 'DOE',
};

async function render(extra: Record<string, unknown>): Promise<{ text: string; pages: number }> {
  const result = await compileFixture(store(extra));
  expect(result.ok, `pdflatex failed; work dir: ${result.workDir}`).toBe(true);
  const dir = await mkdtemp(join(tmpdir(), 'dondocs-ack-'));
  const pdfPath = join(dir, 'out.pdf');
  await writeFile(pdfPath, result.pdfBytes!);
  const { stdout } = spawnSync('pdftotext', [pdfPath, '-'], { encoding: 'utf-8' });
  // A blank extraction would make the assertions below vacuous.
  expect(stdout.trim().length).toBeGreaterThan(0);
  const info = spawnSync('pdfinfo', [pdfPath], { encoding: 'utf-8' }).stdout;
  const pages = Number(info.match(/Pages:\s+(\d+)/)?.[1]);
  expect(Number.isFinite(pages)).toBe(true);
  return { text: stdout, pages };
}

describe('appended acknowledgement — rendered PDF', () => {
  describeToolchainRequirement('appended-endorsement-render');

  it.skipIf(!toolchain)('puts the appointment and the acknowledgement on one sheet', async () => {
    const { text, pages } = await render(acknowledgement);

    // The reason the feature exists: one sheet, not two.
    expect(pages).toBe(1);

    // The appointing officer's half.
    expect(text).toMatch(/APPOINTMENT AS MARINE SECURITY GUARD REPRESENTATIVE/);
    expect(text).toMatch(/R\. L\. SMITH/);

    // The appointee's half, below it.
    expect(text).toMatch(/FIRST ENDORSEMENT/);
    expect(text).toMatch(/I have read and understand the references listed above\./);
    expect(text).toMatch(/J\. A\. DOE/);

    // Addressees invert without the user typing them.
    const ack = text.slice(text.indexOf('FIRST ENDORSEMENT'));
    expect(ack).toMatch(/From:\s*Sergeant J\. A\. DOE, USMC/);
    expect(ack).toMatch(/To:\s*Commanding Officer, 1st Battalion, 6th Marines/);

    // The appointee's name appears twice — once in the letter's To: line, once
    // as the signature below the rule. lastIndexOf pins the *signature*: an
    // endorsement that rendered its addressees but dropped the signer would
    // still satisfy indexOf.
    expect(text.lastIndexOf('J. A. DOE')).toBeGreaterThan(text.indexOf('FIRST ENDORSEMENT'));
  });

  it.skipIf(!toolchain)('leaves the letter untouched when not requested', async () => {
    const { text, pages } = await render({});
    expect(pages).toBe(1);
    expect(text).toMatch(/R\. L\. SMITH/);
    expect(text).not.toMatch(/FIRST ENDORSEMENT/);
  });

  // Ch 9 ¶2.1a starts the endorsement line "on the second line below the date
  // line". A same-page endorsement may omit the SSIC, subject and basic letter
  // ID — not the date — so the line must render and must sit above the
  // endorsement line, as Fig 9-1 shows.
  it.skipIf(!toolchain)('prints the date line above the endorsement line', async () => {
    const { text, pages } = await render({
      ...acknowledgement,
      endorsementSerial: 'Ser 1710/024',
      endorsementDate: '3 Feb 25',
    });

    expect(pages).toBe(1);
    expect(text).toMatch(/Ser 1710\/024/);
    expect(text).toMatch(/3 Feb 25/);
    expect(text.indexOf('3 Feb 25')).toBeLessThan(text.indexOf('FIRST ENDORSEMENT'));
    expect(text.indexOf('Ser 1710/024')).toBeLessThan(text.indexOf('3 Feb 25'));

    // The letter's own date must not be mistaken for the endorsement's.
    expect(text.indexOf('15 Jan 25')).toBeLessThan(text.indexOf('Ser 1710/024'));
  });

  it.skipIf(!toolchain)('still lands on one sheet when hand-dated at signature', async () => {
    const { pages, text } = await render(acknowledgement);
    expect(pages).toBe(1);
    expect(text).toMatch(/FIRST ENDORSEMENT/);
  });

  // A letter long enough to push the acknowledgement past the page break used
  // to tear it in half — endorsement line on one page, the appointee's
  // signature stranded on the next. Ch 9 para 1 permits a same-page
  // endorsement only when all of it fits ("If not, use a new-page
  // endorsement"), so half a signed endorsement is never a legal rendering.
  // \printAppendedEndorsement wraps the block in a minipage to keep it whole.
  it.skipIf(!toolchain)('never splits the acknowledgement across a page break', async () => {
    const filler = Array.from({ length: 6 }, (_, i) => ({
      text: `Paragraph ${i + 1}. ` + 'Text that consumes vertical space and pushes the signature block down the page. '.repeat(3),
      level: 0,
    }));
    const result = await compileFixture({
      ...(store({ ...acknowledgement, endorsementDate: '3 Feb 25' }) as unknown as Record<string, unknown>),
      paragraphs: filler,
    } as never);
    expect(result.ok, `pdflatex failed; work dir: ${result.workDir}`).toBe(true);

    const dir = await mkdtemp(join(tmpdir(), 'dondocs-ack-split-'));
    const pdfPath = join(dir, 'out.pdf');
    await writeFile(pdfPath, result.pdfBytes!);
    const { stdout } = spawnSync('pdftotext', [pdfPath, '-'], { encoding: 'utf-8' });
    expect(stdout.trim().length).toBeGreaterThan(0);

    const pages = stdout.split('\f');
    const pageOf = (re: RegExp) => pages.findIndex((p) => re.test(p));
    const endorsementLine = pageOf(/FIRST ENDORSEMENT/);
    const dateLine = pageOf(/3 Feb 25/);
    // Anchored to end-of-line so the letter's "To: Sergeant J. A. DOE" does not
    // masquerade as the appointee's signature.
    const signature = pageOf(/J\. A\. DOE\s*$/m);

    expect(endorsementLine).toBeGreaterThanOrEqual(0);
    expect(signature).toBeGreaterThanOrEqual(0);
    expect(dateLine).toBe(endorsementLine);
    expect(signature).toBe(endorsementLine);
  });
});
