// @vitest-environment node
import { expect, it } from 'vitest';
import { sl4Fixture, sl4Artwork } from '../_helpers/sl4Fixture';
import type { LetterInput } from '../../companion/letterInput';
import { toStore } from '../../companion/letterInput';
import { letterSchema } from '../../companion/letterSchema';
import { validateLetter } from '../../companion/validateLetter';
import { validate } from '../../companion/handler';
import { generateAllLatexFiles } from '@/services/latex/generator';

async function input(): Promise<LetterInput> {
  const store = sl4Fixture(), d = store.formData;
  return {
    docType: 'sl4', format: 'pdf', subject: d.subject, date: d.date, pocEmail: d.pocEmail,
    unit: { name: d.unitLine1, address: d.unitAddress }, signature: { first: d.sigFirst, last: d.sigLast, title: d.sigTitle },
    publication: { type: 'SL4', shortTitle: d.shortTitle!, pcn: d.pcn!, nomenclature: d.nomenclature!, controllingOffice: d.controllingOffice!, signingDate: d.publicationSigningDate!, distribution: { statement: 'A' }, endItems: store.endItems, sl4: d.sl4 },
    paragraphs: [{ referenceId: store.paragraphs[0].referenceId, text: store.paragraphs[0].text, figure: { fileId: 'artwork', portionMarking: 'U' } }],
    attachments: [{ id: 'artwork', name: 'training-box.pdf', mimeType: 'application/pdf', dataBase64: Buffer.from(Object.values(await sl4Artwork())[0]).toString('base64') }],
  };
}
it('accepts SL-4 through both transports and uses the same body and preflight', async () => {
  const value = letterSchema.parse(await input());
  expect(validateLetter(value)).toEqual([]);
  expect(validate(value)).toEqual([]);
  const store = toStore(value);
  expect(store.formData.fontSize).toBe('10pt');
  expect(store.formData.sl4).toEqual(value.publication!.sl4);
  expect(generateAllLatexFiles(store).texFiles['body.tex']).toContain('sl4.part.5');
});
it('refuses DOCX, a mismatched type and I-Type content on SL-4', async () => {
  const value = await input();
  expect(validateLetter({ ...value, format: 'docx' }).join(' ')).toContain('SL-4 export supports PDF only');
  value.publication!.type = 'SL3';
  expect(validateLetter(value).join(' ')).toContain('publication.type SL4');
  value.publication!.type = 'SL4';
  value.paragraphs!.push({ text: 'An unsupported body paragraph' });
  expect(validateLetter(value).join(' ')).toContain('structured parts data');
});
it('refuses unknown SL-4 fields instead of silently dropping authored data', async () => {
  const value = await input();
  expect(letterSchema.safeParse({ ...value, publication: { ...value.publication, sl4: { ...value.publication!.sl4, partII: [] } } }).success).toBe(false);
});
