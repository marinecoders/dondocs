/** The installed PDF.js decoder bundle has no generated declaration file. */
declare module 'pdfjs-dist/image_decoders/pdf.image_decoders.mjs' {
  export class JpegImage {
    width: number;
    height: number;
    parse(data: Uint8Array, options?: { dnlScanLines: number }): void;
    getData(options: { width: number; height: number; isSourcePDF: boolean }): Uint8Array | Uint8ClampedArray;
  }
}
