import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { resolvePublicationDestinations } from '@/services/pdf/publicationDestinations';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { volumeFixture } from '../_helpers/volumeFixture';
import { pdfImages } from '../_helpers/pdfImages';
import { hasPdfToolchain } from '../_helpers/pdfToolchain';

for (const repetitions of [110, 300]) it.skipIf(!hasPdfToolchain)(`places a figure destination at its image after ${repetitions} preceding prose repetitions`, async () => {
  const source = volumeFixture();
  source.paragraphs[0].text = 'Prefix prose retained. '.repeat(repetitions);
  const imageBytes = await readFile('tests/fixtures/publication-word/diagram.png');
  source.paragraphs.push({ id: 'figure-block', volumeSectionId: 'section-intro', text: 'Retained figure caption.', level: 0, figure: { fileRef: { id: 'figure', name: 'diagram.png', size: imageBytes.byteLength, type: 'image/png' }, name: 'diagram.png', type: 'image/png' } });
  const generated = generateAllLatexFiles(source);
  const result = await compileFixture(source, { [generated.figures[0].file]: imageBytes });
  expect(result.ok, formatFailure('figure destination', result)).toBe(true);
  const bytes = await resolvePublicationDestinations(result.pdfBytes!);
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  try {
    const reader = await task.promise;
    const target = await reader.getDestination('volume.node.figure-block');
    const targetPage = await reader.getPageIndex(target![0]);
    const imagePages: number[] = [];
    for (let page = 1; page <= reader.numPages; page++) {
      if ((await (await reader.getPage(page)).getOperatorList()).fnArray.includes(OPS.paintImageXObject)) imagePages.push(page - 1);
    }
    expect(imagePages).toEqual([targetPage]);
    const images = await pdfImages(bytes, targetPage + 1);
    expect(Number(target![3])).toBeGreaterThanOrEqual(images[0].top - 1);
    expect(Number(target![3]) - images[0].top).toBeLessThan(20);
  } finally { await task.destroy(); }
});
