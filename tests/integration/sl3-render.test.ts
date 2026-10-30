import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { compileFixture } from '../_helpers/compileLatex';
import {
  hasPdfToolchain,
  describeToolchainRequirement,
} from '../_helpers/pdfToolchain';
import { sl3Fixture } from '../_helpers/sl3Fixture';

describeToolchainRequirement('sl3-render');
describe.skipIf(!hasPdfToolchain)('SL-3 rendered publication', () => {
  for (const orientation of ['portrait', 'landscape'] as const)
    it(`renders a complete ${orientation} inventory`, async () => {
      const store = sl3Fixture(20);
      store.formData.sl3!.orientation = orientation;
      const result = await compileFixture(store);
      expect(result.ok, result.errors.join('\n') + result.logTail).toBe(true);
      const path = join(result.workDir, 'sl3.pdf');
      writeFileSync(path, result.pdfBytes!);
      const text = spawnSync('pdftotext', ['-layout', path, '-'], {
        encoding: 'utf8',
      }).stdout;
      for (const expected of [
        'PREFACE',
        'SPECIAL NOTES',
        'TECHNICAL DATA',
        'SUPPLY SYSTEM RESPONSIBILITY ITEMS',
        'USING UNIT RESPONSIBILITY ITEMS',
        'PERIODIC',
        'INVENTORIED BY',
        'Training 020',
      ])
        expect(text).toContain(expected);
      expect(text).not.toContain('NORMAL');
      expect(text).not.toContain('Recording Instruction');
      const pdf = await PDFDocument.load(result.pdfBytes!);
      expect(pdf.getPages().some((p) => p.getWidth() > p.getHeight())).toBe(
        orientation === 'landscape',
      );
      expect(text.split('\f').filter((p) => p.trim()).length).toBe(
        pdf.getPageCount(),
      );
      // Check the first compile, as the live preview does not guarantee a
      // second pass to repair longtable's merged header widths.
      const boxes = spawnSync('pdftotext', ['-bbox', path, '-'], {
        encoding: 'utf8',
      }).stdout;
      const inventoryPage = boxes
        .split('</page>')
        .find((page) => page.includes('>PERIODIC</word>'))!;
      const wordX = (word: string) =>
        Number(
          inventoryPage.match(
            new RegExp(`<word xMin="([0-9.]+)"[^>]*>${word}</word>`),
          )![1],
        );
      expect(wordX('NSN')).toBeCloseTo(wordX('5120-01-542-7445'), 1);
      // A landscape page must use its wider text area as well as a rotated
      // media box; geometry can otherwise silently restore portrait sizing.
      expect(wordX('NSN')).toBeGreaterThan(
        orientation === 'landscape' ? 70 : 95,
      );
      expect(wordX('NSN')).toBeLessThan(orientation === 'landscape' ? 85 : 105);
    }, 60000);

  it('previews an empty draft without requiring export-ready content', async () => {
    const store = sl3Fixture(0);
    store.formData = {
      sl3: store.formData.sl3,
      fontFamily: 'times',
      fontSize: '10pt',
      classLevel: 'unclassified',
    };
    const result = await compileFixture(store);
    expect(result.ok, result.errors.join('\n') + result.logTail).toBe(true);
  }, 60000);

  it('keeps the first component with its parent at the row limit and retains notes and optional columns', async () => {
    const store = sl3Fixture(20);
    const data = store.formData.sl3!;
    data.showModel = true;
    data.showFigureReference = true;
    data.notes = [
      {
        id: 'special',
        text: 'Inventory the parent and its handle together.',
        portionMarking: 'U',
      },
    ];
    data.components[14].description =
      'A demonstration assembly with a removable handle.';
    data.components[14].noteIds = ['special'];
    data.components[15].parentId = data.components[14].id;
    data.components[15].quantity = '4';
    data.components[15].model = 'TRAINING';
    const result = await compileFixture(store);
    expect(result.ok, result.errors.join('\n') + result.logTail).toBe(true);
    const path = join(result.workDir, 'nested-sl3.pdf');
    writeFileSync(path, result.pdfBytes!);
    const pages = spawnSync('pdftotext', ['-layout', path, '-'], {
      encoding: 'utf8',
    }).stdout.split('\f');
    const parentPage = pages.find((p) => p.includes('Training 015'))!;
    expect(parentPage).toContain('Training 016');
    expect(parentPage).toContain('4 - COMPONENT');
    expect(pages.join(' ')).toContain(
      'Inventory the parent and its handle together.',
    );
    expect(pages.join(' ')).toContain('MODEL');
  }, 60000);

  it('moves seven end items after the cover without losing rows', async () => {
    const store = sl3Fixture();
    store.endItems = Array.from({ length: 7 }, (_, i) => ({
      ...store.endItems[0],
      model: `MODEL-${i + 1}`,
    }));
    const result = await compileFixture(store);
    expect(result.ok, result.errors.join('\n') + result.logTail).toBe(true);
    const path = join(result.workDir, 'overflow-sl3.pdf');
    writeFileSync(path, result.pdfBytes!);
    const pages = spawnSync('pdftotext', ['-layout', path, '-'], {
      encoding: 'utf8',
    }).stdout.split('\f');
    expect(pages[0]).toContain('See Next Page');
    for (let i = 1; i <= 7; i++) expect(pages[1]).toContain(`MODEL-${i}`);
    expect(pages[2]).toContain('OFFICIAL');
  }, 60000);

  it('refuses a row that cannot fit on a page', async () => {
    const store = sl3Fixture(1);
    store.formData.sl3!.components[0].description =
      'Lengthy demonstration component description. '.repeat(400);
    const result = await compileFixture(store);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('parent-component group exceeds');
  }, 60000);
});
