import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFNumber, PDFRef } from 'pdf-lib';

// Standard page dimensions (US Letter)
const PAGE_WIDTH = 612;  // 8.5 inches
const PAGE_HEIGHT = 792; // 11 inches

// Signature field marker name (must match LaTeX \hypertarget name)
const SIGNATURE_MARKER_NAME = 'DIGSIG_FIELD_MARKER';

/**
 * Signature field configuration
 */
export interface SignatureFieldConfig {
  /** Field name (must be unique in the document) */
  name?: string;
  /** Width of signature field in points */
  width?: number;
  /** Height of signature field in points */
  height?: number;
}

// Default signature field dimensions
const DEFAULT_CONFIG = {
  name: 'Signature1',
  width: 144, // 2 inches
  height: 36, // 0.5 inches
};

// Fallback position if marker not found
// For typical single-page naval letters, signature is usually around 4-5" from bottom
const FALLBACK_POSITION = {
  x: 306, // 72pt margin + 234pt (3.25") = 306pt from page left edge
  y: 350, // ~4.8" from bottom - typical signature block position
};

/**
 * Finds the signature field marker destination in the PDF.
 * The marker is created by LaTeX using \hypertarget{DIGSIG_FIELD_MARKER}{}
 *
 * @returns Position info or null if not found
 */
function findSignatureMarker(pdfDoc: PDFDocument): { pageIndex: number; x: number; y: number } | null {
  try {
    const catalog = pdfDoc.catalog;

    // Get the Names dictionary
    const namesDict = catalog.lookup(PDFName.of('Names')) as PDFDict | undefined;
    if (!namesDict) {
      console.log('No Names dictionary found in PDF');
      return null;
    }

    // Get the Dests (destinations) name tree
    const destsDict = namesDict.lookup(PDFName.of('Dests')) as PDFDict | undefined;
    if (!destsDict) {
      console.log('No Dests dictionary found in Names');
      return null;
    }

    // The name tree can have Names array directly or Kids for larger trees
    const namesArray = destsDict.lookup(PDFName.of('Names')) as PDFArray | undefined;
    if (!namesArray) {
      console.log('No Names array found in Dests');
      return null;
    }

    // Names array is [name1, dest1, name2, dest2, ...]
    // Search for our marker
    for (let i = 0; i < namesArray.size(); i += 2) {
      const nameObj = namesArray.lookup(i);
      let nameStr: string | null = null;

      if (nameObj instanceof PDFString) {
        nameStr = nameObj.decodeText();
      } else if (nameObj instanceof PDFName) {
        nameStr = nameObj.decodeText();
      }

      if (nameStr === SIGNATURE_MARKER_NAME) {
        // Found our marker! Get the destination
        const destObj = namesArray.lookup(i + 1);

        if (destObj instanceof PDFArray) {
          // Destination format: [page_ref /XYZ left top zoom] or [page_ref /FitH top]
          const pageRef = destObj.get(0);

          // Find page index from reference
          let pageIndex = -1;
          const pages = pdfDoc.getPages();
          for (let p = 0; p < pages.length; p++) {
            if (pages[p].ref === pageRef) {
              pageIndex = p;
              break;
            }
          }

          if (pageIndex === -1) {
            console.log('Could not find page for destination');
            return null;
          }

          // Get coordinates based on destination type
          const destType = destObj.lookup(1);
          if (destType instanceof PDFName) {
            const destTypeName = destType.decodeText();

            if (destTypeName === 'XYZ') {
              // [page /XYZ left top zoom]
              const leftObj = destObj.lookup(2);
              const topObj = destObj.lookup(3);

              const left = leftObj instanceof PDFNumber ? leftObj.asNumber() : FALLBACK_POSITION.x;
              const top = topObj instanceof PDFNumber ? topObj.asNumber() : FALLBACK_POSITION.y;

              // top is from page top in PDF coordinates, convert to bottom-origin
              const pageHeight = pages[pageIndex].getHeight();
              const y = top; // hyperref XYZ uses top coordinate directly

              console.log(`Found signature marker at page ${pageIndex + 1}, x=${left}, y=${y}`);
              return { pageIndex, x: left, y };
            } else if (destTypeName === 'FitH' || destTypeName === 'FitBH') {
              // [page /FitH top] or [page /FitBH top]
              const topObj = destObj.lookup(2);
              const top = topObj instanceof PDFNumber ? topObj.asNumber() : FALLBACK_POSITION.y;

              console.log(`Found signature marker (FitH) at page ${pageIndex + 1}, y=${top}`);
              return { pageIndex, x: FALLBACK_POSITION.x, y: top };
            }
          }
        } else if (destObj instanceof PDFDict) {
          // Could be an indirect destination dictionary
          const d = destObj.lookup(PDFName.of('D')) as PDFArray | undefined;
          if (d) {
            // Recursively handle the destination array
            // For simplicity, just use fallback
            console.log('Found destination dict, using fallback position');
          }
        }

        // Found marker but couldn't parse destination fully
        console.log('Found marker but could not parse destination format');
        return null;
      }
    }

    console.log('Signature marker not found in PDF');
    return null;
  } catch (error) {
    console.error('Error finding signature marker:', error);
    return null;
  }
}

/**
 * Adds an empty digital signature field to a PDF document.
 *
 * This function looks for a marker created by LaTeX (\hypertarget{DIGSIG_FIELD_MARKER}{})
 * to determine the exact position for the signature field. If the marker is not found,
 * it falls back to a default position suitable for military correspondence.
 *
 * The signature field is a proper AcroForm widget that can be signed with
 * Adobe Acrobat, CAC/PIV cards, or other PKI tools.
 *
 * @param pdfBytes - The PDF document as a Uint8Array
 * @param config - Optional configuration for the signature field
 * @returns The modified PDF as a Uint8Array
 */
export async function addSignatureField(
  pdfBytes: Uint8Array,
  config: SignatureFieldConfig = {}
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);

  const {
    name = DEFAULT_CONFIG.name,
    width = DEFAULT_CONFIG.width,
    height = DEFAULT_CONFIG.height,
  } = config;

  // Try to find the signature marker from LaTeX
  const markerPosition = findSignatureMarker(pdfDoc);

  let targetPageIndex: number;
  let x: number;
  let y: number;

  if (markerPosition) {
    // Use marker position - the marker is at the TOP of the signature area
    // So the signature field should be placed starting from that Y position going DOWN
    targetPageIndex = markerPosition.pageIndex;
    x = markerPosition.x;
    // The marker Y is at the top of the sig area, field goes downward
    // Subtract height to position field below the marker point
    y = markerPosition.y - height;
    console.log(`Using marker position: page ${targetPageIndex + 1}, x=${x}, y=${y}`);
  } else {
    // Fallback to last page with default position
    const pages = pdfDoc.getPages();
    targetPageIndex = pages.length - 1;
    x = FALLBACK_POSITION.x;
    y = FALLBACK_POSITION.y;
    console.log(`Using fallback position: page ${targetPageIndex + 1}, x=${x}, y=${y}`);
  }

  const pages = pdfDoc.getPages();
  const page = pages[targetPageIndex];
  const pageRef = page.ref;

  // Get or create the AcroForm
  const catalog = pdfDoc.catalog;
  let acroForm = catalog.lookup(PDFName.of('AcroForm')) as PDFDict | undefined;

  if (!acroForm) {
    acroForm = pdfDoc.context.obj({
      Fields: [],
      SigFlags: 3, // SignaturesExist | AppendOnly
    }) as PDFDict;
    catalog.set(PDFName.of('AcroForm'), acroForm);
  } else {
    // Ensure SigFlags is set
    acroForm.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  }

  // Get or create the Fields array
  let fields = acroForm.lookup(PDFName.of('Fields')) as PDFArray | undefined;
  if (!fields) {
    fields = pdfDoc.context.obj([]) as PDFArray;
    acroForm.set(PDFName.of('Fields'), fields);
  }

  // Create the signature field widget annotation
  const sigField = pdfDoc.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Sig'), // Field Type: Signature
    T: PDFString.of(name), // Field name
    Rect: [x, y, x + width, y + height], // Position and size
    F: 4, // Print flag
    P: pageRef, // Parent page reference
    Border: [0, 0, 0], // No visible border
  }) as PDFDict;

  // Create appearance stream for the empty signature field
  const appearanceStream = createEmptySignatureAppearance(pdfDoc, width, height);

  // Set the normal appearance
  const apDict = pdfDoc.context.obj({
    N: appearanceStream,
  }) as PDFDict;
  sigField.set(PDFName.of('AP'), apDict);

  // Add the field to the AcroForm's Fields array
  const sigFieldRef = pdfDoc.context.register(sigField);
  fields.push(sigFieldRef);

  // Add the annotation to the page's Annots array
  let annots = page.node.lookup(PDFName.of('Annots')) as PDFArray | undefined;
  if (!annots) {
    annots = pdfDoc.context.obj([]) as PDFArray;
    page.node.set(PDFName.of('Annots'), annots);
  }
  annots.push(sigFieldRef);

  // Save and return
  return await pdfDoc.save();
}

/**
 * Creates an appearance stream for an empty signature field.
 * Invisible - no border or text, just defines the clickable area.
 */
function createEmptySignatureAppearance(
  pdfDoc: PDFDocument,
  width: number,
  height: number
) {
  // Create an empty/invisible appearance - just the bounding box
  const stream = pdfDoc.context.stream(
    `q Q`, // Empty graphics state - nothing drawn
    {
      Type: PDFName.of('XObject'),
      Subtype: PDFName.of('Form'),
      FormType: 1,
      BBox: [0, 0, width, height],
    }
  );

  return pdfDoc.context.register(stream);
}
