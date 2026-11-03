/**
 * The issue-28 letter templates (records discrepancy, UA statement, certificate
 * of relief) compile to real PDFs. Their placeholder text is bracket-heavy and
 * carries slashes, em-dashes, and curly quotes — exactly the characters that
 * survive a string assertion but can fatal pdfTeX. So each template is loaded
 * the way TemplateLoaderModal loads it (subject, ssic, paragraphs, references)
 * and compiled with pdflatex; the assertion is on the rendered page text.
 *
 * Requires pdflatex + pdftotext; skipped (not falsely passed) without.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LETTER_TEMPLATES } from '@/data/templates';
import { compileFixture } from '../_helpers/compileLatex';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

const TEMPLATE_IDS = ['records-discrepancy', 'ua-statement', 'certificate-of-relief'] as const;

function storeFor(id: (typeof TEMPLATE_IDS)[number]) {
  const t = LETTER_TEMPLATES.find((x) => x.id === id)!;
  return {
    docType: t.docType,
    formData: {
      docType: t.docType,
      fontSize: '12pt',
      fontFamily: 'times',
      pageNumbering: 'none',
      department: 'usmc',
      unitLine1: '1ST BATTALION, 6TH MARINES',
      unitLine2: '2D MARINE DIVISION, II MEF',
      unitAddress: 'PSC BOX 20123, CAMP LEJEUNE, NC 28542-0123',
      sealType: 'dow',
      letterheadColor: 'blue',
      ssic: t.ssic ?? '5216',
      serial: '0123',
      date: '19 Jul 26',
      from: 'Commanding Officer, 1st Battalion, 6th Marines',
      to: 'Sergeant J. A. DOE, USMC',
      subject: t.subject,
      sigFirst: 'Robert',
      sigMiddle: 'L',
      sigLast: 'SMITH',
      classLevel: 'unclassified',
    },
    references: (t.references ?? []).map((r) => ({ letter: r.letter, text: r.title })),
    enclosures: [],
    paragraphs: t.paragraphs.map((p) => ({ text: p.text, level: p.level })),
    copyTos: [],
    distributions: [],
  } as never;
}

if (!hasPdfToolchain) describeToolchainRequirement('issue28-templates-render');

describe.runIf(hasPdfToolchain)('issue-28 templates render', () => {
  it.each(TEMPLATE_IDS)('%s compiles and its subject appears on the page', async (id) => {
    const result = await compileFixture(storeFor(id));
    expect(result.ok, `pdflatex failed for ${id}; work dir: ${result.workDir}`).toBe(true);
    const dir = await mkdtemp(join(tmpdir(), 'issue28-'));
    const pdfPath = join(dir, 'out.pdf');
    await writeFile(pdfPath, result.pdfBytes!);
    const { stdout } = spawnSync('pdftotext', [pdfPath, '-'], { encoding: 'utf-8' });
    const t = LETTER_TEMPLATES.find((x) => x.id === id)!;
    expect(stdout).toContain(t.subject);
    // The body actually rendered — not just the letterhead shell.
    expect(stdout.length).toBeGreaterThan(200);
  });
});
