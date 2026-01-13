import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFNumber, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

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
  /** Signatory name to search for (for text-based positioning) */
  signatoryName?: string;
}

/**
 * Dual signature field configuration
 */
export interface DualSignatureFieldConfig extends SignatureFieldConfig {
  /** Junior signatory name to search for */
  juniorSignatoryName?: string;
  /** Senior signatory name to search for */
  seniorSignatoryName?: string;
}

// Default signature field dimensions
const DEFAULT_CONFIG = {
  name: 'Signature1',
  width: 144, // 2 inches
  height: 36, // 0.5 inches
};

// Fallback position if text not found
// For typical single-page naval letters, signature is usually around 4-5" from bottom
const FALLBACK_POSITION = {
  x: 306, // 72pt margin + 234pt (3.25") = 306pt from page left edge
  y: 350, // ~4.8" from bottom - typical signature block position
};

// Dual signature fallback positions for MOA/MOU
// Junior (LEFT) signs first, Senior (RIGHT) signs last
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

// Height of the signature field plus padding above the name
const SIGNATURE_FIELD_OFFSET = 42; // 36pt height + 6pt padding

/**
 * Searches for text in a PDF page's content stream and returns its position.
 * This parses PDF operators to track the text matrix and find specific text.
 *
 * @param page - The PDF page to search
 * @param searchText - The text to search for (case-insensitive partial match)
 * @returns Position {x, y} if found, null otherwise
 */
function findTextInPage(
  page: ReturnType<PDFDocument['getPage']>,
  searchText: string
): { x: number; y: number } | null {
  try {
    // Get the content streams from the page
    const contents = page.node.Contents();
    if (!contents) {
      console.log('No content stream found in page');
      return null;
    }

    // Normalize search text for matching
    const searchUpper = searchText.toUpperCase().trim();
    if (!searchUpper) return null;

    // Collect all content stream data
    let contentData: Uint8Array;

    if (contents instanceof PDFRawStream) {
      contentData = decodePDFRawStream(contents).decode();
    } else if (contents instanceof PDFArray) {
      // Multiple content streams - concatenate them
      const chunks: Uint8Array[] = [];
      for (let i = 0; i < contents.size(); i++) {
        const stream = contents.lookup(i);
        if (stream instanceof PDFRawStream) {
          chunks.push(decodePDFRawStream(stream).decode());
        }
      }
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      contentData = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        contentData.set(chunk, offset);
        offset += chunk.length;
      }
    } else {
      console.log('Unexpected content type');
      return null;
    }

    // Parse the content stream as text
    const contentStr = new TextDecoder('latin1').decode(contentData);

    // Track found position
    let foundPosition: { x: number; y: number } | null = null;

    // Simple regex-based parser for PDF operators
    // This handles common text positioning patterns

    // Pattern for Tm (text matrix): a b c d e f Tm
    // e = x translation, f = y translation
    const tmPattern = /[\d.\-]+\s+[\d.\-]+\s+[\d.\-]+\s+[\d.\-]+\s+([\d.\-]+)\s+([\d.\-]+)\s+Tm/g;

    // Pattern for Td (text position delta): tx ty Td
    const tdPattern = /([\d.\-]+)\s+([\d.\-]+)\s+Td/g;

    // Pattern for text show operators with strings
    // Handles both (text) Tj and [(text)] TJ
    const textPattern = /\(([^)]*)\)\s*Tj|<([^>]+)>\s*Tj|\[\s*\(([^)]*)\)|<([^>]+)>/g;

    // First pass: find all Tm positions and their associated text
    let lastTmY = 0;
    let lastTmX = 0;

    // Split into lines/blocks for better parsing
    const lines = contentStr.split(/\n|BT|ET/);

    for (const block of lines) {
      // Look for Tm operator (text matrix)
      let tmMatch;
      while ((tmMatch = tmPattern.exec(block)) !== null) {
        lastTmX = parseFloat(tmMatch[1]);
        lastTmY = parseFloat(tmMatch[2]);
      }

      // Look for Td operator (relative move)
      let tdMatch;
      while ((tdMatch = tdPattern.exec(block)) !== null) {
        lastTmX += parseFloat(tdMatch[1]);
        lastTmY += parseFloat(tdMatch[2]);
      }

      // Look for text content
      let textMatch;
      while ((textMatch = textPattern.exec(block)) !== null) {
        // Get the text from whichever group matched
        const text = textMatch[1] || textMatch[3] || '';

        // Check if this text contains our search string
        if (text && text.toUpperCase().includes(searchUpper)) {
          console.log(`Found "${searchText}" at position x=${lastTmX}, y=${lastTmY}`);
          foundPosition = { x: lastTmX, y: lastTmY };
          // Continue searching to find the LAST occurrence (closest to bottom of page)
        }
      }

      // Reset pattern lastIndex for next block
      tmPattern.lastIndex = 0;
      tdPattern.lastIndex = 0;
      textPattern.lastIndex = 0;
    }

    return foundPosition;
  } catch (error) {
    console.error('Error finding text in page:', error);
    return null;
  }
}

/**
 * Finds a signatory name in the PDF and returns position for the signature field.
 * Searches through all pages for the text.
 *
 * @param pdfDoc - The PDF document
 * @param signatoryName - The signatory name to search for
 * @returns Position info, or null if not found
 */
function findSignatoryPosition(
  pdfDoc: PDFDocument,
  signatoryName: string
): { pageIndex: number; x: number; y: number } | null {
  if (!signatoryName || !signatoryName.trim()) {
    return null;
  }

  const pages = pdfDoc.getPages();

  // Search each page (typically signature is on last page, so search backwards)
  for (let i = pages.length - 1; i >= 0; i--) {
    const page = pages[i];
    const position = findTextInPage(page, signatoryName);

    if (position) {
      // Position the signature field ABOVE the name
      // y coordinate is the baseline of the text, so add offset
      return {
        pageIndex: i,
        x: position.x,
        y: position.y + SIGNATURE_FIELD_OFFSET,
      };
    }
  }

  console.log(`Signatory name "${signatoryName}" not found in PDF`);
  return null;
}

/**
 * Adds an empty digital signature field to a PDF document.
 *
 * This function searches for the signatory name in the PDF content stream
 * to determine the exact position for the signature field. If the name is
 * not found, it falls back to a default position.
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
    signatoryName,
  } = config;

  let targetPageIndex: number;
  let x: number;
  let y: number;

  // Try to find the signatory name in the PDF content
  const textPosition = signatoryName ? findSignatoryPosition(pdfDoc, signatoryName) : null;

  const catalog = pdfDoc.catalog;
  let acroForm = catalog.lookup(PDFName.of('AcroForm')) as PDFDict | undefined;

  if (textPosition) {
    // Use text-based position - found signatory name in PDF
    targetPageIndex = textPosition.pageIndex;
    x = textPosition.x;
    y = textPosition.y;
    console.log(`Using text-based position for "${signatoryName}": page ${targetPageIndex + 1}, x=${x}, y=${y}`);
  } else {
    // Fallback to last page with default position
    const pages = pdfDoc.getPages();
    targetPageIndex = pages.length - 1;
    x = FALLBACK_POSITION.x;
    y = FALLBACK_POSITION.y;
    console.log(`Signatory name not provided or not found, using fallback position: page ${targetPageIndex + 1}, x=${x}, y=${y}`);
  }

  const pages = pdfDoc.getPages();
  const page = pages[targetPageIndex];
  const pageRef = page.ref;

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
 * Searches for the signatory names in the PDF content stream to determine
 * exact positions. Falls back to hardcoded positions if names are not found.
 *
 * @param pdfBytes - The PDF document as a Uint8Array
 * @param config - Optional configuration for the signature fields
 * @returns The modified PDF as a Uint8Array
 */
export async function addDualSignatureFields(
  pdfBytes: Uint8Array,
  config: DualSignatureFieldConfig = {}
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);

  const {
    width = DEFAULT_CONFIG.width,
    height = DEFAULT_CONFIG.height,
    juniorSignatoryName,
    seniorSignatoryName,
  } = config;

  const catalog = pdfDoc.catalog;
  let acroForm = catalog.lookup(PDFName.of('AcroForm')) as PDFDict | undefined;

  // Try to find the signatory names in the PDF content
  const juniorPosition = juniorSignatoryName ? findSignatoryPosition(pdfDoc, juniorSignatoryName) : null;
  const seniorPosition = seniorSignatoryName ? findSignatoryPosition(pdfDoc, seniorSignatoryName) : null;

  // Determine positions - use text-based positions if found, otherwise fall back to hardcoded
  let juniorPageIndex: number;
  let juniorX: number;
  let juniorY: number;

  if (juniorPosition) {
    juniorPageIndex = juniorPosition.pageIndex;
    juniorX = juniorPosition.x;
    juniorY = juniorPosition.y;
    console.log(`Found junior signatory "${juniorSignatoryName}": page ${juniorPageIndex + 1}, x=${juniorX}, y=${juniorY}`);
  } else {
    const pages = pdfDoc.getPages();
    juniorPageIndex = pages.length - 1;
    juniorX = DUAL_SIGNATURE_POSITIONS.junior.x;
    juniorY = DUAL_SIGNATURE_POSITIONS.junior.y;
    console.log(`Junior signatory not found, using fallback: page ${juniorPageIndex + 1}, x=${juniorX}, y=${juniorY}`);
  }

  let seniorPageIndex: number;
  let seniorX: number;
  let seniorY: number;

  if (seniorPosition) {
    seniorPageIndex = seniorPosition.pageIndex;
    seniorX = seniorPosition.x;
    seniorY = seniorPosition.y;
    console.log(`Found senior signatory "${seniorSignatoryName}": page ${seniorPageIndex + 1}, x=${seniorX}, y=${seniorY}`);
  } else {
    const pages = pdfDoc.getPages();
    seniorPageIndex = pages.length - 1;
    seniorX = DUAL_SIGNATURE_POSITIONS.senior.x;
    seniorY = DUAL_SIGNATURE_POSITIONS.senior.y;
    console.log(`Senior signatory not found, using fallback: page ${seniorPageIndex + 1}, x=${seniorX}, y=${seniorY}`);
  }

  const pages = pdfDoc.getPages();

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
