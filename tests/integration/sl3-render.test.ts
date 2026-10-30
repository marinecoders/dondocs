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
import { SL3_INVENTORY_GRID } from '@/data/techpub/sl3';
import { sl3ExportErrors } from '@/lib/sl3Preflight';
import { expectSl3Certification } from '../_helpers/sl3Certification';

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
        'Periodic',
        'INVENTORIED BY',
        'Training 020',
      ])
        expect(text).toContain(expected);
      expect(text).not.toContain('NORMAL');
      expect(text).not.toContain('Recording Instruction');
      expect(text).toContain('30 OCTOBER 2026');
      expect(text).toContain('TABLE OF CONTENTS');
      expect(text).toContain('LIST OF TABLES');
      expect(text).not.toContain('??');
      expect(text).not.toContain('sl3.');
      expect(text.split('\f')[0]).not.toMatch(/(?:^|\n)\s*1\s*(?:\n|$)/);
      for (const page of text.split('\f')) {
        if (/\bNOTE\b/.test(page)) {
          const noteBody = page
            .split(/\bNOTE\b/)
            .at(-1)!
            .replace(/\s+[ivx]+\s*$/, '')
            .trim();
          expect(noteBody, 'a NOTE heading must stay with its text').not.toBe(
            '',
          );
        }
      }
      const pdf = await PDFDocument.load(result.pdfBytes!);
      await expectSl3Certification(result.pdfBytes!, pdf.getPageCount(), orientation);
      const certificationText = text.split('\f').filter((page) => page.trim()).at(-1)!;
      expect(certificationText).not.toContain('INVENTORY CERTIFICATION');
      expect(certificationText).not.toContain('Marine Corps Stocklist');
      expect(certificationText.match(/SL-3-12345A/g)).toHaveLength(1);
      expect(certificationText).toContain('certifying/supervising inventory)');
      expect(
        pdf
          .getPages()
          .some((p) => p.getWidth() === 792 && p.getHeight() === 792),
      ).toBe(orientation === 'landscape');
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
        .find(
          (page) =>
            page.includes('>Periodic</word>') &&
            page.includes('>COMPONENT,</word>'),
        )!;
      const wordX = (word: string, rightmost = false) => {
        const values = [
          ...inventoryPage.matchAll(
            new RegExp(`<word xMin="([0-9.]+)"[^>]*>${word}</word>`, 'g'),
          ),
        ].map((match) => Number(match[1]));
        return rightmost ? Math.max(...values) : values[0];
      };
      expect(wordX('NSN')).toBeCloseTo(wordX('5120-01-542-7445'), 1);
      expect(wordX('COMPONENT,') - wordX('5120-01-542-7445')).toBeCloseTo(
        SL3_INVENTORY_GRID[orientation][1] / 20,
        1,
      );
      expect(wordX('EA', true) - wordX('COMPONENT,')).toBeCloseTo(
        SL3_INVENTORY_GRID[orientation][2] / 20,
        1,
      );
      // A landscape page must use its wider text area as well as a rotated
      // media box; geometry can otherwise silently restore portrait sizing.
      expect(wordX('NSN')).toBeGreaterThan(
        orientation === 'landscape' ? 65 : 95,
      );
      expect(wordX('NSN')).toBeLessThan(orientation === 'landscape' ? 70 : 105);
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
    data.fieldingPlanReference = "Synthetic Fielding Plan, 30 October 2026";
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
    const parentPage = pages.find((page) => page.includes('015:'))!;
    const firstSheet = pages.find(
      (page) =>
        page.includes('Table 1.') &&
        page.includes('SUPPLY SYSTEM') &&
        !page.includes('TABLE OF CONTENTS'),
    )!;
    expect(firstSheet).toBeDefined();
    expect(firstSheet).not.toContain('015:');
    expect(parentPage).toContain('016;');
    expect(parentPage).toContain('4 - COMPONENT');
    expect(pages.join(' ')).toContain(
      'Inventory the parent and its handle together.',
    );
    expect(pages.join(' ')).toContain('Model');
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

  it('refuses a tall sheet instead of separating it from its illustrations, and accepts fewer rows per sheet', async () => {
    const store = sl3Fixture(15);
    for (const item of store.formData.sl3!.components) {
      item.description =
        'Synthetic description with several details for an inventory component. '.repeat(
          4,
        );
    }
    const refused = await compileFixture(store);
    expect(refused.ok).toBe(false);
    expect(refused.errors.join(' ')).toContain(
      'Inventory sheet exceeds one page',
    );
    store.formData.sl3!.rowsPerSheet = 4;
    const accepted = await compileFixture(store);
    expect(accepted.ok, accepted.errors.join('\n')).toBe(true);
  }, 60000);

  it.each(['cui', 'secret'] as const)(
    'renders synthetic %s control markings on every page',
    async (level) => {
      const store = sl3Fixture();
      Object.assign(store.formData, {
        classLevel: level,
        cuiDistStatement: 'D',
        distReason: 'Software Documentation',
        distDate: '2026-10-30',
        cuiControlledBy: 'EXAMPLE COMMAND',
        cuiCategory: 'CTI',
        classificationBasis: 'original',
        classifiedBy: 'Synthetic reviewer, Example Program Office',
        classReason: '1.4(a)',
        declassifyOn: '20361030',
      });
      store.formData.sl3!.technicalPortion = level === 'secret' ? 'S' : 'CUI';
      expect(sl3ExportErrors(store)).toEqual([]);
      const result = await compileFixture(store);
      expect(result.ok, result.errors.join('\n') + result.logTail).toBe(true);
      const path = join(result.workDir, `synthetic-${level}.pdf`);
      writeFileSync(path, result.pdfBytes!);
      const pages = spawnSync('pdftotext', ['-layout', path, '-'], {
        encoding: 'utf8',
      })
        .stdout.split('\f')
        .filter((page) => page.trim());
      for (const page of pages) {
        expect(
          page.split(level === 'secret' ? 'SECRET' : 'CUI').length - 1,
        ).toBeGreaterThanOrEqual(2);
      }
      expect(pages[0]).toContain('DESTRUCTION NOTICE');
    },
    60000,
  );
});
