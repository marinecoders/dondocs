/**
 * A same-page endorsement may carry the subject line, at the author's choice.
 *
 * SECNAV M-5216.5 Ch 9: "When preparing a same-page endorsement, as long as the
 * entire page will be photocopied, you may omit the SSIC, subject and the basic
 * letter's identification symbols." Figure 9-1 repeats it and adds that those
 * elements are required on every new-page endorsement.
 *
 * "May omit", conditioned on something only the author knows. The app used to
 * decide it for them: `skipSubject` dropped the line from both formats while the
 * editor went on offering a Subject field that reached neither.
 *
 * Both formats are checked together, because the failure being fixed is one
 * where a field the user filled in reaches no output at all.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { compileDocxFixture, formatDocxFailure } from '../_helpers/compileDocx';
import { buildBaseline } from '../_helpers/compileMatrix';

const toolchain =
  spawnSync('pdflatex', ['--version'], { encoding: 'utf-8' }).status === 0 &&
  spawnSync('pandoc', ['--version'], { encoding: 'utf-8' }).status === 0;

if (!toolchain) console.warn('[endorsement-subject] toolchain missing — SKIPPING.');

const SUBJECT = 'REQUEST FOR ADDITIONAL TRAINING SUPPORT';

function fixture(docType: string, include: boolean) {
  const s = buildBaseline(docType as never);
  s.formData.subject = SUBJECT;
  s.formData.includeEndorsementSubject = include;
  return s;
}

async function pdfText(docType: string, include: boolean) {
  const r = await compileFixture(fixture(docType, include));
  if (!r.ok) throw new Error(formatFailure(docType, r));
  const dir = await mkdtemp(join(tmpdir(), 'endo-'));
  const f = join(dir, 'o.pdf');
  await writeFile(f, r.pdfBytes!);
  return spawnSync('pdftotext', [f, '-'], { encoding: 'utf-8' }).stdout || '';
}

async function docxText(docType: string, include: boolean) {
  const r = await compileDocxFixture(fixture(docType, include));
  if (!r.ok) throw new Error(formatDocxFailure(docType, r));
  const dir = await mkdtemp(join(tmpdir(), 'endo-'));
  const f = join(dir, 'o.docx');
  await writeFile(f, r.docxBytes!);
  return (spawnSync('unzip', ['-p', f, 'word/document.xml'], { encoding: 'utf-8' }).stdout || '')
    .replace(/<[^>]+>/g, ' ');
}

const carries = (s: string) => s.includes('REQUEST FOR ADDITIONAL TRAINING SUPPORT');

describe.skipIf(!toolchain)('same-page endorsement subject', () => {
  it('omits it by default, which is the photocopied case Ch 9 describes', async () => {
    expect(carries(await pdfText('same_page_endorsement', false))).toBe(false);
    expect(carries(await docxText('same_page_endorsement', false))).toBe(false);
  }, 240000);

  it('carries it when the author asks for it — in both formats', async () => {
    // The whole complaint: a subject typed into the editor that reached
    // neither the PDF nor the Word file, with no way to turn it on.
    expect(carries(await pdfText('same_page_endorsement', true))).toBe(true);
    expect(carries(await docxText('same_page_endorsement', true))).toBe(true);
  }, 240000);

  it('leaves the new-page endorsement carrying it either way', async () => {
    // Ch 9 makes it mandatory there, so the switch must not reach it.
    for (const include of [false, true]) {
      expect(carries(await pdfText('new_page_endorsement', include))).toBe(true);
      expect(carries(await docxText('new_page_endorsement', include))).toBe(true);
    }
  }, 480000);
});
