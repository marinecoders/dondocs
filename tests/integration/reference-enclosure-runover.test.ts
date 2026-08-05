/**
 * A Ref: or Encl: entry too long for one line wraps under its own text, not
 * under the "(a)" designator.
 *
 * SECNAV M-5216.5 Ch 7 ¶10c: "If the entry is longer than one line, line the
 * second line under the first word after the heading." Figure 7-1 measures out
 * exactly that — Ref: at x=124, (a) at 157, "Communication" at 172, and the
 * runover "directly" at 178, i.e. under the description.
 *
 * The same figure shows why the designator column is the wrong answer: its
 * Encl: block starts a NEW entry, (2), directly under (1). That column means
 * "another entry", so a continuation sitting there reads as one.
 *
 * Reported from the field, on both the reference list and — by the same
 * machinery — the enclosure list.
 *
 * Measured on the rendered page rather than asserted on the LaTeX: the entries
 * are laid out by a \makebox/\parbox pair inside a tabular's minipage, and
 * whether that actually lands where intended is a question about typeset
 * geometry, not about source text.
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

if (!toolchain) {
  console.warn('[reference-enclosure-runover] pdflatex/pdftotext missing — SKIPPING.');
}

/** Long enough to wrap in the ~5.9in entry column at any supported size. */
const LONG =
  'DMC-H1AHZ-A-10-10-0000-00AA-170T-A_001-00 Parking aircraft in turbulent weather parking configuration';

type Line = { y: number; words: { x: number; text: string }[] };

async function renderedLines(pdf: Uint8Array): Promise<Line[]> {
  const dir = await mkdtemp(join(tmpdir(), 'dondocs-runover-'));
  const pdfPath = join(dir, 'out.pdf');
  await writeFile(pdfPath, pdf);
  const xml = spawnSync('pdftotext', ['-bbox', pdfPath, '-'], { encoding: 'utf-8' }).stdout || '';
  const rows = new Map<number, { x: number; text: string }[]>();
  for (const m of xml.matchAll(
    /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="[\d.]+" yMax="[\d.]+">([^<]*)<\/word>/g,
  )) {
    const y = Math.round(parseFloat(m[2]));
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y)!.push({ x: parseFloat(m[1]), text: m[3] });
  }
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([y, words]) => ({ y, words: words.sort((a, b) => a.x - b.x) }));
}

/**
 * For the entry whose designator is `designator`: where its description starts,
 * and where the line below it starts.
 */
function entryColumns(lines: Line[], designator: string) {
  const i = lines.findIndex((l) => l.words[0]?.text === designator);
  expect(i, `no line begins with the designator ${designator}`).toBeGreaterThanOrEqual(0);
  expect(lines[i].words.length, `${designator} has no description`).toBeGreaterThan(1);
  const runoverLine = lines[i + 1];
  expect(runoverLine, `${designator} did not wrap — the fixture text is too short`).toBeDefined();
  return {
    designator: lines[i].words[0].x,
    description: lines[i].words[1].x,
    runover: runoverLine.words[0].x,
  };
}

function storeWithLongEntries() {
  const store = buildBaseline('naval_letter');
  store.references = [
    { letter: 'a', title: 'A short one.' },
    { letter: 'b', title: LONG },
  ];
  store.enclosures = [
    { number: 1, title: 'A short one.' },
    { number: 2, title: LONG },
  ] as never;
  return store;
}

describe.skipIf(!toolchain)('reference and enclosure runover lines', () => {
  it('wraps a long reference under its description, not under the designator', async () => {
    const result = await compileFixture(storeWithLongEntries());
    expect(result.ok, formatFailure('reference-runover', result)).toBe(true);

    const { designator, description, runover } = entryColumns(
      await renderedLines(result.pdfBytes!),
      '(b)',
    );

    expect(
      Math.abs(runover - description),
      `the runover starts at x=${runover.toFixed(1)} but the description starts ` +
        `at x=${description.toFixed(1)} — ¶10c lines them up. The designator ` +
        `column is x=${designator.toFixed(1)}; that is where a new entry goes.`,
    ).toBeLessThan(1.5);
  }, 180_000);

  it('wraps a long enclosure the same way', async () => {
    const result = await compileFixture(storeWithLongEntries());
    expect(result.ok, formatFailure('enclosure-runover', result)).toBe(true);

    const { designator, description, runover } = entryColumns(
      await renderedLines(result.pdfBytes!),
      '(2)',
    );

    expect(
      Math.abs(runover - description),
      `the enclosure runover starts at x=${runover.toFixed(1)} against a ` +
        `description at x=${description.toFixed(1)} (designator x=${designator.toFixed(1)}).`,
    ).toBeLessThan(1.5);
  }, 180_000);

  it('keeps the runover clear of the designator column', async () => {
    // The specific regression: wrapped lines used to land exactly on the
    // designator, so a continuation was indistinguishable from a new entry.
    const result = await compileFixture(storeWithLongEntries());
    expect(result.ok, formatFailure('runover-clears-designator', result)).toBe(true);
    const lines = await renderedLines(result.pdfBytes!);

    for (const designator of ['(b)', '(2)']) {
      const cols = entryColumns(lines, designator);
      expect(
        cols.runover - cols.designator,
        `${designator}'s runover sits ${(cols.runover - cols.designator).toFixed(1)}pt ` +
          'from the designator column — it needs to clear it.',
      ).toBeGreaterThan(5);
    }
  }, 180_000);

  it('still lists entries on consecutive lines with no gap between them', async () => {
    // Each entry became its own paragraph to get a per-entry hang; that must
    // not introduce paragraph spacing. Figure 7-1 lists (1) and (2) on
    // adjacent lines.
    const store = buildBaseline('naval_letter');
    store.references = [
      { letter: 'a', title: 'First.' },
      { letter: 'b', title: 'Second.' },
      { letter: 'c', title: 'Third.' },
    ];
    const result = await compileFixture(store);
    expect(result.ok, formatFailure('runover-no-gap', result)).toBe(true);
    const lines = await renderedLines(result.pdfBytes!);

    // Located by title, not designator: the first entry shares its line with
    // the "Ref:" label, so it never *begins* with (a).
    const y = (title: string) => {
      const i = lines.findIndex((l) => l.words.some((w) => w.text === title));
      expect(i, `no line carries the entry "${title}"`).toBeGreaterThanOrEqual(0);
      return lines[i].y;
    };
    const firstGap = y('Second.') - y('First.');
    const secondGap = y('Third.') - y('Second.');
    expect(
      Math.abs(secondGap - firstGap),
      'reference entries should be evenly single-spaced',
    ).toBeLessThan(2);
    expect(
      firstGap,
      `entries are ${firstGap.toFixed(1)}pt apart; a blank line between them ` +
        'would roughly double a single-spaced line.',
    ).toBeLessThan(20);
  }, 180_000);
});
