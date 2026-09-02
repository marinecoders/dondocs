import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildBaseline } from '../_helpers/compileMatrix';
import { compileFixture } from '../_helpers/compileLatex';
import type { TestStore } from '../_helpers/compileMatrix';
import type { Paragraph } from '@/types/document';

// The I-Type's rules are typographic, so they are proved on the rendered
// page rather than on the LaTeX that produced it: the compile matrix already
// shows every fixture compiles, and a string test on generated TeX passes
// while proving nothing about what a Marine sees. These read the PDF back
// with pdftotext and check the rules the MARCORSYSCOM template states.

const hasPdftotext = spawnSync('pdftotext', ['-v']).status !== null;

async function renderPages(mutate: (s: Record<string, unknown>) => void): Promise<string[]> {
  const store = buildBaseline('i_type' as never) as unknown as Record<string, unknown>;
  mutate(store);
  const r = await compileFixture(store as unknown as TestStore);
  expect(r.ok, r.errors.slice(0, 4).join('\n')).toBe(true);
  const pdf = join(mkdtempSync(join(tmpdir(), 'itype-')), 'o.pdf');
  writeFileSync(pdf, r.pdfBytes!);
  const n = Number(/Pages:\s+(\d+)/.exec(spawnSync('pdfinfo', [pdf], { encoding: 'utf8' }).stdout)?.[1] ?? 0);
  return Array.from({ length: n }, (_, i) =>
    spawnSync('pdftotext', ['-f', String(i + 1), '-l', String(i + 1), pdf, '-'], { encoding: 'utf8' }).stdout
  );
}

describe.skipIf(!hasPdftotext)('I-Type renders per the template', () => {
  let pages: string[];

  beforeAll(async () => {
    pages = await renderPages((s) => {
      Object.assign(s.formData as Record<string, unknown>, {
        date: '15 Dec 24',
        nomenclature: 'RIFLE, 7.62MM, M40A6',
        subject: 'INSTALLATION OF THE STOCK ACCESSORY RAIL',
        shortTitle: 'MI 12345A-24/1',
        pcn: '184 123456 00',
        miUrgency: 'urgent',
        exportRestricted: true,
        supersedure: 'SUPERSEDURE NOTICE: This publication supersedes MI 12344A-24/1 dated 1 Jan 2025.',
        signatureType: 'digital',
        classLevel: 'cui', cuiControlledBy: 'DOD', cuiCategory: 'PRVCY',
        cuiDissemination: 'FEDCON', cuiDistStatement: 'D',
      });
      s.endItems = Array.from({ length: 7 }, (_, i) => ({
        nsn: `5895-01-520-436${i}`, tamcn: `A0255${i}G`, id: `1103${i}A`, model: `V${i}`,
      }));
      s.paragraphs = [
        { text: 'To provide instructions.', level: 0, header: 'Purpose' },
        { text: '', level: 0, header: 'Materiel Required', tableKey: 'materielRequired' },
        { text: 'Do not exceed the torque limit.', level: 0, callout: 'warning' },
        { text: 'Remove the stud.', level: 0, procedure: true },
      ];
      s.publicationTables = {
        materielRequired: [{ values: { description: 'TIE DOWN STRAPS', nsn: '5975-00-984-6582', pn: 'MS3367-1-0', qty: '4' } }],
      };
    });
  }, 90_000);

  it('heads the cover with the anticipated month and year, not the day', () => {
    expect(pages[0]).toMatch(/DECEMBER 2024/);
    expect(pages[0]).not.toMatch(/15 Dec 24/);
  });

  it('carries the fixed notices at the foot of the cover', () => {
    expect(pages[0]).toMatch(/DISTRIBUTION STATEMENT D: Distribution authorized to the Department of Defense/);
    expect(pages[0]).toMatch(/Arms Export Control Act/);
    expect(pages[0]).toMatch(/DESTRUCTION NOTICE: Destroy by making this publication unreadable/);
    expect(pages[0]).toMatch(/PCN 184 123456 00/);
    expect(pages[0]).toMatch(/SUPERSEDURE NOTICE/);
  });

  it('prints the PCN on the cover only', () => {
    expect(pages.slice(1).join('\n')).not.toMatch(/PCN 184/);
  });

  it('moves seven end items to the back of the cover, all of them', () => {
    expect(pages[0]).toMatch(/See Next Page/);
    expect(pages[1]).toMatch(/5895-01-520-4360/);
    expect(pages[1]).toMatch(/5895-01-520-4366/);
  });

  it('names the publication by type and number in the authentication sentence', () => {
    const body = pages.join('\n');
    expect(body).toMatch(/This Modification Instruction, MI 12345A-24\/1, is\s+authenticated for Marine Corps use/);
  });

  it('records the modification — the MI-only paragraph', () => {
    expect(pages.join('\n')).toMatch(/5\. Record completion of this modification/);
  });

  it('runs the short title and date on every page after the cover', () => {
    for (const p of pages.slice(1)) {
      expect(p).toMatch(/MI 12345A-24\/1/);
      expect(p).toMatch(/15 Dec 24/);
    }
  });

  it('sets a WARNING entirely in capitals', () => {
    expect(pages.join('\n')).toMatch(/WARNING\s+DO NOT EXCEED THE TORQUE LIMIT\./);
  });

  it('does not number a callout, and keeps the steps consecutive around it', () => {
    const body = pages.join('\n');
    expect(body).toMatch(/1\.\s+Purpose/);
    expect(body).toMatch(/3\.\s+Remove the stud/);
    expect(body).not.toMatch(/\d\.\s+DO NOT EXCEED/);
  });

  it('drops the Item column from a table where no row uses it', () => {
    const body = pages.join('\n');
    expect(body).toMatch(/Description/);
    expect(body).not.toMatch(/\bItem\b\s+Description/);
  });

  it('starts an appendix on its own page, lettered and titled, numbered A-1', async () => {
    const own = await renderPages((s) => {
      Object.assign(s.formData as Record<string, unknown>, { date: '15 Dec 24', shortTitle: 'MI 12345A-24/1', subject: 'TITLE' });
      (s.paragraphs as Paragraph[]).push({ text: 'Values apply at 20 C.', level: 0, header: 'Torque Values', appendix: true });
    });
    const last = own[own.length - 1];
    expect(last).toMatch(/APPENDIX A/);
    expect(last).toMatch(/TORQUE VALUES/);
    expect(last).toMatch(/\bA-1\b/);
  });
});
