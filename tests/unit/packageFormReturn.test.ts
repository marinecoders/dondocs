import { expect, it } from 'vitest';
import { bindUnsignedFormPdf } from '@/lib/packageFormReturn';
import { PDFDocument } from 'pdf-lib';

it('distinguishes two copies while retaining PDF offsets and the original prefix', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  const bytes = await pdf.save();
  const prefixLength = bytes.length - 28;
  const first = bindUnsignedFormPdf(bytes, prefixLength, 'a'.repeat(64));
  const second = bindUnsignedFormPdf(bytes, prefixLength, 'b'.repeat(64));
  expect(first.slice(0, prefixLength)).toEqual(bytes.slice(0, prefixLength));
  expect(first).not.toEqual(second);
  expect((await PDFDocument.load(first)).getPageCount()).toBe(1);
  expect(() => bindUnsignedFormPdf(bytes, bytes.length, 'a'.repeat(64))).toThrow('Fill');
});
