import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFNumber } from 'pdf-lib';

// Signature field marker names (must match LaTeX \hypertarget names)
const SIGNATURE_MARKER_NAME = 'DIGSIG_FIELD_MARKER';
const SIGNATURE_MARKER_JUNIOR = 'DIGSIG_FIELD_MARKER_JUNIOR';
const SIGNATURE_MARKER_SENIOR = 'DIGSIG_FIELD_MARKER_SENIOR';

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

// Dual signature positions for MOA/MOU
// Junior (LEFT) signs first, Senior (RIGHT) signs last
// Y=280 positions fields ~3.9" from bottom (typical for signature blocks)
const DUAL_SIGNATURE_POSITIONS = {
  junior: {
    x: 72,  // 1" margin from left edge
    y: 280, // ~3.9" from bottom
  },
  senior: {
    x: 396, // ~5.5" from left (positions right-side signature)
    y: 280, // Same height as junior
  },
};

/**
 * Finds a signature field marker annotation in the PDF.
 * The marker is created by LaTeX using \pdfannot with /Contents containing the marker name.
 *
 * @param pdfDoc - The PDF document
 * @param markerName - The marker name to search for (default: DIGSIG_FIELD_MARKER)
 * @returns Position info and annotation reference, or null if not found
 */
function findSignatureMarker(
  pdfDoc: PDFDocument,
  markerName: string = SIGNATURE_MARKER_NAME
): { pageIndex: number; x: number; y: number; annotRef?: ReturnType<typeof pdfDoc.context.register> } | null {
  try {
    const pages = pdfDoc.getPages();

    // Search through each page's annotations
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const page = pages[pageIndex];
      const annotsObj = page.node.lookup(PDFName.of('Annots'));

      if (!annotsObj || !(annotsObj instanceof PDFArray)) {
        continue;
      }

      // Search through annotations on this page
      for (let i = 0; i < annotsObj.size(); i++) {
        const annotRef = annotsObj.get(i);
        const annot = annotsObj.lookup(i);

        if (!(annot instanceof PDFDict)) {
          continue;
        }

        // Check if this is a Text annotation with our marker content
        const subtype = annot.lookup(PDFName.of('Subtype'));
        if (!(subtype instanceof PDFName) || subtype.decodeText() !== 'Text') {
          continue;
        }

        const contents = annot.lookup(PDFName.of('Contents'));
        if (!contents) {
          continue;
        }

        let contentsStr: string | null = null;
        if (contents instanceof PDFString) {
          contentsStr = contents.decodeText();
        }

        if (contentsStr === markerName) {
          // Found our marker! Get the position from Rect
          const rect = annot.lookup(PDFName.of('Rect'));
          if (rect instanceof PDFArray && rect.size() >= 4) {
            const x1 = rect.lookup(0);
            const y1 = rect.lookup(1);
            const x2 = rect.lookup(2);
            const y2 = rect.lookup(3);

            // Get the coordinates (use lower-left corner as position)
            const x = x1 instanceof PDFNumber ? x1.asNumber() : FALLBACK_POSITION.x;
            const y = y2 instanceof PDFNumber ? y2.asNumber() : FALLBACK_POSITION.y; // Use top of rect

            console.log(`Found marker annotation '${markerName}' at page ${pageIndex + 1}, x=${x}, y=${y}`);
            return { pageIndex, x, y, annotRef: annotRef as ReturnType<typeof pdfDoc.context.register> };
          }
        }
      }
    }

    console.log(`Marker annotation '${markerName}' not found in PDF`);
    return null;
  } catch (error) {
    console.error('Error finding signature marker:', error);
    return null;
  }
}

/**
 * Removes a marker annotation from a page's Annots array.
 */
function removeMarkerAnnotation(
  page: ReturnType<PDFDocument['getPage']>,
  annotRef: ReturnType<PDFDocument['context']['register']>
): void {
  try {
    const annotsObj = page.node.lookup(PDFName.of('Annots'));
    if (annotsObj instanceof PDFArray) {
      // Find and remove the annotation reference
      for (let i = 0; i < annotsObj.size(); i++) {
        if (annotsObj.get(i) === annotRef) {
          annotsObj.remove(i);
          console.log('Removed marker annotation from page');
          break;
        }
      }
    }
  } catch (error) {
    console.warn('Could not remove marker annotation:', error);
  }
}

/**
 * Adds an empty digital signature field to a PDF document.
 *
 * This function looks for a marker annotation created by LaTeX (\pdfannot with
 * DIGSIG_FIELD_MARKER content) to determine the exact position for the signature
 * field. If the marker is not found, it falls back to a default position.
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

  // Try to find the signature marker annotation from LaTeX
  const markerPosition = findSignatureMarker(pdfDoc);

  let targetPageIndex: number;
  let x: number;
  let y: number;

  if (markerPosition) {
    // Use marker position - the marker rect's top Y is our reference
    targetPageIndex = markerPosition.pageIndex;
    x = markerPosition.x;
    // Position field at the marker's location
    y = markerPosition.y - height;
    console.log(`Using marker position: page ${targetPageIndex + 1}, x=${x}, y=${y}`);

    // Remove the marker annotation so it doesn't show in the final PDF
    if (markerPosition.annotRef) {
      const pages = pdfDoc.getPages();
      removeMarkerAnnotation(pages[targetPageIndex], markerPosition.annotRef);
    }
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

/**
 * Adds dual digital signature fields for joint letters, MOA/MOU documents.
 * Junior signs on LEFT (first), Senior signs on RIGHT (last).
 *
 * Looks for DIGSIG_FIELD_MARKER_JUNIOR and DIGSIG_FIELD_MARKER_SENIOR markers
 * placed by LaTeX to determine exact positions. Falls back to hardcoded
 * positions if markers are not found.
 *
 * @param pdfBytes - The PDF document as a Uint8Array
 * @param config - Optional configuration for the signature fields
 * @returns The modified PDF as a Uint8Array
 */
export async function addDualSignatureFields(
  pdfBytes: Uint8Array,
  config: SignatureFieldConfig = {}
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);

  const {
    width = DEFAULT_CONFIG.width,
    height = DEFAULT_CONFIG.height,
  } = config;

  // Try to find the signature markers from LaTeX
  const juniorMarker = findSignatureMarker(pdfDoc, SIGNATURE_MARKER_JUNIOR);
  const seniorMarker = findSignatureMarker(pdfDoc, SIGNATURE_MARKER_SENIOR);

  // Determine positions - use markers if found, otherwise fall back to hardcoded
  let juniorPageIndex: number;
  let juniorX: number;
  let juniorY: number;

  if (juniorMarker) {
    juniorPageIndex = juniorMarker.pageIndex;
    juniorX = juniorMarker.x;
    // Marker Y is at top of sig area, field goes downward
    juniorY = juniorMarker.y - height;
    console.log(`Found junior marker: page ${juniorPageIndex + 1}, x=${juniorX}, y=${juniorY}`);
  } else {
    const pages = pdfDoc.getPages();
    juniorPageIndex = pages.length - 1;
    juniorX = DUAL_SIGNATURE_POSITIONS.junior.x;
    juniorY = DUAL_SIGNATURE_POSITIONS.junior.y;
    console.log(`Junior marker not found, using fallback: page ${juniorPageIndex + 1}, x=${juniorX}, y=${juniorY}`);
  }

  let seniorPageIndex: number;
  let seniorX: number;
  let seniorY: number;

  if (seniorMarker) {
    seniorPageIndex = seniorMarker.pageIndex;
    seniorX = seniorMarker.x;
    // Marker Y is at top of sig area, field goes downward
    seniorY = seniorMarker.y - height;
    console.log(`Found senior marker: page ${seniorPageIndex + 1}, x=${seniorX}, y=${seniorY}`);
  } else {
    const pages = pdfDoc.getPages();
    seniorPageIndex = pages.length - 1;
    seniorX = DUAL_SIGNATURE_POSITIONS.senior.x;
    seniorY = DUAL_SIGNATURE_POSITIONS.senior.y;
    console.log(`Senior marker not found, using fallback: page ${seniorPageIndex + 1}, x=${seniorX}, y=${seniorY}`);
  }

  const pages = pdfDoc.getPages();

  // Remove the marker annotations so they don't show in the final PDF
  if (juniorMarker?.annotRef) {
    removeMarkerAnnotation(pages[juniorPageIndex], juniorMarker.annotRef);
  }
  if (seniorMarker?.annotRef) {
    removeMarkerAnnotation(pages[seniorPageIndex], seniorMarker.annotRef);
  }

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
    acroForm.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  }

  // Get or create the Fields array
  let fields = acroForm.lookup(PDFName.of('Fields')) as PDFArray | undefined;
  if (!fields) {
    fields = pdfDoc.context.obj([]) as PDFArray;
    acroForm.set(PDFName.of('Fields'), fields);
  }

  // Create Junior signature field (LEFT - signs FIRST)
  const juniorPage = pages[juniorPageIndex];
  const juniorPageRef = juniorPage.ref;

  let juniorAnnots = juniorPage.node.lookup(PDFName.of('Annots')) as PDFArray | undefined;
  if (!juniorAnnots) {
    juniorAnnots = pdfDoc.context.obj([]) as PDFArray;
    juniorPage.node.set(PDFName.of('Annots'), juniorAnnots);
  }

  const juniorField = pdfDoc.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Sig'),
    T: PDFString.of('JuniorSignature'),
    Rect: [juniorX, juniorY, juniorX + width, juniorY + height],
    F: 4,
    P: juniorPageRef,
    Border: [0, 0, 0],
  }) as PDFDict;

  const juniorAppearance = createEmptySignatureAppearance(pdfDoc, width, height);
  juniorField.set(PDFName.of('AP'), pdfDoc.context.obj({ N: juniorAppearance }) as PDFDict);

  const juniorFieldRef = pdfDoc.context.register(juniorField);
  fields.push(juniorFieldRef);
  juniorAnnots.push(juniorFieldRef);

  // Create Senior signature field (RIGHT - signs LAST)
  const seniorPage = pages[seniorPageIndex];
  const seniorPageRef = seniorPage.ref;

  let seniorAnnots = seniorPage.node.lookup(PDFName.of('Annots')) as PDFArray | undefined;
  if (!seniorAnnots) {
    seniorAnnots = pdfDoc.context.obj([]) as PDFArray;
    seniorPage.node.set(PDFName.of('Annots'), seniorAnnots);
  }

  const seniorField = pdfDoc.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Sig'),
    T: PDFString.of('SeniorSignature'),
    Rect: [seniorX, seniorY, seniorX + width, seniorY + height],
    F: 4,
    P: seniorPageRef,
    Border: [0, 0, 0],
  }) as PDFDict;

  const seniorAppearance = createEmptySignatureAppearance(pdfDoc, width, height);
  seniorField.set(PDFName.of('AP'), pdfDoc.context.obj({ N: seniorAppearance }) as PDFDict);

  const seniorFieldRef = pdfDoc.context.register(seniorField);
  fields.push(seniorFieldRef);
  seniorAnnots.push(seniorFieldRef);

  console.log(`Added dual signature fields:`);
  console.log(`  Junior: page ${juniorPageIndex + 1}, x=${juniorX}, y=${juniorY}`);
  console.log(`  Senior: page ${seniorPageIndex + 1}, x=${seniorX}, y=${seniorY}`);

  return await pdfDoc.save();
}
