import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFString,
  PDFNumber,
  type PDFPage,
} from 'pdf-lib';

/**
 * Add one empty AcroForm signature field (`/FT /Sig`) at an explicit rectangle
 * on a page of an already-open document. This is the coordinate-driven core:
 * the caller supplies where the field goes, so no text search is involved.
 *
 * The field is exactly what Adobe Acrobat + CAC middleware recognize as an
 * empty, signable signature field — DonDocs embeds the field, the signer
 * applies the cryptographic CAC signature later in Acrobat. This function does
 * NOT sign anything; a browser cannot reach a CAC's private key, and embedding
 * an empty field is benign PDF structure.
 *
 * (The letter path in addSignatureField.ts creates the same structure but
 * positions it by searching the rendered text for the signatory's name — it
 * predates this primitive and could adopt it later.)
 *
 * @param rect [x, y, x2, y2] in PDF points, origin bottom-left.
 * @param name unique AcroForm field name (must be unique in the document).
 */
export function addSignatureFieldToPage(
  pdfDoc: PDFDocument,
  page: PDFPage,
  rect: [number, number, number, number],
  name: string
): void {
  const catalog = pdfDoc.catalog;

  // AcroForm with the signature flags (3 = SignaturesExist | AppendOnly).
  let acroForm = catalog.lookup(PDFName.of('AcroForm')) as PDFDict | undefined;
  if (!acroForm) {
    acroForm = pdfDoc.context.obj({ Fields: [], SigFlags: 3 }) as PDFDict;
    catalog.set(PDFName.of('AcroForm'), acroForm);
  }
  acroForm.set(PDFName.of('SigFlags'), PDFNumber.of(3));

  let fields = acroForm.lookup(PDFName.of('Fields')) as PDFArray | undefined;
  if (!fields) {
    fields = pdfDoc.context.obj([]) as PDFArray;
    acroForm.set(PDFName.of('Fields'), fields);
  }

  const pageRef =
    pdfDoc.context.getObjectRef(page.node) ?? pdfDoc.context.register(page.node);

  // Empty appearance stream so viewers draw a clean, unfilled field box.
  const width = rect[2] - rect[0];
  const height = rect[3] - rect[1];
  const appearance = pdfDoc.context.register(
    pdfDoc.context.stream('q Q', {
      Type: PDFName.of('XObject'),
      Subtype: PDFName.of('Form'),
      FormType: 1,
      BBox: [0, 0, width, height],
    })
  );

  const sigField = pdfDoc.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Sig'),
    T: PDFString.of(name),
    Rect: rect,
    F: 4, // Print
    P: pageRef,
    Border: [0, 0, 0],
    AP: pdfDoc.context.obj({ N: appearance }),
  }) as PDFDict;

  const sigRef = pdfDoc.context.register(sigField);
  fields.push(sigRef);

  let annots = page.node.lookup(PDFName.of('Annots')) as PDFArray | undefined;
  if (!annots) {
    annots = pdfDoc.context.obj([]) as PDFArray;
    page.node.set(PDFName.of('Annots'), annots);
  }
  annots.push(sigRef);
}
