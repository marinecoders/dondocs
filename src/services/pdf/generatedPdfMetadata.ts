import type { PDFDocument, SaveOptions } from 'pdf-lib';

export const GENERATED_PDF_CREATOR = 'DonDocs';
export const PDF_LIB_PRODUCER = 'DonDocs (pdf-lib)';

/** Save a generated PDF or an explicit derivative. Retained originals bypass this path. */
export function saveGeneratedPdf(pdf: PDFDocument, options?: SaveOptions): Promise<Uint8Array> {
  pdf.setCreator(GENERATED_PDF_CREATOR);
  pdf.setProducer(PDF_LIB_PRODUCER);
  return pdf.save(options);
}
