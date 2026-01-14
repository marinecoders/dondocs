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
const FALLBACK_POSITION = {
  x: 306,
  y: 350,
};

// Dual signature fallback positions
const DUAL_SIGNATURE_POSITIONS = {
  junior: { x: 72, y: 280 },
  senior: { x: 396, y: 280 },
};

// Height of the signature field plus padding above the name
const SIGNATURE_FIELD_OFFSET = 42; // 36pt height + 6pt padding

// ============================================================================
// DEBUG: Text extraction with full logging
// ============================================================================

interface ExtractedTextItem {
  text: string;
  x: number;
  y: number;
  rawOperator: string;
}

/**
 * DEBUG VERSION: Extracts ALL text from a PDF page with detailed logging
 */
function debugExtractAllText(
  page: ReturnType<PDFDocument['getPage']>,
  pageIndex: number
): ExtractedTextItem[] {
  const items: ExtractedTextItem[] = [];
  
  try {
    const contents = page.node.Contents();
    if (!contents) {
      console.log(`[DEBUG] Page ${pageIndex + 1}: No content stream found`);
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
      console.log(`[DEBUG] Page ${pageIndex + 1}: Unexpected content type`);
      return items;
    }

    const contentStr = new TextDecoder('latin1').decode(contentData);
    
    console.log(`[DEBUG] Page ${pageIndex + 1}: Content stream length = ${contentStr.length} bytes`);
    
    // Track text state
    let currentX = 0;
    let currentY = 0;
    let textMatrixX = 0;
    let textMatrixY = 0;
    let inTextBlock = false;

    // Split into lines for parsing
    const lines = contentStr.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Track BT/ET
      if (trimmedLine === 'BT') {
        inTextBlock = true;
        currentX = 0;
        currentY = 0;
        continue;
      }
      if (trimmedLine === 'ET') {
        inTextBlock = false;
        continue;
      }
      
      if (!inTextBlock) continue;

      // Parse Tm (text matrix): a b c d e f Tm
      const tmMatch = trimmedLine.match(/^([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+Tm$/);
      if (tmMatch) {
        textMatrixX = parseFloat(tmMatch[5]);
        textMatrixY = parseFloat(tmMatch[6]);
        currentX = textMatrixX;
        currentY = textMatrixY;
        continue;
      }

      // Parse Td (relative position): tx ty Td
      const tdMatch = trimmedLine.match(/^([\d.\-]+)\s+([\d.\-]+)\s+Td$/);
      if (tdMatch) {
        currentX += parseFloat(tdMatch[1]);
        currentY += parseFloat(tdMatch[2]);
        continue;
      }

      // Parse TD (relative position + set leading): tx ty TD
      const tdUpperMatch = trimmedLine.match(/^([\d.\-]+)\s+([\d.\-]+)\s+TD$/);
      if (tdUpperMatch) {
        currentX += parseFloat(tdUpperMatch[1]);
        currentY += parseFloat(tdUpperMatch[2]);
        continue;
      }

      // Parse T* (move to next line)
      if (trimmedLine === "T*") {
        // Uses TL (text leading) which we're not tracking, assume ~12pt
        currentY -= 12;
        continue;
      }

      // Parse text show operators
      
      // (text) Tj - show string
      const tjMatch = trimmedLine.match(/^\((.+)\)\s*Tj$/);
      if (tjMatch) {
        const text = decodePdfString(tjMatch[1]);
        items.push({ text, x: currentX, y: currentY, rawOperator: trimmedLine });
        continue;
      }

      // <hex> Tj - show hex string
      const hexTjMatch = trimmedLine.match(/^<([0-9A-Fa-f]+)>\s*Tj$/);
      if (hexTjMatch) {
        const text = decodeHexString(hexTjMatch[1]);
        items.push({ text: `[HEX:${text}]`, x: currentX, y: currentY, rawOperator: trimmedLine });
        continue;
      }

      // [...] TJ - show array with positioning
      const tjArrayMatch = trimmedLine.match(/^\[(.*)\]\s*TJ$/);
      if (tjArrayMatch) {
        const arrayContent = tjArrayMatch[1];
        // Extract all strings from the array
        const stringMatches = arrayContent.matchAll(/\(([^)]*)\)|<([0-9A-Fa-f]+)>/g);
        let combinedText = '';
        for (const match of stringMatches) {
          if (match[1] !== undefined) {
            combinedText += decodePdfString(match[1]);
          } else if (match[2] !== undefined) {
            combinedText += decodeHexString(match[2]);
          }
        }
        if (combinedText) {
          items.push({ text: combinedText, x: currentX, y: currentY, rawOperator: trimmedLine.substring(0, 50) + '...' });
        }
        continue;
      }

      // ' text - move to next line and show
      const tickMatch = trimmedLine.match(/^\((.+)\)\s*'$/);
      if (tickMatch) {
        currentY -= 12; // Approximate line height
        const text = decodePdfString(tickMatch[1]);
        items.push({ text, x: currentX, y: currentY, rawOperator: trimmedLine });
        continue;
      }
    }

    return items;
  } catch (error) {
    console.error(`[DEBUG] Page ${pageIndex + 1}: Error extracting text:`, error);
    return items;
  }
}

/**
 * Decode PDF string escapes
 */
function decodePdfString(str: string): string {
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
 * Decode hex-encoded PDF string
 */
function decodeHexString(hex: string): string {
  let result = '';
  // Pad with 0 if odd length
  const padded = hex.length % 2 ? hex + '0' : hex;
  for (let i = 0; i < padded.length; i += 2) {
    const charCode = parseInt(padded.substring(i, i + 2), 16);
    // Only include printable ASCII
    if (charCode >= 32 && charCode < 127) {
      result += String.fromCharCode(charCode);
    } else if (charCode >= 127) {
      result += `[${charCode.toString(16)}]`;
    }
  }
  return result;
}

/**
 * DEBUG FUNCTION: Call this to see all text in your PDF
 * 
 * Usage in your code:
 *   import { debugDumpPdfText } from './addSignatureFieldDebug';
 *   await debugDumpPdfText(pdfBytes);
 */
export async function debugDumpPdfText(pdfBytes: Uint8Array): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║              PDF TEXT CONTENT DEBUG DUMP                      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  
  console.log(`\nTotal pages: ${pages.length}`);
  
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const { width, height } = page.getSize();
    
    console.log(`\n┌─────────────────────────────────────────────────────────────┐`);
    console.log(`│ PAGE ${i + 1} (${width.toFixed(0)} x ${height.toFixed(0)} points)                              │`);
    console.log(`└─────────────────────────────────────────────────────────────┘`);
    
    const items = debugExtractAllText(page, i);
    
    if (items.length === 0) {
      console.log('  (No text items found on this page)');
      continue;
    }
    
    // Sort by Y (descending = top to bottom), then X
    items.sort((a, b) => {
      if (Math.abs(a.y - b.y) > 3) return b.y - a.y;
      return a.x - b.x;
    });
    
    // Group by approximate Y position (within 3 points = same line)
    let lastY = Infinity;
    for (const item of items) {
      if (Math.abs(item.y - lastY) > 3) {
        console.log(''); // Blank line between text lines
      }
      lastY = item.y;
      
      const xStr = item.x.toFixed(1).padStart(7);
      const yStr = item.y.toFixed(1).padStart(7);
      console.log(`  x=${xStr}  y=${yStr}  │ "${item.text}"`);
    }
  }
  
  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('TIP: Look for your signatory name above. If you see it,');
  console.log('     note the exact text format and y-coordinate.');
  console.log('     If you do NOT see it, the text might be using a custom font');
  console.log('     encoding - try the LaTeX marker approach instead.');
  console.log('════════════════════════════════════════════════════════════════\n');
}

/**
 * DEBUG: Search for text and show what we're matching against
 */
function findTextInPageDebug(
  page: ReturnType<PDFDocument['getPage']>,
  searchText: string,
  pageIndex: number
): { x: number; y: number } | null {
  const searchUpper = searchText.toUpperCase().trim();
  if (!searchUpper) return null;
  
  console.log(`[SEARCH] Looking for "${searchText}" (normalized: "${searchUpper}")`);
  
  const items = debugExtractAllText(page, pageIndex);
  
  // First pass: exact substring match
  for (const item of items) {
    const itemUpper = item.text.toUpperCase();
    if (itemUpper.includes(searchUpper)) {
      console.log(`[SEARCH] ✓ FOUND exact match: "${item.text}" at x=${item.x}, y=${item.y}`);
      return { x: item.x, y: item.y };
    }
  }
  
  // Second pass: check if search text might be split across items on same line
  // Group items by Y coordinate
  const lineGroups = new Map<number, ExtractedTextItem[]>();
  for (const item of items) {
    const roundedY = Math.round(item.y);
    if (!lineGroups.has(roundedY)) {
      lineGroups.set(roundedY, []);
    }
    lineGroups.get(roundedY)!.push(item);
  }
  
  // Check each line
  for (const [y, lineItems] of lineGroups) {
    // Sort by x
    lineItems.sort((a, b) => a.x - b.x);
    const lineText = lineItems.map(i => i.text).join('').toUpperCase();
    
    if (lineText.includes(searchUpper)) {
      const firstItem = lineItems[0];
      console.log(`[SEARCH] ✓ FOUND in combined line: "${lineText}" at x=${firstItem.x}, y=${y}`);
      return { x: firstItem.x, y: y };
    }
  }
  
  // Show what we DID find for debugging
  console.log(`[SEARCH] ✗ NOT FOUND. Here's what text IS on page ${pageIndex + 1}:`);
  const uniqueTexts = [...new Set(items.map(i => i.text))];
  for (const text of uniqueTexts.slice(0, 20)) { // Show first 20 unique texts
    console.log(`[SEARCH]   - "${text}"`);
  }
  if (uniqueTexts.length > 20) {
    console.log(`[SEARCH]   ... and ${uniqueTexts.length - 20} more text items`);
  }
  
  return null;
}

/**
 * Find signatory position with debug output
 */
function findSignatoryPosition(
  pdfDoc: PDFDocument,
  signatoryName: string
): { pageIndex: number; x: number; y: number } | null {
  if (!signatoryName || !signatoryName.trim()) {
    return null;
  }

  const pages = pdfDoc.getPages();
  
  console.log(`[SIGNATORY] Searching for "${signatoryName}" in ${pages.length} page(s)`);

  // Search from last page first (signatures typically at end)
  for (let i = pages.length - 1; i >= 0; i--) {
    console.log(`[SIGNATORY] Checking page ${i + 1}...`);
    const page = pages[i];
    const position = findTextInPageDebug(page, signatoryName, i);

    if (position) {
      return {
        pageIndex: i,
        x: position.x,
        y: position.y + SIGNATURE_FIELD_OFFSET,
      };
    }
  }

  console.log(`[SIGNATORY] "${signatoryName}" not found in any page`);
  return null;
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
 * DEBUG VERSION with extensive logging.
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

  let targetPageIndex: number;
  let x: number;
  let y: number;

  const textPosition = signatoryName ? findSignatoryPosition(pdfDoc, signatoryName) : null;

  const catalog = pdfDoc.catalog;
  let acroForm = catalog.lookup(PDFName.of('AcroForm')) as PDFDict | undefined;

  if (textPosition) {
    targetPageIndex = textPosition.pageIndex;
    x = textPosition.x;
    y = textPosition.y;
    console.log(`[addSignatureField] ✓ Using text-based position: page ${targetPageIndex + 1}, x=${x}, y=${y}`);
  } else {
    const pages = pdfDoc.getPages();
    targetPageIndex = pages.length - 1;
    x = FALLBACK_POSITION.x;
    y = FALLBACK_POSITION.y;
    console.log(`[addSignatureField] ⚠ Using FALLBACK position: page ${targetPageIndex + 1}, x=${x}, y=${y}`);
  }

  const pages = pdfDoc.getPages();
  const page = pages[targetPageIndex];
  const pageRef = page.ref;

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

  const sigField = pdfDoc.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Sig'),
    T: PDFString.of(name),
    Rect: [x, y, x + width, y + height],
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

  console.log(`[addSignatureField] Signature field "${name}" added at Rect=[${x}, ${y}, ${x + width}, ${y + height}]`);

  return await pdfDoc.save();
}

/**
 * Adds dual digital signature fields - DEBUG VERSION
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

  const catalog = pdfDoc.catalog;
  let acroForm = catalog.lookup(PDFName.of('AcroForm')) as PDFDict | undefined;

  const juniorPosition = juniorSignatoryName ? findSignatoryPosition(pdfDoc, juniorSignatoryName) : null;
  const seniorPosition = seniorSignatoryName ? findSignatoryPosition(pdfDoc, seniorSignatoryName) : null;

  let juniorPageIndex: number;
  let juniorX: number;
  let juniorY: number;

  if (juniorPosition) {
    juniorPageIndex = juniorPosition.pageIndex;
    juniorX = juniorPosition.x;
    juniorY = juniorPosition.y;
  } else {
    const pages = pdfDoc.getPages();
    juniorPageIndex = pages.length - 1;
    juniorX = DUAL_SIGNATURE_POSITIONS.junior.x;
    juniorY = DUAL_SIGNATURE_POSITIONS.junior.y;
  }

  let seniorPageIndex: number;
  let seniorX: number;
  let seniorY: number;

  if (seniorPosition) {
    seniorPageIndex = seniorPosition.pageIndex;
    seniorX = seniorPosition.x;
    seniorY = seniorPosition.y;
  } else {
    const pages = pdfDoc.getPages();
    seniorPageIndex = pages.length - 1;
    seniorX = DUAL_SIGNATURE_POSITIONS.senior.x;
    seniorY = DUAL_SIGNATURE_POSITIONS.senior.y;
  }

  const pages = pdfDoc.getPages();

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

  // Junior signature
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

  // Senior signature
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

  console.log(`[addDualSignatureFields] Added:`);
  console.log(`  Junior: page ${juniorPageIndex + 1}, Rect=[${juniorX}, ${juniorY}, ${juniorX + width}, ${juniorY + height}]`);
  console.log(`  Senior: page ${seniorPageIndex + 1}, Rect=[${seniorX}, ${seniorY}, ${seniorX + width}, ${seniorY + height}]`);

  return await pdfDoc.save();
}
