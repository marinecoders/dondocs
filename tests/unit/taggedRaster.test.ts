import { describe, expect, it } from 'vitest';
import { deflate } from 'pako';
import { PDFDocument, PDFHexString, PDFRawStream } from 'pdf-lib';
import sharp from 'sharp';
import { createRasterBindingSession, createRasterDecodeBudget, fingerprintPdfRaster, inflateBounded, preparePdfRasterBinding } from '@/services/pdf/accessibility/raster';

const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DQAAAEgQGALFXOsAAAAABJRU5ErkJggg=='), char => char.charCodeAt(0));

describe('owned tagged raster resources', () => {
  it('decodes an actual PNG and reuses the normalized fingerprint for the same retained asset', async () => {
    const session = createRasterBindingSession();
    const first = await session.prepare(png, 'image/png');
    expect(first).toMatchObject({ width: 1, height: 1, encoding: 'rgb' });
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(await session.prepare(png.slice(), 'image/png')).toBe(first);
  });

  it('reuses a duplicate near the unique source budget while still bounding simultaneous input copies', async () => {
    const base = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#a00000' } }).jpeg().toBuffer();
    const padded = (value: number) => {
      let remaining = 9 * 1024 * 1024;
      const parts = [base.subarray(0, 2)];
      while (remaining) {
        const length = Math.min(65533, remaining); const part = Buffer.alloc(length + 4, value);
        part[0] = 0xff; part[1] = 0xef; part.writeUInt16BE(length + 2, 2);
        parts.push(part); remaining -= length;
      }
      parts.push(base.subarray(2)); return new Uint8Array(Buffer.concat(parts));
    };
    const images = [padded(65), padded(66), padded(67)]; const session = createRasterBindingSession();
    const first = await session.prepare(images[0], 'image/jpeg');
    await session.prepare(images[1], 'image/jpeg'); await session.prepare(images[2], 'image/jpeg');
    expect(await session.prepare(images[0], 'image/jpeg')).toBe(first);
    const concurrent = createRasterBindingSession();
    const results = await Promise.allSettled([65, 66, 67, 68].map(value => concurrent.prepare(padded(value), 'image/jpeg')));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(3);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: expect.objectContaining({ message: expect.stringContaining('simultaneous') }) });
  });

  it('rejects oversized dimensions before PNG decoding and refuses compressed expansion beyond its declared sample budget', async () => {
    const tooWide = png.slice(); new DataView(tooWide.buffer).setUint32(16, 4097);
    await expect(preparePdfRasterBinding(tooWide, 'image/png')).rejects.toThrow(/4 megapixels/);
    expect(() => inflateBounded(deflate(new Uint8Array(100_000)), 16)).toThrow(/size limit/);
    const budget = createRasterDecodeBudget();
    budget.reserve(2048, 2048); budget.reserve(2048, 2048);
    expect(() => budget.reserve(1, 1)).toThrow(/combined/);
  });

  it('normalizes indexed PNG-predictor samples and transparent alpha to the same actual source pixels', async () => {
    const pdf = await PDFDocument.create();
    const indexed = pdf.context.flateStream(new Uint8Array([0, 0]), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, BitsPerComponent: 8,
      ColorSpace: ['Indexed', 'DeviceRGB', 0, PDFHexString.of('ff0000')], DecodeParms: { Predictor: 15, Colors: 1, Columns: 1, BitsPerComponent: 8 } });
    const rgb = pdf.context.flateStream(new Uint8Array([255, 0, 0]), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, BitsPerComponent: 8, ColorSpace: 'DeviceRGB' });
    expect(await fingerprintPdfRaster(pdf.context, indexed)).toEqual(await fingerprintPdfRaster(pdf.context, rgb));
    const changed = pdf.context.flateStream(new Uint8Array([0, 255, 0]), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, BitsPerComponent: 8, ColorSpace: 'DeviceRGB' });
    expect((await fingerprintPdfRaster(pdf.context, changed)).digest).not.toBe((await fingerprintPdfRaster(pdf.context, rgb)).digest);
    const actual = await pdf.embedPng(png); await actual.embed();
    const stream = pdf.context.lookup(actual.ref);
    expect(stream).toBeInstanceOf(PDFRawStream);
    expect(await fingerprintPdfRaster(pdf.context, stream as PDFRawStream)).toEqual(await preparePdfRasterBinding(png, 'image/png'));
  });

  it('rejects form XObjects, unsupported sample transforms and nested image masks', async () => {
    const pdf = await PDFDocument.create();
    const form = pdf.context.flateStream(new Uint8Array(), { Subtype: 'Form' });
    await expect(fingerprintPdfRaster(pdf.context, form)).rejects.toThrow(/not qualified/);
    const image = (extra: Record<string, unknown>) => pdf.context.flateStream(new Uint8Array([255]), { Subtype: 'Image', Width: 1, Height: 1, BitsPerComponent: 8, ColorSpace: 'DeviceGray', ...extra });
    await expect(fingerprintPdfRaster(pdf.context, image({ Decode: [1, 0] }))).rejects.toThrow(/sample transforms/);
    const mask = pdf.context.register(image({ ImageMask: true }));
    await expect(fingerprintPdfRaster(pdf.context, image({ SMask: mask }))).rejects.toThrow(/alpha mask/);
  });
});
