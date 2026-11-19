/** Inspect dimensions before the PDF.js decoder allocates coefficient buffers.
 * PDF image dictionaries cannot be trusted to describe the encoded JPEG size.
 */
function jpegDimensions(bytes: Uint8Array, check: () => void): { width: number; height: number; coefficientBytes: number } {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('JPEG start marker is missing.');
  let offset = 2;
  while (offset < bytes.length) {
    check();
    if (bytes[offset++] !== 0xff) throw new Error('JPEG header is malformed.');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) throw new Error('JPEG header is truncated.');
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (length < 8) throw new Error('JPEG dimensions are missing.');
      const components = bytes[offset + 7];
      if (components < 1 || components > 4 || length !== 8 + components * 3) {
        throw new Error('JPEG components are unsupported.');
      }
      const samplingFactors: { horizontal: number; vertical: number }[] = [];
      for (let component = 0; component < components; component++) {
        const sampling = bytes[offset + 9 + component * 3];
        const horizontal = sampling >> 4, vertical = sampling & 15;
        if (horizontal < 1 || horizontal > 4 || vertical < 1 || vertical > 4) {
          throw new Error('JPEG sampling is unsupported.');
        }
        samplingFactors.push({ horizontal, vertical });
      }
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const maxH = Math.max(...samplingFactors.map(value => value.horizontal));
      const maxV = Math.max(...samplingFactors.map(value => value.vertical));
      const mcusPerLine = Math.ceil(width / 8 / maxH);
      const mcusPerColumn = Math.ceil(height / 8 / maxV);
      // Match PDF.js prepareComponents: every coefficient is Int16, with
      // one padded block per component row, including 4× sampling factors.
      const coefficientBytes = samplingFactors.reduce((total, value) => total
        + 2 * 64 * (mcusPerColumn * value.vertical) * (mcusPerLine * value.horizontal + 1), 0);
      return {
        height, width, coefficientBytes,
      };
    }
    offset += length;
  }
  throw new Error('JPEG frame header is missing or unsupported.');
}

/** Decode for validation only. The assembled vector PDF retains the original
 * encoded image stream, including its colorspace and PDF Decode parameters.
 */
export async function validatePdfJpeg(bytes: Uint8Array, check: () => void, charge: (size: number) => void): Promise<void> {
  try {
    const { width, height, coefficientBytes } = jpegDimensions(bytes, check);
    if (width < 1 || height < 1) throw new Error('JPEG dimensions must be positive.');
    // Include coefficient buffers and small decoder scratch/output allocations
    // before entering the decoder, rather than estimating four bytes per pixel.
    charge(coefficientBytes + 4096);
    const { JpegImage } = await import('pdfjs-dist/image_decoders/pdf.image_decoders.mjs');
    check();
    const image = new JpegImage();
    // Prevent a later DNL marker from reparsing with an unbudgeted height.
    image.parse(bytes, { dnlScanLines: height });
    // Parsing decodes the full frame. One output pixel also exercises the
    // colorspace path without allocating another full-size RGB buffer.
    image.getData({ width: 1, height: 1, isSourcePDF: true });
    check();
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new Error('A JPEG image in this PDF is unreadable or exceeds the preparation limit.', { cause });
  }
}
