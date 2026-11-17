import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import sharp from 'sharp';
import { preparePdfRasterBinding } from '@/services/pdf/accessibility/raster';
import { finishTaggedPdf, type PdfTaggingPlan } from '@/services/pdf/accessibility/taggedPdf';
import { validateGeneratedTaggedPdf } from '@/services/pdf/accessibility/validate';

const nonce = 'a'.repeat(32);
async function fixture(grayscale = false) {
  let source = sharp({ create: { width: 4, height: 4, channels: 3, background: '#d03020' } });
  if (grayscale) source = source.toColourspace('b-w');
  const bytes = new Uint8Array(await source.jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toBuffer());
  const binding = await preparePdfRasterBinding(bytes, 'image/jpeg');
  const pdf = await PDFDocument.create(), page = pdf.addPage([64, 64]), image = await pdf.embedJpg(bytes);
  await image.embed();
  const stream = pdf.context.lookup(image.ref);
  if (!(stream instanceof PDFRawStream)) throw new Error('Missing actual embedded JPEG.');
  page.node.set(PDFName.of('Resources'), pdf.context.obj({ XObject: { Im1: image.ref } }));
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(`/DDTag << /N <${nonce}> /I 1 /B true >> DP\nq 64 0 0 64 0 0 cm /Im1 Do Q\n/DDTag << /N <${nonce}> /I 1 /B false >> DP`)));
  const plan: PdfTaggingPlan = { nonce, title: 'Synthetic JPEG interpretation', language: 'en-US', nodes: [{ id: 1, role: 'Figure', altText: 'A red training square' }], images: { 1: binding } };
  return { pdf, stream, plan, bytes };
}

describe('source-bound JPEG interpretation', () => {
  it.each(['color-space', 'color-transform'] as const)('rejects changed %s even when JPEG bytes and dimensions are identical', async change => {
    const { pdf, stream, plan, bytes } = await fixture();
    expect(stream.contents).toEqual(bytes);
    const original = await finishTaggedPdf(await pdf.save(), plan);
    expect(await validateGeneratedTaggedPdf(original.bytes)).toMatchObject({ figures: 1, paintedOperations: 1 });
    if (change === 'color-space') stream.dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceGray'));
    else stream.dict.set(PDFName.of('DecodeParms'), pdf.context.obj({ ColorTransform: 0 }));
    expect(stream.contents).toEqual(bytes);
    await expect(finishTaggedPdf(await pdf.save(), plan)).rejects.toThrow(/JPEG|owned source/);
  });

  it.each([false, true])('retains the qualified default RGB/grayscale profile and identity Decode (%s)', async grayscale => {
    const { pdf, stream, plan } = await fixture(grayscale);
    expect(stream.dict.lookup(PDFName.of('ColorSpace'), PDFName).asString()).toBe(grayscale ? '/DeviceGray' : '/DeviceRGB');
    expect(stream.dict.has(PDFName.of('DecodeParms'))).toBe(false);
    stream.dict.set(PDFName.of('Decode'), pdf.context.obj(grayscale ? [0, 1] : [0, 1, 0, 1, 0, 1]));
    const output = await finishTaggedPdf(await pdf.save(), plan);
    expect(await validateGeneratedTaggedPdf(output.bytes)).toMatchObject({ figures: 1, paintedOperations: 1 });
  });
});
