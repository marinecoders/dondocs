/**
 * The generic form renderer draws real values onto real template pages. Uses
 * the committed AA-form pages as the canvas with a synthetic config so the test
 * owns its coordinates, and asserts on pdftotext of the rendered PDF — not on
 * the generator's internals (per the repo rule: verify by rendering).
 *
 * The pages are a canvas, not a fixture: nothing here reads that form's own
 * form.json, so any committed letter-size template works. It points at the
 * hand-built AA form because those pages ship on main — no script-generated
 * form is committed, so the test must not depend on one being present.
 *
 * Requires pdftotext; skipped (not falsely passed) without.
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderFormPdf, type PageLoader } from '@/services/pdf/genericFormRenderer';
import { assertFormConfig } from '@/types/formConfig';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

const DIR = join(process.cwd(), 'public/templates/NAVMC10274 - Administrative Action');
const diskLoader: PageLoader = async (_dir, page) => new Uint8Array(await readFile(join(DIR, page)));

const config = assertFormConfig(
  {
    id: 'test-form',
    label: 'Test form',
    directory: 'NAVMC10274 - Administrative Action',
    pages: ['page1.pdf', 'page2.pdf'],
    sections: [{ title: 'Test', fields: ['unit', 'remarks', 'agree'] }],
    fields: {
      unit: { type: 'text', label: 'Unit', page: 1, box: { left: 40, top: 80, width: 300, height: 16 } },
      remarks: {
        type: 'text', label: 'Remarks', page: 2, multiline: true,
        box: { left: 40, top: 600, width: 500, height: 200 },
      },
      agree: { type: 'checkbox', label: 'Agree', page: 1, box: { left: 400, top: 80, width: 12, height: 12 } },
      empty: { type: 'text', label: 'Untouched', page: 1, box: { left: 40, top: 120, width: 100, height: 16 } },
    },
  },
  'test'
);

if (!hasPdfToolchain) describeToolchainRequirement('generic-form-renderer');

describe.runIf(hasPdfToolchain)('generic form renderer', () => {
  it('draws text, wraps multiline, marks checkboxes, skips empties', async () => {
    const bytes = await renderFormPdf(
      config,
      {
        unit: '1st Battalion, 6th Marines',
        remarks: 'Line one of the remarks. '.repeat(12),
        agree: true,
      },
      {},
      diskLoader
    );
    const dir = await mkdtemp(join(tmpdir(), 'gfr-'));
    const pdf = join(dir, 'out.pdf');
    await writeFile(pdf, bytes);

    const info = spawnSync('pdfinfo', [pdf], { encoding: 'utf-8' }).stdout;
    expect(info).toMatch(/Pages:\s+2/);

    const p1 = spawnSync('pdftotext', ['-f', '1', '-l', '1', pdf, '-'], { encoding: 'utf-8' }).stdout;
    expect(p1).toContain('1st Battalion, 6th Marines');
    const p2 = spawnSync('pdftotext', ['-f', '2', '-l', '2', pdf, '-'], { encoding: 'utf-8' }).stdout;
    expect(p2).toContain('Line one of the remarks.');
  });

  it('renders row-group entries at their per-row offsets', async () => {
    const rosterConfig = assertFormConfig(
      {
        ...config,
        sections: [],
        fields: {},
        rowGroups: {
          rows: {
            title: 'Marines',
            page: 1,
            count: 3,
            rowStride: 24,
            columns: {
              lastName: { type: 'text', label: 'Last name', page: 1, box: { left: 40, top: 700, width: 150, height: 14 } },
              pullUps: { type: 'text', label: 'Pull-ups', page: 1, box: { left: 220, top: 700, width: 40, height: 14 } },
            },
          },
        },
      },
      'roster-test'
    );
    const bytes = await renderFormPdf(
      rosterConfig,
      {},
      {
        rows: [
          { lastName: 'ALVAREZ', pullUps: '21' },
          { lastName: 'KIM', pullUps: '14' },
          // A 4th entry beyond count must be dropped, so give row 3 a marker.
          { lastName: 'NOVAK', pullUps: '9' },
          { lastName: 'OVERFLOW', pullUps: '99' },
        ],
      },
      diskLoader
    );
    const dir = await mkdtemp(join(tmpdir(), 'gfr-rows-'));
    const pdf = join(dir, 'out.pdf');
    await writeFile(pdf, bytes);
    const text = spawnSync('pdftotext', ['-f', '1', '-l', '1', '-layout', pdf, '-'], { encoding: 'utf-8' }).stdout;
    for (const name of ['ALVAREZ', 'KIM', 'NOVAK']) expect(text).toContain(name);
    expect(text).not.toContain('OVERFLOW');
    // Layout order preserved: rows appear top-to-bottom in reading order.
    expect(text.indexOf('ALVAREZ')).toBeLessThan(text.indexOf('KIM'));
    expect(text.indexOf('KIM')).toBeLessThan(text.indexOf('NOVAK'));
  });

  it('draws a choice value as text and marks a selected radio', async () => {
    const cfg = assertFormConfig(
      {
        ...config,
        sections: [],
        fields: {
          rank: {
            type: 'choice', label: 'Rank', page: 1,
            options: ['SGT', 'SSGT', 'GYSGT'],
            box: { left: 40, top: 500, width: 120, height: 16 },
          },
          male: { type: 'radio', label: 'Male', page: 1, group: 'sex', box: { left: 40, top: 470, width: 12, height: 12 } },
          female: { type: 'radio', label: 'Female', page: 1, group: 'sex', box: { left: 60, top: 470, width: 12, height: 12 } },
        },
      },
      'choice-radio-test'
    );
    const bytes = await renderFormPdf(cfg, { rank: 'GYSGT', male: true, female: false }, {}, diskLoader);
    const dir = await mkdtemp(join(tmpdir(), 'gfr-cr-'));
    const pdf = join(dir, 'out.pdf');
    await writeFile(pdf, bytes);
    const text = spawnSync('pdftotext', ['-f', '1', '-l', '1', pdf, '-'], { encoding: 'utf-8' }).stdout;
    // The chosen dropdown value prints as text; the selected radio draws an X.
    expect(text).toContain('GYSGT');
    expect(text).toContain('X');
    // The unselected radio and the option-value string are not drawn.
    expect(text).not.toContain('Female');
  });

  it('never draws text past the box edge — clips with a visible ellipsis', async () => {
    const clipConfig = assertFormConfig(
      {
        ...config,
        sections: [],
        fields: {
          tiny: { type: 'text', label: 'Tiny', page: 1, box: { left: 40, top: 400, width: 60, height: 14 } },
          wall: {
            type: 'text', label: 'Wall', page: 1, multiline: true,
            box: { left: 40, top: 300, width: 100, height: 40 },
          },
        },
      },
      'clip-test'
    );
    const long = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz';
    const bytes = await renderFormPdf(
      clipConfig,
      {
        // Single line: cannot fit even at the 5pt shrink floor.
        tiny: long,
        // Multiline: an unbreakable word wider than the box, plus more
        // paragraphs than the box has line capacity for.
        wall: `start ${long}${long} end\n`.repeat(10),
      },
      {},
      diskLoader
    );
    const dir = await mkdtemp(join(tmpdir(), 'gfr-clip-'));
    const pdf = join(dir, 'out.pdf');
    await writeFile(pdf, bytes);
    const text = spawnSync('pdftotext', ['-f', '1', '-l', '1', pdf, '-'], { encoding: 'utf-8' }).stdout;
    // The clip is visible…
    expect(text).toContain('…');
    // …and the full unbroken string was never drawn anywhere.
    expect(text).not.toContain(long);
    // The clipped prefix of the single-line value did land on the page.
    expect(text).toContain('ABCDE');
  });

  // A field box is a rect on an official form; text that escapes it reads as
  // the neighbouring field's answer. Harvested boxes range from ~1pt to ~85pt
  // tall, so the renderer shrinks type to fit HEIGHT as well as width. This
  // asserts the geometry from the rendered PDF rather than from the formula:
  // pdftotext reports each word's font line box (ascent above the baseline,
  // descent below — verified identical for "Hy", "xx" and ".."), so the box
  // can be inverted to recover the baseline and the size the renderer chose.
  it('keeps single-line values inside their box at every box height', async () => {
    const HEIGHTS = [1, 1.5, 4, 5.5, 7, 9, 13, 40, 85];
    const fields = Object.fromEntries(
      HEIGHTS.map((h, i) => [
        `h${i}`,
        // Wide enough that fitToWidth never ellipsizes the probe away.
        { type: 'text', label: `h${i}`, page: 1, box: { left: 40, top: 700 - i * 60, width: 200, height: h } },
      ])
    );
    const values = Object.fromEntries(HEIGHTS.map((_, i) => [`h${i}`, `Wg${i}`]));
    const cfg = assertFormConfig(
      { ...config, sections: [{ title: 'Fit', fields: Object.keys(fields) }], fields },
      'fit'
    );

    const bytes = await renderFormPdf(cfg, values, {}, diskLoader);
    const dir = await mkdtemp(join(tmpdir(), 'fit-'));
    const pdf = join(dir, 'out.pdf');
    await writeFile(pdf, bytes);
    const xml = spawnSync('pdftotext', ['-bbox', '-f', '1', '-l', '1', pdf, '-'], {
      encoding: 'utf-8',
    }).stdout;
    const pageHeight = Number(/height="([\d.]+)"/.exec(xml)?.[1] ?? 792);
    // Helvetica em ratios; the line box pdftotext reports spans -descent..+ascent.
    const ASCENT = 0.718;
    const DESCENT = 0.207;

    HEIGHTS.forEach((h, i) => {
      const m = new RegExp(
        `yMin="([\\d.]+)" xMax="[\\d.]+" yMax="([\\d.]+)">Wg${i}<`
      ).exec(xml);
      expect(m, `probe Wg${i} (box height ${h}) missing from the render`).toBeTruthy();
      // pdftotext uses a top-left origin; convert back to PDF bottom-left.
      const lineTop = pageHeight - Number(m![1]);
      const lineBottom = pageHeight - Number(m![2]);
      const size = (lineTop - lineBottom) / (ASCENT + DESCENT);
      const baseline = lineBottom + DESCENT * size;
      const boxTop = 700 - i * 60;
      const boxBottom = boxTop - h;

      // The value sits ON the box, never under it (the bug this guards).
      expect(baseline, `box height ${h}: baseline below the box`).toBeGreaterThan(boxBottom);
      // …and its ascent never pushes out the top into the field above.
      expect(baseline + ASCENT * size, `box height ${h}: ascent over the box top`)
        .toBeLessThanOrEqual(boxTop + 0.01);
    });
  });

  it('rejects a config whose section names an unknown field', () => {
    expect(() =>
      assertFormConfig(
        { ...config, sections: [{ title: 'Bad', fields: ['nope'] }] },
        'test'
      )
    ).toThrow(/unknown field "nope"/);
  });
});
