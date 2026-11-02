// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { companionSl3 } from '../_helpers/companionSl3';
import { renderToFile } from '../../companion/renderToFile';
import { validateLetter } from '../../companion/validateLetter';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';

describe('SL-3 text does not collide', () => {
  it('detects the overlapping-column failure independently of the template', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    const font = await pdf.embedFont(StandardFonts.TimesRoman);
    page.drawText('COMMARCORSYSCOM', { x: 72, y: 600, font, size: 10 });
    page.drawText('Commander, Marine Corps Systems Command', {
      x: 148.75,
      y: 600,
      font,
      size: 10,
    });
    expect((await pdfTextLayout(await pdf.save())).collisions).toHaveLength(1);
  });

  it.each([
    ['portrait', false],
    ['landscape', false],
    ['portrait', true],
    ['landscape', true],
  ] as const)(
    'keeps all %s words separate with classified stress=%s',
    async (orientation, stress) => {
      const root = await mkdtemp(join(tmpdir(), 'dondocs-sl3-text-layout-'));
      const input = companionSl3();
      input.publication!.sl3!.orientation = orientation;
      if (stress) {
        input.classification = {
          level: 'secret',
          basis: 'original',
          classifiedBy: 'Synthetic reviewer, Example Office',
          reason: '1.4(a)',
          declassifyOn: '20361031',
        };
        input.publication!.distribution = {
          statement: 'D',
          reason: 'Software Documentation',
          date: '2026-10-30',
        };
        input.publication!.nomenclature =
          'TOOL KIT, PRECISION DIAGNOSTIC EQUIPMENT WITH PORTABLE INTERFACE AND PROTECTIVE TRANSIT CASES';
        input.unit = {
          name: 'MARINE CORPS TRAINING EQUIPMENT AND MAINTENANCE PROGRAM OFFICE',
          address: '1234 SYNTHETIC TRAINING AVENUE, QUANTICO VA 22134-5678',
        };
        input.signature = {
          first: 'Alexandria-Margaret',
          middle: 'C',
          last: 'Montgomery-Worthington',
          title:
            'Program Manager, Training Equipment and Expeditionary Maintenance Systems',
        };
        const endItem = input.publication!.endItems![0];
        input.publication!.endItems = Array.from({ length: 7 }, (_, i) => ({
          ...endItem,
          model: `TRAINING MODEL ${i + 1}`,
        }));
        input.publication!.sl3!.technicalData =
          'Synthetic equipment dimensions and operating characteristics remain subject to source review. '.repeat(
            30,
          );
        input.publication!.sl3!.showModel = true;
        input.publication!.sl3!.showFigureReference = true;
        input.publication!.sl3!.fieldingPlanReference =
          'Synthetic Fielding Plan, 30 October 2026';
        input.publication!.sl3!.notes = [
          {
            id: 'note',
            text: 'This demonstration note exercises normal wrapping and linked references. '.repeat(
              8,
            ),
            portionMarking: 'U',
          },
        ];
        for (const item of input.publication!.sl3!.components) {
          item.description =
            'A synthetic removable maintenance assembly with a protective storage sleeve and calibrated steel adapter.';
          item.model = 'TRAINING-MODEL-2026';
          item.figureReference = 'REFERENCE-DESIGNATOR-01';
          item.noteIds = ['note'];
        }
        const figureId = 'A'.repeat(32);
        input.publication!.sl3!.components[0].figureId = figureId;
        input.publication!.sl3!.artwork = [
          {
            figureId,
            lettering: 'labels',
            labels: [
              { id: 'inlet', text: 'VALVE INLET', x: 25, y: 65 },
              { id: 'outlet', text: 'VALVE OUTLET', x: 75, y: 65 },
            ],
          },
        ];
        input.paragraphs = [
          {
            referenceId: figureId,
            portionMarking: 'U',
            text: 'Synthetic training illustration with a longer caption that exercises wrapping inside the available page width',
            figure: { fileId: 'drawing', portionMarking: 'U' },
          },
        ];
        input.attachments = [
          {
            id: 'drawing',
            name: 'drawing.png',
            mimeType: 'image/png',
            dataBase64: (
              await sharp({
                create: {
                  width: 1200,
                  height: 600,
                  channels: 3,
                  background: 'white',
                },
              })
                .png()
                .toBuffer()
            ).toString('base64'),
          },
        ];
        input.publication!.sl3!.definitions = [
          {
            id: 'long',
            term: 'ZZ' + 'W'.repeat(110),
            meaning:
              'A synthetic long code. ' +
              'Wide identifiers need room to wrap without touching adjacent text. '.repeat(
                16,
              ),
            portionMarking: 'S',
          },
          {
            id: 'token',
            term: 'ZZTOKEN',
            meaning: 'A long source identifier: ' + 'MEASUREMENT'.repeat(15),
            portionMarking: 'U',
          },
          {
            id: 'symbol',
            term: 'ZZ Symbol & Applicability',
            meaning:
              'The synthetic symbol applies only to the demonstration configuration.',
            portionMarking: 'U',
          },
        ];
      }
      expect(validateLetter(input)).toEqual([]);
      const result = await renderToFile(input, {}, root);
      await writeFile(join(root, 'case.json'), JSON.stringify({orientation, stress, input}, null, 2));
      const { boxes, collisions } = await pdfTextLayout(
        await readFile(result.path),
      );
      expect(
        collisions,
        JSON.stringify(collisions.slice(0, 6), null, 2),
      ).toEqual([]);
      const term = boxes.find(
        (box) =>
          box.text.includes('COMMARCORSYSCOM') &&
          boxes.some((b) => b.page === box.page && b.text === 'ABBREVIATIONS'),
      )!;
      expect(term).toBeDefined();
      const meaning = boxes.find(
        (b) =>
          b.page === term.page &&
          b.text.includes('Commander, Marine Corps Systems Command'),
      )!;
      expect(meaning).toBeDefined();
      expect(meaning.left - term.right).toBeGreaterThan(10);
      if (stress) {
        const content = boxes.map((box) => box.text).join('').replace(/\s+/g, '');
        expect(content).toContain('ZZ' + 'W'.repeat(110));
        expect(content).toContain('MEASUREMENT'.repeat(15));
        expect(content).toContain('ZZSymbol&Applicability');
      }
      const pdf = await PDFDocument.load(await readFile(result.path));
      for (const box of boxes) {
        const page = pdf.getPage(box.page - 1);
        expect(box.left, box.text).toBeGreaterThanOrEqual(17.5);
        expect(box.right, box.text).toBeLessThanOrEqual(page.getWidth() - 17.5);
        expect(box.bottom, box.text).toBeGreaterThanOrEqual(35.5);
        expect(box.top, box.text).toBeLessThanOrEqual(page.getHeight() - 35.5);
      }
    },
    60000,
  );
  it('refuses a definition that cannot fit on a page', async () => {
    const input = companionSl3();
    input.publication!.sl3!.definitions = [
      {
        id: 'oversized',
        term: 'ZZLONG',
        meaning: 'A very long explanation with too much detail. '.repeat(600),
        portionMarking: 'U',
      },
    ];
    const root = await mkdtemp(join(tmpdir(), 'dondocs-sl3-text-overflow-'));
    await expect(renderToFile(input, {}, root)).rejects.toThrow(
      'An abbreviation definition exceeds one page',
    );
  }, 60000);
});
