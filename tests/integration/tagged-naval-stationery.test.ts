import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderTaggedCorrespondence } from '@/services/pdf/accessibility/render';
import { validateGeneratedTaggedPdf } from '@/services/pdf/accessibility/validate';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { TAGGED_MAIN_FILE } from '@/services/latex/renderDocument';
import { compileGeneratedFixture } from '../_helpers/compileLatex';
import { hasPdfToolchain } from '../_helpers/pdfToolchain';

describe.skipIf(!hasPdfToolchain)('tagged naval stationery', () => {
  it.each(['title-only', 'preprinted'] as const)('preserves printed content and table structure on %s stock', async letterheadMode => {
    const source: Parameters<typeof renderTaggedCorrespondence>[0] = {
      docType: 'naval_letter',
      formData: { date: '21 Nov 26', subject: 'TAGGED STATIONERY', from: 'Training Staff', to: 'Training Office',
        unitLine1: 'SYNTHETIC TITLE', unitAddress: 'HIDDEN UNIT ADDRESS', letterheadMode, signatureType: 'none' },
      paragraphs: [
        { level: 0, text: 'Review the table below.' },
        { level: 0, text: 'Training table', bodyTable: { rows: [['Role', 'Activity'],
          ...Array.from({ length: 48 }, (_, index) => [`ROW${index}`, 'Training review'])], headerRows: 1 } },
      ],
      references: [], enclosures: [], distributions: [], copyTos: [],
    };
    const date = new Date('2026-11-21T12:00:00Z');
    const normal = await compileGeneratedFixture(generateAllLatexFiles(source, undefined, date).texFiles, {}, source.docType);
    expect(normal.ok, normal.logTail).toBe(true);
    const tagged = await renderTaggedCorrespondence(source, {
      referenceDate: date,
      signal: new AbortController().signal,
      read: () => { throw new Error('Unexpected attachment read'); },
      loadSeal: async () => { throw new Error('Artless stationery must not load an image'); },
      async compile(files) {
        const tex = Object.fromEntries(Object.entries(files).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
        tex['main.tex'] = tex[TAGGED_MAIN_FILE];
        const result = await compileGeneratedFixture(tex, {}, source.docType);
        expect(result.ok, result.logTail).toBe(true);
        return result.pdfBytes!;
      },
    });
    expect((await validateGeneratedTaggedPdf(tagged)).associatedChunks).toBeGreaterThan(98);
    const taggedPath = join(normal.workDir, 'tagged.pdf');
    await writeFile(taggedPath, tagged);
    const measured = spawnSync('pdftotext', [taggedPath, '-'], { encoding: 'utf8' });
    expect(measured.status, measured.stderr).toBe(0);
    expect(measured.stdout.includes('SYNTHETIC TITLE')).toBe(letterheadMode === 'title-only');
    expect(measured.stdout).not.toContain('HIDDEN UNIT ADDRESS');
    for (const [file, prefix] of [['main.pdf', 'original'], ['tagged.pdf', 'tagged']]) {
      const rendered = spawnSync('pdftoppm', ['-r', '72', '-png', join(normal.workDir, file), join(normal.workDir, prefix)], { encoding: 'utf8' });
      expect(rendered.status, rendered.stderr).toBe(0);
    }
    const originals = (await readdir(normal.workDir)).filter(file => /^original-\d+\.png$/.test(file));
    expect(originals.length).toBeGreaterThan(1);
    for (const original of originals) {
      expect(await readFile(join(normal.workDir, original.replace('original-', 'tagged-')))).toEqual(await readFile(join(normal.workDir, original)));
    }
  }, 60_000);
});
