import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFSignature } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { finishCorrespondencePdf } from '@/services/pdf/finishCorrespondencePdf';
import { compileFixture, formatFailure, type TestStore } from '../_helpers/compileLatex';
import { jointLetterFixture } from '../_helpers/jointLetterFixture';
import { describeToolchainRequirement, hasPdfToolchain } from '../_helpers/pdfToolchain';

function letter(docType: string): TestStore {
  return {
    docType,
    formData: {
      docType, department: 'usmc', unitLine1: 'SYNTHETIC TRAINING COMMAND',
      from: 'Commanding Officer, Training Command', to: 'Training Officer',
      date: '21 Nov 26', ssic: '5216', subject: 'SYNTHETIC ASSIGNMENT',
      fontSize: '12pt', fontFamily: 'times', classLevel: 'unclassified',
      signatureType: 'digital', sigFirst: 'Robert', sigLast: 'EXAMPLE',
    },
    paragraphs: [{ id: 'body', text: 'The training officer handles this assignment.', level: 0 }],
    references: [], enclosures: [], copyTos: [], distributions: [],
  };
}

async function render(source: TestStore) {
  const compiled = await compileFixture(source);
  expect(compiled.ok, formatFailure(source.docType, compiled)).toBe(true);
  const generated = generateAllLatexFiles(source);
  const result = await finishCorrespondencePdf(compiled.pdfBytes!, source.docType, source.formData, generated, source.paragraphs);
  expect(result.errors).toEqual([]);
  return result.pdfBytes;
}

async function expectSigners(bytes: Uint8Array, signers: { field: string; surname: string; page?: number }[]) {
  const pdf = await PDFDocument.load(bytes);
  const fields = pdf.getForm().getFields();
  expect(fields.map(field => field.getName())).toEqual(signers.map(signer => signer.field));
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  try {
    const reader = await task.promise;
    const placements = [];
    for (const [index, field] of fields.entries()) {
      expect(field).toBeInstanceOf(PDFSignature);
      expect(field.acroField.getWidgets()).toHaveLength(1);
      const widget = field.acroField.getWidgets()[0];
      const pageIndex = pdf.getPages().findIndex(page => page.ref === widget.P());
      expect(pageIndex).toBeGreaterThanOrEqual(0);
      const signer = signers[index];
      if (signer.page !== undefined) expect(pageIndex).toBe(signer.page);
      const rect = widget.getRectangle();
      const content = await (await reader.getPage(pageIndex + 1)).getTextContent();
      const identified = content.items.some(item => 'str' in item && item.str.includes(signer.surname)
        && Math.abs(item.transform[4] - rect.x) < 24
        && rect.y - item.transform[5] > 0 && rect.y - item.transform[5] < 16);
      expect(identified, `Field for ${signer.surname} above its printed signer on page ${pageIndex + 1}`).toBe(true);
      placements.push({ ...rect, page: pageIndex });
    }
    return placements;
  } finally {
    await task.destroy();
  }
}

describe('automatic digital signature fields on real rendered PDFs', () => {
  describeToolchainRequirement('automatic-signer-fields');

  it.skipIf(!hasPdfToolchain)('places the three command fields in signing order', async () => {
    const source = jointLetterFixture();
    source.formData.signatureType = 'digital';
    // Repeating the middle signer's name in body text must not capture the slot.
    source.paragraphs[0].text = 'C. MIDDLE will coordinate the shared action.';
    const [junior, middle, senior] = await expectSigners(await render(source), [
      { field: 'JuniorSignature', surname: 'JUNIOR' },
      { field: 'MiddleSignature', surname: 'MIDDLE' },
      { field: 'SeniorSignature', surname: 'SENIOR' },
    ]);
    expect(junior.page).toBe(middle.page);
    expect(middle.page).toBe(senior.page);
    expect(junior.x + junior.width).toBeLessThan(middle.x);
    expect(middle.x + middle.width).toBeLessThan(senior.x);
  }, 60_000);

  it.skipIf(!hasPdfToolchain).each(['same_page_endorsement', 'new_page_endorsement'])('places the signer on %s', async docType => {
    const source = letter(docType);
    source.formData.basicLetterId = 'Training Command ltr 5216 of 20 Nov 26';
    source.formData.endorsementOrdinal = 'FIRST';
    let uploaded: Uint8Array<ArrayBuffer> | undefined;
    let before: Uint8Array | undefined;
    if (docType === 'new_page_endorsement') {
      const basic = await PDFDocument.create();
      basic.addPage().drawText('R. EXAMPLE');
      basic.addPage().drawText('BASIC LETTER SECOND PAGE');
      uploaded = new Uint8Array(await basic.save());
      before = uploaded.slice();
      source.formData.basicLetterFile = { name: 'basic.pdf', size: uploaded.length, data: uploaded.buffer };
    }
    await expectSigners(await render(source), [
      { field: 'Signature1', surname: 'EXAMPLE', page: uploaded ? 2 : 0 },
    ]);
    if (uploaded) expect(uploaded).toEqual(before);
  }, 60_000);

  it.skipIf(!hasPdfToolchain).each(['naval_letter', 'standard_letter'])('places distinct fields on appended endorsements in a %s', async docType => {
    const source = letter(docType);
    Object.assign(source.formData, {
      appendEndorsement: true, endorsementBody: 'I accept the assignment.', endorsementSigFirst: 'Robert', endorsementSigLast: 'EXAMPLE',
      additionalEndorsements: [{ id: 'second', endorsementBody: 'Forwarded.', endorsementSigLast: 'TRAINER' },
        { id: 'third', endorsementBody: 'For information.' }],
    });
    const [main, first, second] = await expectSigners(await render(source), [
      { field: 'Signature1', surname: 'EXAMPLE', page: 0 },
      { field: 'FirstEndorsementSignature', surname: 'EXAMPLE', page: 0 },
      { field: 'SecondEndorsementSignature', surname: 'TRAINER', page: 1 },
    ]);
    expect(main.y).toBeGreaterThan(first.y + first.height);
    expect(first.page).toBeLessThan(second.page);
  }, 60_000);

  it.skipIf(!hasPdfToolchain)('follows the first appended endorsement when it must start on a new page', async () => {
    const source = letter('naval_letter');
    Object.assign(source.formData, {
      appendEndorsement: true,
      endorsementBody: Array.from({ length: 15 }, () => 'I accept the duties assigned to the training officer.').join('\n'),
      endorsementSigFirst: 'Pat', endorsementSigLast: 'TRAINER',
    });
    await expectSigners(await render(source), [
      { field: 'Signature1', surname: 'EXAMPLE', page: 0 },
      { field: 'FirstEndorsementSignature', surname: 'TRAINER', page: 1 },
    ]);
  }, 60_000);
});
