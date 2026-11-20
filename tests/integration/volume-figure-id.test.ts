import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { letterSchema } from '../../companion/letterSchema';
import { validateLetter } from '../../companion/validateLetter';
import { toStore } from '../../companion/letterInput';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';
import { volumeFixture } from '../_helpers/volumeFixture';
import { hasPdfToolchain } from '../_helpers/pdfToolchain';

it.skipIf(!hasPdfToolchain)('renders a valid companion figure with a maximum-length attachment identity', async () => {
  const source = volumeFixture();
  const image = await readFile('tests/fixtures/publication-word/diagram.png');
  const id = 'figure-source-'.padEnd(100, 'x');
  const input = letterSchema.parse({ docType: source.docType, subject: source.formData.subject, volume: source.formData.volume,
    paragraphs: [{ id: 'figure-block', volumeSectionId: 'section-intro', text: 'Retained companion figure caption.', figure: { fileId: id } }],
    attachments: [{ id, name: 'diagram.png', mimeType: 'image/png', dataBase64: image.toString('base64') }],
  });
  expect(validateLetter(input)).toEqual([]);
  const store = toStore(input);
  const generated = generateAllLatexFiles(store);
  const file = generated.figures[0].file;
  const result = await compileFixture(store, { [file]: image });
  expect(result.ok, formatFailure('long figure identity', result)).toBe(true);
  expect((await pdfTextLayout(result.pdfBytes!)).boxes.map(box => box.text).join(' ')).toContain('Retained companion figure caption.');
});
