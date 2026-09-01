/**
 * The repeated subject on page 2+ has to clear the body, and wrap like page one.
 *
 * SECNAV M-5216.5 Ch 7 ¶16: "Repeat the subject line at the top of each page of
 * the basic letter ... Continue the text beginning on the second line below the
 * subject."
 *
 * It was a \fancyhead against headheight=15pt — one line. A subject that wrapped
 * printed straight through the first body line (measured: header at y=74, body
 * at y=76), and its continuation lines returned to the left margin instead of
 * sitting under the subject text, because the header had none of the tabular
 * that shapes the first page.
 *
 * This measures the rendered page, since the whole claim is about where glyphs
 * land.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { buildBaseline } from '../_helpers/compileMatrix';

const toolchain =
  spawnSync('pdflatex', ['--version'], { encoding: 'utf-8' }).status === 0 &&
  spawnSync('pdftotext', ['-v'], { encoding: 'utf-8' }).status === 0;

if (!toolchain) console.warn('[continuation-subject] toolchain missing — SKIPPING.');

/** Long enough to wrap the header at every supported font size. */
const LONG_SUBJECT =
  'COMMAND INVESTIGATION INTO THE FACTS AND CIRCUMSTANCES SURROUNDING THE ' +
  'MATERIAL CONDITION AND OPERATIONAL READINESS OF ASSIGNED EQUIPMENT';

/** Enough body to reach a second page. */
const BODY = Array.from({ length: 14 }, (_, i) => ({
  level: 0,
  text: `Paragraph ${i + 1}. ` + 'The quick brown fox jumps over the lazy dog. '.repeat(12),
}));

async function lines(pdf: Uint8Array, page: number) {
  const dir = await mkdtemp(join(tmpdir(), 'dondocs-cont-'));
  const p = join(dir, 'out.pdf');
  await writeFile(p, pdf);
  const xml =
    spawnSync('pdftotext', ['-bbox', '-f', String(page), '-l', String(page), p, '-'], {
      encoding: 'utf-8',
    }).stdout || '';
  const words: { x: number; y: number; w: string }[] = [];
  for (const m of xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>([^<]*)<\/word>/g))
    words.push({ x: parseFloat(m[1]), y: parseFloat(m[2]), w: m[3] });
  const byRow = new Map<number, { x: number; text: string[] }>();
  for (const w of words) {
    const key = Math.round(w.y);
    if (!byRow.has(key)) byRow.set(key, { x: w.x, text: [] });
    const row = byRow.get(key)!;
    row.x = Math.min(row.x, w.x);
    row.text.push(w.w);
  }
  return [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([y, v]) => ({ y, x: v.x, text: v.text.join(' ') }));
}

async function render(docType: string, subject: string, enabled: boolean) {
  const store = buildBaseline(docType as never);
  store.formData.subject = subject;
  store.formData.showSubjectOnContinuation = enabled;
  store.paragraphs = BODY as never;
  const result = await compileFixture(store);
  if (!result.ok) throw new Error(formatFailure(docType, result));
  return result.pdfBytes!;
}

describe.skipIf(!toolchain)('continuation subject', () => {
  it('wraps under the subject text, not back at the margin', async () => {
    const rows = await lines(await render('naval_letter', LONG_SUBJECT, true), 2);
    const label = rows.find((r) => r.text.startsWith('Subj:'))!;
    const wrapped = rows.filter((r) => /^(SURROUNDING|READINESS OF)/.test(r.text));

    expect(wrapped.length).toBeGreaterThan(0);
    // Page one puts the subject in a p-column so its continuation lines sit
    // under the subject text. The header used to have no such column, leaving
    // every wrapped line flush at the label's own margin.
    for (const row of wrapped) expect(row.x).toBeGreaterThan(label.x + 20);
  }, 180000);

  it('leaves the body two lines below the last subject line', async () => {
    const rows = await lines(await render('naval_letter', LONG_SUBJECT, true), 2);
    const headerRows = rows.filter((r) => /^(Subj:|SURROUNDING|READINESS OF)/.test(r.text));
    const lastHeader = headerRows[headerRows.length - 1];
    const firstBody = rows.find((r) => r.y > lastHeader.y)!;

    // Two lines at 12pt is ~28pt. It was 2pt — the header printing through the
    // body, which is what the report showed.
    expect(firstBody.y - lastHeader.y).toBeGreaterThanOrEqual(20);
  }, 180000);

  it('does not move page one, which carries no repeated subject', async () => {
    // The height is reserved through headheight, which is page geometry and so
    // applies to every page. Page one hands it back; if it ever stops doing so,
    // the letterhead and sender's symbols drift off their measured positions.
    const [off, on] = await Promise.all([
      render('naval_letter', LONG_SUBJECT, false).then((p) => lines(p, 1)),
      render('naval_letter', LONG_SUBJECT, true).then((p) => lines(p, 1)),
    ]);
    const shape = (rs: { y: number; x: number }[]) =>
      rs.slice(0, 8).map((r) => `${r.y}/${Math.round(r.x)}`).join(' ');
    expect(shape(on)).toBe(shape(off));
  }, 240000);

  it('labels the executive formats SUBJECT: and indents to match', async () => {
    // The label is set by the format module and must be in place before the
    // header height is measured — a longer label wraps differently.
    const rows = await lines(await render('standard_memorandum', LONG_SUBJECT, true), 2);
    const label = rows.find((r) => r.text.startsWith('SUBJECT:'));
    expect(label).toBeDefined();
    const wrapped = rows.filter((r) => /^(SURROUNDING|READINESS OF)/.test(r.text));
    for (const row of wrapped) expect(row.x).toBeGreaterThan(label!.x + 20);
  }, 180000);
});
