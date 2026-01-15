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

// Height of the signature field plus padding above the name
const SIGNATURE_FIELD_OFFSET = 14; // One line space above the name

// ============================================================================
// IMPROVED TEXT EXTRACTION - handles more PDF encodings
// ============================================================================

interface ExtractedTextItem {
  text: string;
  x: number;
  y: number;
}

/**
 * Extracts text from PDF content stream with improved encoding support.
 * FIXED: Properly handles SwiftLaTeX output which uses cumulative Td operators
 * and puts multiple operators on single lines.
 */
function extractTextFromPage(
  page: ReturnType<PDFDocument['getPage']>,
  pageIndex: number
): ExtractedTextItem[] {
  const items: ExtractedTextItem[] = [];

  try {
    const contents = page.node.Contents();
    if (!contents) {
      console.log(`[TEXT] Page ${pageIndex + 1}: No content stream`);
      return items;
    }

    let contentData: Uint8Array;

    if (contents instanceof PDFRawStream) {
      contentData = decodePDFRawStream(contents).decode();
    } else if (contents instanceof PDFArray) {
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
      return items;
    }

    const contentStr = new TextDecoder('latin1').decode(contentData);

    console.log(`[TEXT] Page ${pageIndex + 1}: Content stream length = ${contentStr.length} bytes`);

    // SwiftLaTeX puts multiple operators on single lines, so we can't split by \n
    // Instead, we need to parse sequentially using regex to find operators

    let currentX = 0;
    let currentY = 0;

    // Find all BT (Begin Text) operators - position resets at each BT
    const btRegex = /\bBT\b/g;

    // Find all Td operators and their positions in the string
    // Format: "x y Td" where x and y are numbers
    const tdRegex = /([\d.\-]+)\s+([\d.\-]+)\s+Td/g;

    // Find all TJ arrays and their positions
    // Format: "[(text)(text)...]TJ"
    const tjRegex = /\[((?:[^\[\]]*|\([^)]*\))*)\]TJ/g;

    // Build ordered list of operations
    interface Operation {
      type: 'bt' | 'td' | 'tj';
      index: number;
      dx?: number;
      dy?: number;
      content?: string;
    }

    const operations: Operation[] = [];

    // Find all BT (Begin Text) operations - these reset the text matrix
    let match: RegExpExecArray | null;
    while ((match = btRegex.exec(contentStr)) !== null) {
      operations.push({
        type: 'bt',
        index: match.index
      });
    }

    // Find all Td operations
    while ((match = tdRegex.exec(contentStr)) !== null) {
      operations.push({
        type: 'td',
        index: match.index,
        dx: parseFloat(match[1]),
        dy: parseFloat(match[2])
      });
    }

    // Find all TJ operations
    while ((match = tjRegex.exec(contentStr)) !== null) {
      operations.push({
        type: 'tj',
        index: match.index,
        content: match[1]
      });
    }

    // Sort by position in string (this gives us the correct order of operations)
    operations.sort((a, b) => a.index - b.index);

    // Process operations in order
    for (const op of operations) {
      if (op.type === 'bt') {
        // BT (Begin Text) resets the text position matrix
        currentX = 0;
        currentY = 0;
      } else if (op.type === 'td' && op.dx !== undefined && op.dy !== undefined) {
        // Td is cumulative within a text block - adds to current position
        currentX += op.dx;
        currentY += op.dy;
      } else if (op.type === 'tj' && op.content) {
        // Extract text from TJ array
        // Format: [(text)-600(more text)] where -600 is kerning adjustment
        let combinedText = '';
        const textParts = op.content.matchAll(/\(([^)]*)\)/g);
        for (const part of textParts) {
          combinedText += decodePdfLiteralString(part[1]);
        }

        if (combinedText.trim()) {
          items.push({ text: combinedText, x: currentX, y: currentY });
          console.log(`[TEXT] Found: "${combinedText}" at x=${currentX.toFixed(1)}, y=${currentY.toFixed(1)}`);
        }
      }
    }

    console.log(`[TEXT] Page ${pageIndex + 1}: Extracted ${items.length} text items total`);
    return items;

  } catch (error) {
    console.error(`[TEXT] Page ${pageIndex + 1}: Error:`, error);
    return items;
  }
}

/**
 * Decode PDF literal string (handles escape sequences)
 */
function decodePdfLiteralString(str: string): string {
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\b/g, '\b')
    .replace(/\\f/g, '\f')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\(\d{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
}

/**
 * Search for text in extracted items.
 * Handles text where spaces are visual (kerning) rather than actual characters.
 */
function searchInItems(
  items: ExtractedTextItem[],
  searchText: string
): { x: number; y: number } | null {
  // Normalize both search and item text by removing spaces and periods for comparison
  // This handles "J. A. DOE" matching "J.A.DOE" (kerning creates visual spaces)
  const normalizeForSearch = (text: string): string => {
    return text.toUpperCase().replace(/[\s.]/g, '');
  };

  const searchNormalized = normalizeForSearch(searchText);
  console.log(`[SEARCH] Looking for "${searchText}" (normalized: "${searchNormalized}")`);

  // Strategy 1: Direct match (normalized)
  for (const item of items) {
    const itemNormalized = normalizeForSearch(item.text);
    if (itemNormalized.includes(searchNormalized)) {
      console.log(`[SEARCH] ✓ Found "${searchText}" in "${item.text}" at x=${item.x.toFixed(1)}, y=${item.y.toFixed(1)}`);
      return { x: item.x, y: item.y };
    }
  }

  // Strategy 2: Try with just removing spaces (keep periods)
  const searchNoSpaces = searchText.toUpperCase().replace(/\s/g, '');
  for (const item of items) {
    const itemUpper = item.text.toUpperCase();
    if (itemUpper.includes(searchNoSpaces)) {
      console.log(`[SEARCH] ✓ Found "${searchText}" (no spaces) in "${item.text}" at x=${item.x.toFixed(1)}, y=${item.y.toFixed(1)}`);
      return { x: item.x, y: item.y };
    }
  }

  // Strategy 3: Match across items on same line (within 3pt Y tolerance)
  const lineGroups = new Map<number, ExtractedTextItem[]>();
  for (const item of items) {
    const roundedY = Math.round(item.y);
    if (!lineGroups.has(roundedY)) {
      lineGroups.set(roundedY, []);
    }
    lineGroups.get(roundedY)!.push(item);
  }

  for (const [y, lineItems] of lineGroups) {
    lineItems.sort((a, b) => a.x - b.x);
    const lineText = lineItems.map(i => i.text).join('');
    const lineNormalized = normalizeForSearch(lineText);

    if (lineNormalized.includes(searchNormalized)) {
      const firstItem = lineItems[0];
      console.log(`[SEARCH] ✓ Found "${searchText}" in combined line at x=${firstItem.x.toFixed(1)}, y=${y.toFixed(1)}`);
      return { x: firstItem.x, y };
    }
  }

  console.log(`[SEARCH] ✗ "${searchText}" not found in ${items.length} items`);
  return null;
}

/**
 * Calculate signature position based on page layout.
 * This is used when text extraction fails.
 */
function calculateFallbackPosition(
  page: ReturnType<PDFDocument['getPage']>,
  signatureType: 'single' | 'junior' | 'senior' = 'single'
): { x: number; y: number } {
  const { width, height } = page.getSize();

  console.log(`[FALLBACK] Page size: ${width} x ${height} points`);

  const leftMargin = 72; // 1 inch

  let x: number;
  let y: number;

  switch (signatureType) {
    case 'junior':
      x = leftMargin;
      y = height * 0.35;
      break;
    case 'senior':
      x = width * 0.50;
      y = height * 0.35;
      break;
    case 'single':
    default:
      x = 306;
      y = 279;
      break;
  }

  console.log(`[FALLBACK] Calculated position for ${signatureType}: x=${x}, y=${y}`);
  return { x, y };
}

/**
 * Find signatory position - tries text search first, then falls back to calculated position
 */
function findSignatoryPosition(
  pdfDoc: PDFDocument,
  signatoryName: string | undefined,
  signatureType: 'single' | 'junior' | 'senior' = 'single'
): { pageIndex: number; x: number; y: number } {
  const pages = pdfDoc.getPages();
  const lastPageIndex = pages.length - 1;
  const lastPage = pages[lastPageIndex];

  // Try text-based search if signatory name provided
  if (signatoryName?.trim()) {
    console.log(`[POSITION] Searching for "${signatoryName}"...`);

    // Search from last page (where signatures usually are)
    for (let i = lastPageIndex; i >= 0; i--) {
      const items = extractTextFromPage(pages[i], i);
      const position = searchInItems(items, signatoryName);

      if (position) {
        return {
          pageIndex: i,
          x: position.x - 16, // Shift left to center over signature block
          y: position.y + SIGNATURE_FIELD_OFFSET + 2,
        };
      }
    }

    console.log(`[POSITION] Text search failed, using calculated fallback`);
  }

  // Fallback to calculated position
  const fallback = calculateFallbackPosition(lastPage, signatureType);
  return {
    pageIndex: lastPageIndex,
    x: fallback.x,
    y: fallback.y + SIGNATURE_FIELD_OFFSET,
  };
}

/**
 * Creates an appearance stream for an empty signature field.
 */
function createEmptySignatureAppearance(
  pdfDoc: PDFDocument,
  width: number,
  height: number
) {
  const stream = pdfDoc.context.stream(
    `q Q`,
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
 * Adds an empty digital signature field to a PDF document.
 */
export async function addSignatureField(
  pdfBytes: Uint8Array,
  config: SignatureFieldConfig = {}
): Promise<Uint8Array> {
  console.log('[addSignatureField] Starting with config:', config);

  const pdfDoc = await PDFDocument.load(pdfBytes);

  const {
    name = DEFAULT_CONFIG.name,
    width = DEFAULT_CONFIG.width,
    height = DEFAULT_CONFIG.height,
    signatoryName,
  } = config;

  // Find position (text-based or calculated fallback)
  const position = findSignatoryPosition(pdfDoc, signatoryName, 'single');

  console.log(`[addSignatureField] Using position: page ${position.pageIndex + 1}, x=${position.x}, y=${position.y}`);

  const pages = pdfDoc.getPages();
  const page = pages[position.pageIndex];
  const pageRef = page.ref;

  // Setup AcroForm
  const catalog = pdfDoc.catalog;
  let acroForm = catalog.lookup(PDFName.of('AcroForm')) as PDFDict | undefined;

  if (!acroForm) {
    acroForm = pdfDoc.context.obj({
      Fields: [],
      SigFlags: 3,
    }) as PDFDict;
    catalog.set(PDFName.of('AcroForm'), acroForm);
  } else {
    acroForm.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  }

  let fields = acroForm.lookup(PDFName.of('Fields')) as PDFArray | undefined;
  if (!fields) {
    fields = pdfDoc.context.obj([]) as PDFArray;
    acroForm.set(PDFName.of('Fields'), fields);
  }

  // Create signature field
  const sigField = pdfDoc.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Sig'),
    T: PDFString.of(name),
    Rect: [position.x, position.y, position.x + width, position.y + height],
    F: 4,
    P: pageRef,
    Border: [0, 0, 0],
  }) as PDFDict;

  const appearanceStream = createEmptySignatureAppearance(pdfDoc, width, height);
  const apDict = pdfDoc.context.obj({ N: appearanceStream }) as PDFDict;
  sigField.set(PDFName.of('AP'), apDict);

  const sigFieldRef = pdfDoc.context.register(sigField);
  fields.push(sigFieldRef);

  let annots = page.node.lookup(PDFName.of('Annots')) as PDFArray | undefined;
  if (!annots) {
    annots = pdfDoc.context.obj([]) as PDFArray;
    page.node.set(PDFName.of('Annots'), annots);
  }
  annots.push(sigFieldRef);

  console.log(`[addSignatureField] ✓ Signature field "${name}" added at Rect=[${position.x}, ${position.y}, ${position.x + width}, ${position.y + height}]`);

  return await pdfDoc.save();
}

/**
 * Adds dual digital signature fields for joint letters, MOA/MOU documents.
 */
export async function addDualSignatureFields(
  pdfBytes: Uint8Array,
  config: DualSignatureFieldConfig = {}
): Promise<Uint8Array> {
  console.log('[addDualSignatureFields] Starting with config:', config);

  const pdfDoc = await PDFDocument.load(pdfBytes);

  const {
    width = DEFAULT_CONFIG.width,
    height = DEFAULT_CONFIG.height,
    juniorSignatoryName,
    seniorSignatoryName,
  } = config;

  // Find positions
  const juniorPosition = findSignatoryPosition(pdfDoc, juniorSignatoryName, 'junior');
  const seniorPosition = findSignatoryPosition(pdfDoc, seniorSignatoryName, 'senior');

  // Align both signatures to the same Y coordinate (use the average)
  // This ensures both signature fields appear at the same height
  const alignedY = (juniorPosition.y + seniorPosition.y) / 2;
  juniorPosition.y = alignedY;
  seniorPosition.y = alignedY;

  console.log(`[addDualSignatureFields] Aligned Y position: ${alignedY.toFixed(1)}`);

  const pages = pdfDoc.getPages();

  // Setup AcroForm
  const catalog = pdfDoc.catalog;
  let acroForm = catalog.lookup(PDFName.of('AcroForm')) as PDFDict | undefined;

  if (!acroForm) {
    acroForm = pdfDoc.context.obj({
      Fields: [],
      SigFlags: 3,
    }) as PDFDict;
    catalog.set(PDFName.of('AcroForm'), acroForm);
  } else {
    acroForm.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  }

  let fields = acroForm.lookup(PDFName.of('Fields')) as PDFArray | undefined;
  if (!fields) {
    fields = pdfDoc.context.obj([]) as PDFArray;
    acroForm.set(PDFName.of('Fields'), fields);
  }

  // Junior signature (LEFT)
  const juniorPage = pages[juniorPosition.pageIndex];
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
    Rect: [juniorPosition.x, juniorPosition.y, juniorPosition.x + width, juniorPosition.y + height],
    F: 4,
    P: juniorPageRef,
    Border: [0, 0, 0],
  }) as PDFDict;

  const juniorAppearance = createEmptySignatureAppearance(pdfDoc, width, height);
  juniorField.set(PDFName.of('AP'), pdfDoc.context.obj({ N: juniorAppearance }) as PDFDict);

  const juniorFieldRef = pdfDoc.context.register(juniorField);
  fields.push(juniorFieldRef);
  juniorAnnots.push(juniorFieldRef);

  // Senior signature (RIGHT)
  const seniorPage = pages[seniorPosition.pageIndex];
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
    Rect: [seniorPosition.x, seniorPosition.y, seniorPosition.x + width, seniorPosition.y + height],
    F: 4,
    P: seniorPageRef,
    Border: [0, 0, 0],
  }) as PDFDict;

  const seniorAppearance = createEmptySignatureAppearance(pdfDoc, width, height);
  seniorField.set(PDFName.of('AP'), pdfDoc.context.obj({ N: seniorAppearance }) as PDFDict);

  const seniorFieldRef = pdfDoc.context.register(seniorField);
  fields.push(seniorFieldRef);
  seniorAnnots.push(seniorFieldRef);

  console.log(`[addDualSignatureFields] ✓ Added:`);
  console.log(`  Junior: page ${juniorPosition.pageIndex + 1}, Rect=[${juniorPosition.x}, ${juniorPosition.y}, ${juniorPosition.x + width}, ${juniorPosition.y + height}]`);
  console.log(`  Senior: page ${seniorPosition.pageIndex + 1}, Rect=[${seniorPosition.x}, ${seniorPosition.y}, ${seniorPosition.x + width}, ${seniorPosition.y + height}]`);

  return await pdfDoc.save();
}