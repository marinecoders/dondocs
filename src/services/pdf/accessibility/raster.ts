import { PDFArray, PDFContext, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFString } from 'pdf-lib';
import { Inflate } from 'pako';
import { inspectRasterImage } from '@/services/docx/imageAssets';

export const TAGGED_RASTER_LIMITS = { bytes: 10 * 1024 * 1024, pixels: 4_194_304, dimension: 4096, totalPixels: 8_388_608, totalBytes: 32 * 1024 * 1024 } as const;
export interface PdfRasterBinding {
  width: number;
  height: number;
  encoding: 'dct' | 'rgb';
  digest: string;
  alphaDigest?: string;
}

export function createRasterDecodeBudget(): { reserve(width: number, height: number): void } {
  let pixels = 0;
  return { reserve(width, height) {
    dimensions(width, height);
    pixels += width * height;
    if (pixels > TAGGED_RASTER_LIMITS.totalPixels) throw new Error('Tagged images exceed the combined 8 megapixel decode limit.');
  } };
}

/** One export owns one session. Identical source assets decode once even when
 * multiple semantic figures use them; aggregate caps precede decoder copies. */
export function createRasterBindingSession() {
  const pending = new Map<string, Promise<PdfRasterBinding>>();
  const budget = createRasterDecodeBudget();
  let sourceBytes = 0;
  let inFlightBytes = 0;
  return { async prepare(input: Uint8Array, type: 'image/png' | 'image/jpeg'): Promise<PdfRasterBinding> {
    const inputLength = input.length;
    if (!inputLength || inputLength > TAGGED_RASTER_LIMITS.bytes) throw new Error('Tagged images must be at most 10 MiB.');
    if (inFlightBytes + inputLength > TAGGED_RASTER_LIMITS.totalBytes) throw new Error('Tagged simultaneous image inputs exceed 32 MiB.');
    inFlightBytes += inputLength;
    try {
      const owned = new Uint8Array(input);
      const key = `${type}:${await digest(owned)}`;
      let result = pending.get(key);
      if (!result) {
        if (sourceBytes + owned.length > TAGGED_RASTER_LIMITS.totalBytes) throw new Error('Tagged image sources exceed 32 MiB combined.');
        sourceBytes += owned.length;
        result = preparePdfRasterBinding(owned, type, budget);
        pending.set(key, result);
      }
      return await result;
    } finally { inFlightBytes -= inputLength; }
  } };
}

export function inflateBounded(input: Uint8Array, limit: number): Uint8Array {
  const inflate = new Inflate({ chunkSize: 64 * 1024 });
  const chunks: Uint8Array[] = [];
  let length = 0;
  let complete = false;
  inflate.onData = chunk => {
    if (typeof chunk === 'string') throw new Error('Unexpected text raster decoder.');
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    length += bytes.length;
    if (length > limit) throw new Error('Decoded PDF data exceeds its qualified size limit.');
    chunks.push(bytes);
  };
  inflate.onEnd = status => { if (status !== 0) throw new Error('Malformed compressed PDF data.'); complete = true; };
  if (!inflate.push(input, true) || !complete) throw new Error('Malformed compressed PDF data.');
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

function dimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width > TAGGED_RASTER_LIMITS.dimension || height > TAGGED_RASTER_LIMITS.dimension
    || width * height > TAGGED_RASTER_LIMITS.pixels) throw new Error('Tagged images must be at most 4 megapixels and 4096 pixels on either side.');
}

/** Bound every PNG inflation path before calling an image decoder. In particular,
 * IHDR dimensions alone do not bound malformed IDAT data or compressed metadata. */
export function preflightPng(bytes: Uint8Array, budget = createRasterDecodeBudget()): void {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || signature.some((byte, index) => bytes[index] !== byte)) throw new Error('Choose a valid PNG image.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16); const height = view.getUint32(20);
  budget.reserve(width, height);
  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  if (view.getUint32(8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR'
    || bytes[24] !== 8 || !channels[bytes[25]] || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0) throw new Error('Tagged images require a non-interlaced 8-bit PNG or a JPEG.');
  const parts: Uint8Array[] = [];
  let size = 0; let at = 8; let count = 0; let ended = false;
  while (at < bytes.length) {
    if (++count > 20_000 || at + 12 > bytes.length) throw new Error('Malformed PNG chunk sequence.');
    const length = view.getUint32(at);
    if (length > bytes.length - at - 12) throw new Error('Truncated PNG image.');
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (!/^[A-Za-z]{4}$/.test(type) || (type === 'IHDR' && at !== 8)) throw new Error('Ambiguous PNG header sequence.');
    if (type[0] === type[0].toUpperCase() && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type)) throw new Error('Unknown critical PNG image chunk.');
    if (type === 'PLTE' && (length > 768 || length % 3)) throw new Error('Invalid PNG palette.');
    if (type === 'tRNS' && length > 256) throw new Error('Invalid PNG transparency data.');
    if (['acTL', 'fcTL', 'fdAT', 'iCCP', 'zTXt', 'iTXt'].includes(type)) throw new Error('Re-save this image without animation, compressed text or an embedded color profile before tagged export.');
    if (type === 'IDAT') { parts.push(bytes.subarray(at + 8, at + 8 + length)); size += length; }
    at += length + 12;
    if (type === 'IEND') { if (length || at !== bytes.length) throw new Error('Invalid PNG ending.'); ended = true; break; }
  }
  if (!size || !ended) throw new Error('PNG image data or ending is missing.');
  const compressed = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { compressed.set(part, offset); offset += part.length; }
  const expected = height * (width * channels[bytes[25]] + 1);
  if (inflateBounded(compressed, expected).length !== expected) throw new Error('PNG image samples do not match its declared dimensions.');
}

function number(dict: PDFDict, key: string, fallback?: number): number {
  const value = dict.lookupMaybe(PDFName.of(key), PDFNumber)?.asNumber() ?? fallback;
  if (value === undefined || !Number.isSafeInteger(value)) throw new Error(`Invalid PDF image ${key}.`);
  return value;
}

function samples(stream: PDFRawStream, width: number, height: number, channels: number): Uint8Array {
  const rowBytes = width * channels;
  const filter = stream.dict.lookupMaybe(PDFName.of('Filter'), PDFName)?.asString();
  if (filter && filter !== '/FlateDecode') throw new Error('This PDF image filter is not qualified for tagged output.');
  const params = stream.dict.lookupMaybe(PDFName.of('DecodeParms'), PDFDict);
  const predictor = params ? number(params, 'Predictor', 1) : 1;
  if (params && (number(params, 'Colors', channels) !== channels || number(params, 'Columns', width) !== width || number(params, 'BitsPerComponent', 8) !== 8)) throw new Error('PDF image predictor dimensions do not match the image.');
  if (predictor !== 1 && (predictor < 10 || predictor > 15)) throw new Error('This PDF image predictor is not qualified for tagged output.');
  const expected = height * (rowBytes + (predictor === 1 ? 0 : 1));
  const decoded = filter ? inflateBounded(stream.contents, expected) : stream.contents;
  if (decoded.length !== expected) throw new Error('PDF image sample length does not match its dimensions.');
  if (predictor === 1) return decoded;
  const result = new Uint8Array(rowBytes * height);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c; const da = Math.abs(p - a); const db = Math.abs(p - b); const dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  for (let row = 0; row < height; row++) {
    const type = decoded[row * (rowBytes + 1)];
    if (type > 4 || (predictor < 15 && type !== predictor - 10)) throw new Error('Invalid PNG predictor row in PDF image.');
    for (let column = 0; column < rowBytes; column++) {
      const index = row * rowBytes + column;
      const left = column >= channels ? result[index - channels] : 0;
      const above = row ? result[index - rowBytes] : 0;
      const corner = row && column >= channels ? result[index - rowBytes - channels] : 0;
      const value = type === 0 ? 0 : type === 1 ? left : type === 2 ? above : type === 3 ? Math.floor((left + above) / 2) : paeth(left, above, corner);
      result[index] = decoded[row * (rowBytes + 1) + column + 1] + value;
    }
  }
  return result;
}

function defaultDecode(dict: PDFDict, channels: number, indexed = false): void {
  const decode = dict.lookupMaybe(PDFName.of('Decode'), PDFArray);
  if (!decode) return;
  if (decode.size() !== channels * 2 || decode.asArray().some((value, index) => !(value instanceof PDFNumber)
    || value.asNumber() !== (index % 2 ? indexed ? 255 : 1 : 0))) throw new Error('Non-default PDF image sample transforms need separate qualification.');
}

/** Fingerprints the actual resource selected by a page's Do operator. */
export async function fingerprintPdfRaster(context: PDFContext, image: PDFRawStream, budget = createRasterDecodeBudget()): Promise<PdfRasterBinding> {
  const dict = image.dict;
  if (dict.lookupMaybe(PDFName.of('Subtype'), PDFName)?.asString() !== '/Image' || dict.has(PDFName.of('ImageMask'))
    || ['Alternates', 'OPI', 'SMaskInData', 'Matte'].some(key => dict.has(PDFName.of(key)))) throw new Error('This PDF image resource is not qualified.');
  const width = number(dict, 'Width'); const height = number(dict, 'Height');
  budget.reserve(width, height);
  if (number(dict, 'BitsPerComponent') !== 8) throw new Error('Tagged image resources require 8-bit samples.');
  const filter = dict.lookupMaybe(PDFName.of('Filter'), PDFName)?.asString();
  if (filter === '/DCTDecode') {
    const color = dict.lookupMaybe(PDFName.of('ColorSpace'), PDFName)?.asString();
    if (!['/DeviceRGB', '/DeviceGray'].includes(color ?? '') || ['DecodeParms', 'SMask', 'Mask'].some(key => dict.has(PDFName.of(key)))) throw new Error('This JPEG color, decoding or mask format needs separate qualification.');
    defaultDecode(dict, color === '/DeviceGray' ? 1 : 3);
    if (image.contents.length > TAGGED_RASTER_LIMITS.bytes) throw new Error('The JPEG resource exceeds 10 MiB.');
    // Identical DCT bytes can paint different colors under another color space.
    // Bind the qualified default interpretation without copying the JPEG again.
    const interpretation = new TextEncoder().encode(`DCTDecode:${color}:${await digest(image.contents)}`);
    return { width, height, encoding: 'dct', digest: await digest(interpretation) };
  }
  const color = dict.get(PDFName.of('ColorSpace'));
  const resolvedColor = color && context.lookup(color);
  let channels: number; let palette: Uint8Array | undefined;
  if (resolvedColor instanceof PDFName && resolvedColor.asString() === '/DeviceRGB') channels = 3;
  else if (resolvedColor instanceof PDFName && resolvedColor.asString() === '/DeviceGray') channels = 1;
  else if (resolvedColor instanceof PDFArray && resolvedColor.size() === 4
    && resolvedColor.lookup(0, PDFName).asString() === '/Indexed' && resolvedColor.lookup(1, PDFName).asString() === '/DeviceRGB') {
    const entries = resolvedColor.lookup(2, PDFNumber).asNumber() + 1;
    if (!Number.isSafeInteger(entries) || entries < 1 || entries > 256) throw new Error('Invalid indexed PDF image palette.');
    const lookup = context.lookup(resolvedColor.get(3));
    if (lookup instanceof PDFHexString || lookup instanceof PDFString) palette = lookup.asBytes();
    else if (lookup instanceof PDFRawStream && !lookup.dict.has(PDFName.of('DecodeParms'))) {
      const paletteFilter = lookup.dict.lookupMaybe(PDFName.of('Filter'), PDFName)?.asString();
      if (paletteFilter && paletteFilter !== '/FlateDecode') throw new Error('Unsupported PDF image palette filter.');
      palette = paletteFilter ? inflateBounded(lookup.contents, 768) : lookup.contents;
    }
    if (!palette || palette.length !== entries * 3) throw new Error('Invalid PDF image palette bytes.');
    channels = 1;
  } else throw new Error('This PDF image color space is not qualified.');
  defaultDecode(dict, channels, !!palette);
  const raw = samples(image, width, height, channels);
  const rgb = new Uint8Array(width * height * 3);
  const alpha = new Uint8Array(width * height).fill(255);
  if (!palette && channels === 3) rgb.set(raw);
  else for (let index = 0; index < width * height; index++) {
    const target = index * 3;
    if (palette) {
      const at = raw[index] * 3;
      if (at + 2 >= palette.length) throw new Error('PDF image sample exceeds its palette.');
      rgb[target] = palette[at]; rgb[target + 1] = palette[at + 1]; rgb[target + 2] = palette[at + 2];
    } else rgb[target] = rgb[target + 1] = rgb[target + 2] = raw[index];
  }
  const mask = dict.lookupMaybe(PDFName.of('Mask'), PDFArray);
  const softMask = dict.get(PDFName.of('SMask'));
  if (mask && softMask) throw new Error('Combined PDF image masks are not qualified.');
  if (mask) {
    if (mask.size() !== channels * 2) throw new Error('Invalid PDF image color-key mask.');
    const ranges = mask.asArray().map(value => { if (!(value instanceof PDFNumber)) throw new Error('Invalid PDF image mask range.'); return value.asNumber(); });
    if (ranges.some((value, index) => !Number.isInteger(value) || value < 0 || value > 255 || (index % 2 && value < ranges[index - 1]))) throw new Error('Invalid PDF image mask range.');
    for (let i = 0; i < alpha.length; i++) {
      let transparent = true;
      for (let c = 0; c < channels; c++) {
        const value = raw[i * channels + c];
        if (value < ranges[c * 2] || value > ranges[c * 2 + 1]) { transparent = false; break; }
      }
      if (transparent) alpha[i] = 0;
    }
  }
  if (softMask) {
    const stream = context.lookup(softMask);
    if (!(stream instanceof PDFRawStream) || stream.dict.lookupMaybe(PDFName.of('Subtype'), PDFName)?.asString() !== '/Image'
      || stream.dict.lookupMaybe(PDFName.of('ColorSpace'), PDFName)?.asString() !== '/DeviceGray'
      || number(stream.dict, 'Width') !== width || number(stream.dict, 'Height') !== height || number(stream.dict, 'BitsPerComponent') !== 8
      || ['SMask', 'Mask', 'Matte', 'ImageMask'].some(key => stream.dict.has(PDFName.of(key)))) throw new Error('This PDF image alpha mask is not qualified.');
    defaultDecode(stream.dict, 1);
    alpha.set(samples(stream, width, height, 1));
  }
  return { width, height, encoding: 'rgb', digest: await digest(rgb), alphaDigest: await digest(alpha) };
}

export async function preparePdfRasterBinding(input: Uint8Array, type: 'image/png' | 'image/jpeg', budget = createRasterDecodeBudget()): Promise<PdfRasterBinding> {
  if (!input.length || input.length > TAGGED_RASTER_LIMITS.bytes) throw new Error('Tagged images must be at most 10 MiB.');
  const owned = new Uint8Array(input);
  if (type === 'image/png') preflightPng(owned, budget);
  // The JPEG embedder only reads headers; PNG decoding was fully bounded above.
  const pdf = await PDFDocument.create();
  const image = type === 'image/png' ? await pdf.embedPng(owned) : await pdf.embedJpg(owned);
  if (type === 'image/jpeg') budget.reserve(image.width, image.height);
  await inspectRasterImage(owned, type);
  await image.embed();
  const stream = pdf.context.lookup(image.ref);
  if (!(stream instanceof PDFRawStream)) throw new Error('The source raster could not be materialized.');
  return fingerprintPdfRaster(pdf.context, stream, { reserve: dimensions });
}
