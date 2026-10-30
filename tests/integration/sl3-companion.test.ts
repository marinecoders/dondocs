// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString } from 'pdf-lib';
import { spawnSync } from 'node:child_process';
import { companionSl3 } from '../_helpers/companionSl3';
import { letterSchema } from '../../companion/letterSchema';
import { validateLetter } from '../../companion/validateLetter';
import { renderToFile } from '../../companion/renderToFile';

describe('SL-3 production export', () => {
  it('validates and exports with illustrations, working destinations and front authentication', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dondocs-sl3-export-'));
    const input = companionSl3();
    const id = 'A'.repeat(32);
    input.publication!.sl3!.endItemFigureId = id;
    input.publication!.sl3!.components[0].figureId = id;
    input.publication!.sl3!.notes = [
      {
        id: 'note',
        text: 'Use the training illustration.',
        portionMarking: 'U',
      },
    ];
    input.publication!.sl3!.components[0].noteIds = ['note'];
    input.paragraphs = [
      {
        text: 'Training illustration',
        referenceId: id,
        figure: { fileId: 'drawing' },
      },
    ];
    input.attachments = [
      {
        id: 'drawing',
        name: 'drawing.png',
        mimeType: 'image/png',
        dataBase64: (
          await readFile('public/attachments/usmc-seal.png')
        ).toString('base64'),
      },
    ];
    expect(letterSchema.safeParse(input).success).toBe(true);
    expect(validateLetter(input)).toEqual([]);
    const result = await renderToFile(input, {}, root);
    const pdf = await PDFDocument.load(await readFile(result.path));
    const signature = pdf
      .getForm()
      .getField('Signature1')
      .acroField.getWidgets()[0];
    expect(signature.P()?.toString()).toBe(pdf.getPage(1).ref.toString());
    const pages = spawnSync('pdftotext', [result.path, '-'], {
      encoding: 'utf8',
    }).stdout.split('\f');
    const names = pdf.catalog
      .lookup(PDFName.of('Names'), PDFDict)
      .lookup(PDFName.of('Dests'), PDFDict)
      .lookup(PDFName.of('Names'), PDFArray);
    const destinations = new Map<string, PDFArray>();
    for (let i = 0; i < names.size(); i += 2)
      destinations.set(
        names.lookup(i, PDFString).decodeText(),
        names.lookup(i + 1, PDFArray),
      );
    for (const [name, match] of [
      ['sl3.figure.1', 'Figure 1. Training illustration'],
      ['sl3.note.19', 'Use the training illustration.'],
    ]) {
      const pageIndex = pages.findIndex((text) => text.includes(match));
      expect(pageIndex).toBeGreaterThan(1);
      expect(destinations.get(name)?.get(0).toString()).toBe(
        pdf.getPage(pageIndex).ref.toString(),
      );
    }
    expect(pdf.catalog.get(PDFName.of('Outlines'))).toBeDefined();
  }, 60000);
  it('rejects DOCX and incomplete SL-3 data before rendering', () => {
    const input = companionSl3();
    input.format = 'docx';
    expect(validateLetter(input)).toContain('SL-3 export supports PDF only.');
    input.format = 'pdf';
    input.publication!.sl3 = undefined;
    expect(validateLetter(input).join(' ')).toContain('publication.sl3');
  });
});
