// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { companionSl3 } from '../_helpers/companionSl3';
import { renderToFile } from '../../companion/renderToFile';
import { validateLetter } from '../../companion/validateLetter';
import { expectSl3Certification } from '../_helpers/sl3Certification';
import { pdfRules } from '../_helpers/pdfRules';

type Word = {
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
};
function words(pdf: string): Word[][] {
  const xml = spawnSync('pdftotext', ['-bbox', pdf, '-'], { encoding: 'utf8' });
  expect(xml.status).toBe(0);
  return xml.stdout
    .split('</page>')
    .filter((page) => page.includes('<page '))
    .map((page) =>
      [
        ...page.matchAll(
          /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g,
        ),
      ].map((m) => ({
        left: +m[1],
        top: +m[2],
        right: +m[3],
        bottom: +m[4],
        text: m[5],
      })),
    );
}

describe('SL-3 completed-field spacing', () => {
  it('refuses an authentication whose completed fields exceed one page', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dondocs-sl3-auth-overflow-'));
    const input = companionSl3();
    input.unit!.address = '1234 SYNTHETIC TRAINING AVENUE\n'.repeat(70);
    await expect(renderToFile(input, {}, root)).rejects.toThrow(
      'Authentication exceeds one page',
    );
  }, 60000);

  it.each([
    ['portrait', false],
    ['landscape', false],
    ['portrait', true],
    ['landscape', true],
  ] as const)(
    'fits %s certification with extended fields=%s',
    async (orientation, extended) => {
      const root = await mkdtemp(
        join(tmpdir(), `dondocs-sl3-filled-${orientation}-`),
      );
      const input = companionSl3();
      input.publication!.sl3!.orientation = orientation;
      if (extended) {
        input.publication!.nomenclature =
          'TOOL KIT, PRECISION DIAGNOSTIC EQUIPMENT WITH PORTABLE INTERFACE AND PROTECTIVE TRANSIT CASES';
        input.unit = {
          name: 'MARINE CORPS TRAINING EQUIPMENT AND MAINTENANCE PROGRAM OFFICE',
          address:
            '1234 SYNTHETIC TRAINING AVENUE\nBUILDING 567, SUITE 890\nQUANTICO VA 22134-5678',
        };
        input.signature = {
          first: 'Alexandria-Margaret',
          middle: 'C',
          last: 'Montgomery-Worthington',
          title:
            'Program Manager, Training Equipment and Expeditionary Maintenance Systems',
        };
        input.publication!.controllingOffice =
          'Training Equipment and Expeditionary Maintenance Program Office';
        const endItem = input.publication!.endItems![0];
        input.publication!.endItems = Array.from({ length: 7 }, (_, i) => ({
          ...endItem,
          model: `TRAINING MODEL ${i + 1}`,
        }));
        input.classification = {
          level: 'cui',
          cui: {
            controlledBy: 'EXAMPLE COMMAND',
            category: 'CTI',
            dissemination: 'NOFORN',
          },
        };
        input.publication!.distribution = {
          statement: 'D',
          reason: 'Software Documentation',
          date: '2026-10-30',
        };
        input.publication!.sl3!.technicalPortion = 'CUI';
      }
      expect(validateLetter(input)).toEqual([]);
      const rendered = await renderToFile(input, {}, root);
      const bytes = await readFile(rendered.path);
      const pdf = await PDFDocument.load(bytes);
      const count = pdf.getPageCount();
      await expectSl3Certification(bytes, count, orientation);
      const pages = words(rendered.path);
      const page = pdf.getPages().at(-1)!;
      const lastWords = pages.at(-1)!;
      for (const [index, pageWords] of pages.entries()) {
        for (const word of pageWords) {
          expect(word.left).toBeGreaterThanOrEqual(35.5);
          expect(word.right).toBeLessThanOrEqual(
            pdf.getPage(index).getWidth() - 35.5,
          );
        }
      }
      const captionTop = Math.min(
        ...lastWords
          .filter((w) => ['INVENTORIED', 'SUPERVISED', 'DATE'].includes(w.text))
          .map((w) => w.top),
      );
      const headerWords = lastWords.filter(
        (w) => w.top < captionTop && !['CUI//NOFORN'].includes(w.text),
      );
      expect(
        captionTop - Math.max(...headerWords.map((w) => w.bottom)),
      ).toBeGreaterThan(9);
      for (const word of lastWords) {
        expect(word.left).toBeGreaterThanOrEqual(35.5);
        expect(word.right).toBeLessThanOrEqual(page.getWidth() - 35.5);
      }
      // Compare every word of the wrapped source nomenclature, including its end.
      const headerText = headerWords
        .map((w) => w.text)
        .join(' ')
        .replace(/-\s+/g, '');
      for (const word of input.publication!.nomenclature.split(' '))
        expect(headerText).toContain(word);
      const authIndex = pages.findIndex((p) =>
        p.some((w) => w.text === 'OFFICIAL'),
      );
      expect(authIndex).toBe(extended ? 2 : 1);
      expect(pages[authIndex].some((w) => w.text === 'EDO')).toBe(true);
      const signature = pdf
        .getForm()
        .getField('Signature1')
        .acroField.getWidgets()[0];
      expect(signature.P()?.toString()).toBe(
        pdf.getPage(authIndex).ref.toString(),
      );
      const bounds = signature.getRectangle();
      const official = pages[authIndex].find((w) => w.text === 'OFFICIAL')!;
      const name = pages[authIndex].find(
        (w) =>
          w.top > official.bottom &&
          /(?:MONTGOMERY-WORTHINGTON|EXAMPLE)$/.test(w.text),
      )!;
      const authHeight = pdf.getPage(authIndex).getHeight();
      expect(authHeight - bounds.y - bounds.height).toBeGreaterThan(
        official.bottom,
      );
      expect(authHeight - bounds.y).toBeLessThan(name.top);

      // QA copy simulates filling the paper/PDF writing spaces. These are blank
      // source-form rows, not application text fields or certificate signatures.
      const rules = await pdfRules(bytes, count);
      const grid = rules
        .filter(
          (r) =>
            r.right - r.left > 100 &&
            r.right - r.left < 400 &&
            Math.abs(r.top - r.bottom) < 0.01,
        )
        .sort((a, b) => b.bottom - a.bottom || a.left - b.left);
      const rows = orientation === 'portrait' ? 20 : 12;
      const pitch = orientation === 'portrait' ? 26.4 : 29.3;
      const offset = orientation === 'portrait' ? 3 : 0; // Skip the top border.
      const font = await pdf.embedFont(StandardFonts.TimesRoman);
      const records: {
        text: string;
        left: number;
        right: number;
        top: number;
        bottom: number;
      }[] = [];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < 3; col++) {
          const rule = grid[offset + row * 3 + col];
          const value =
            col === 0
              ? 'Alexandria M. Montgomery, GySgt'
              : col === 1
                ? 'Christopher J. Worthington, MSgt'
                : '31 October 2026';
          const lines: string[] = [''];
          for (const word of value.split(' ')) {
            const candidate = `${lines.at(-1)} ${word}`.trim();
            if (
              font.widthOfTextAtSize(candidate, 10) >
              rule.right - rule.left - 8
            )
              lines.push(word);
            else lines[lines.length - 1] = candidate;
          }
          expect(lines.length).toBeLessThanOrEqual(2);
          lines.forEach((line, i) => {
            const x = rule.left + 4;
            const y = rule.bottom + 4 + (lines.length - i - 1) * 12;
            const top = y + font.heightAtSize(10, { descender: false });
            expect(top).toBeLessThan(rule.bottom + pitch - 1);
            expect(x + font.widthOfTextAtSize(line, 10)).toBeLessThan(
              rule.right - 3,
            );
            page.drawText(line, { x, y, size: 10, font });
            records.push({
              text: line,
              left: x,
              right: rule.right,
              top: page.getHeight() - rule.bottom - pitch,
              bottom: page.getHeight() - rule.bottom,
            });
          });
        }
      }
      const serial = rules.find(
        (r) =>
          r.right - r.left > 55 &&
          r.right - r.left < 60 &&
          Math.abs(r.top - r.bottom) < 0.01,
      )!;
      expect(serial).toBeDefined();
      expect(font.widthOfTextAtSize('01234567', 10)).toBeLessThan(
        serial.right - serial.left - 4,
      );
      page.drawText('01234567', {
        x: serial.left + 2,
        y: serial.bottom + 2,
        size: 10,
        font,
      });
      const completed = join(root, 'filled-certification.pdf');
      await writeFile(completed, await pdf.save());
      const completedWords = words(completed).at(-1)!;
      expect(
        completedWords.filter((w) => w.text === 'Montgomery,'),
      ).toHaveLength(rows);
      expect(
        completedWords.filter((w) => w.text === 'Worthington,'),
      ).toHaveLength(rows);
      for (const record of records) {
        const rowWords = completedWords.filter(
          (w) =>
            w.left >= record.left - 0.1 &&
            w.left < record.right &&
            w.top >= record.top &&
            w.bottom <= record.bottom,
        );
        expect(rowWords.map((w) => w.text).join('')).toContain(
          record.text.replace(/\s+/g, ''),
        );
      }
      console.log(`Filled ${orientation} extended=${extended}: ${completed}`);
    },
    60000,
  );
});
