import { PDFDocument } from 'pdf-lib';

/**
 * Box boundary definition
 */
export interface BoxBoundary {
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Extract form field boundaries from a PDF template
 *
 * This utility reads AcroForm fields from a PDF and extracts their
 * bounding box coordinates. Use this to auto-generate box definitions
 * for new form templates.
 *
 * Requirements:
 * - PDF must have actual form fields defined (not just visual boxes)
 * - Use Adobe Acrobat or similar to add form fields to templates
 *
 * @param pdfBytes - The PDF file as ArrayBuffer or Uint8Array
 * @returns Array of box boundaries with field names and coordinates
 *
 * @example
 * const template = await fetch('/templates/NAVMC10274_page2.pdf').then(r => r.arrayBuffer());
 * const boxes = await extractFormFieldBoundaries(template);
 * console.log(boxes);
 * // Output:
 * // [
 * //   { name: 'actionNo', left: 427, top: 724, width: 88, height: 14 },
 * //   { name: 'from', left: 32, top: 682, width: 283, height: 40 },
 * //   ...
 * // ]
 */
export async function extractFormFieldBoundaries(
  pdfBytes: ArrayBuffer | Uint8Array
): Promise<BoxBoundary[]> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const form = pdfDoc.getForm();
  const fields = form.getFields();
  const boxes: BoxBoundary[] = [];

  // Get page height for coordinate conversion (PDF Y is from bottom)
  const page = pdfDoc.getPage(0);
  const { height: pageHeight } = page.getSize();

  for (const field of fields) {
    const name = field.getName();
    const widgets = field.acroField.getWidgets();

    if (widgets.length > 0) {
      const rect = widgets[0].getRectangle();

      // Convert from PDF coordinates (origin bottom-left) to our format (origin top-left for Y)
      // In PDF: rect.y is the bottom of the box
      // We want: top is the top of the box (higher Y value in PDF terms)
      const box: BoxBoundary = {
        name: sanitizeFieldName(name),
        left: Math.round(rect.x),
        top: Math.round(rect.y + rect.height), // Top edge in PDF coordinates
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };

      boxes.push(box);
    }
  }

  // Sort by position (top to bottom, left to right)
  boxes.sort((a, b) => {
    const yDiff = b.top - a.top; // Higher Y = higher on page
    if (Math.abs(yDiff) > 10) return yDiff;
    return a.left - b.left;
  });

  return boxes;
}

/**
 * Convert field name to camelCase variable name
 */
function sanitizeFieldName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .replace(/_([a-z])/g, (_, c) => c.toUpperCase())
    .replace(/^([A-Z])/, (_, c) => c.toLowerCase());
}

/**
 * Generate TypeScript code for box definitions
 *
 * @param boxes - Array of box boundaries
 * @param variableName - Name for the exported constant
 * @returns TypeScript code string
 *
 * @example
 * const boxes = await extractFormFieldBoundaries(template);
 * const code = generateBoxDefinitionCode(boxes, 'PAGE2_BOXES');
 * console.log(code);
 */
export function generateBoxDefinitionCode(
  boxes: BoxBoundary[],
  variableName: string = 'PAGE_BOXES'
): string {
  const entries = boxes.map(box => {
    const padding = ' '.repeat(Math.max(0, 16 - box.name.length));
    return `  ${box.name}:${padding}{ left: ${box.left}, top: ${box.top}, width: ${box.width}, height: ${box.height} },`;
  });

  return `const ${variableName} = {\n${entries.join('\n')}\n};`;
}

/**
 * Debug utility: Print all form fields in a PDF
 */
export async function debugPrintFormFields(
  pdfBytes: ArrayBuffer | Uint8Array
): Promise<void> {
  const boxes = await extractFormFieldBoundaries(pdfBytes);

  console.log('='.repeat(60));
  console.log('FORM FIELD BOUNDARIES');
  console.log('='.repeat(60));

  for (const box of boxes) {
    console.log(`${box.name}:`);
    console.log(`  Position: (${box.left}, ${box.top})`);
    console.log(`  Size: ${box.width} x ${box.height}`);
    console.log('');
  }

  console.log('='.repeat(60));
  console.log('GENERATED CODE:');
  console.log('='.repeat(60));
  console.log(generateBoxDefinitionCode(boxes));
}

/**
 * Calculate text position from box boundaries with consistent padding
 *
 * @param box - The box boundary definition
 * @param padding - Padding from box edges (default: 3pt)
 * @param fontSize - Font size for baseline adjustment (default: 10pt)
 * @returns Text position { x, y, maxWidth }
 */
export function calculateTextPosition(
  box: BoxBoundary,
  padding: { left: number; top: number } = { left: 3, top: 3 },
  fontSize: number = 10
): { x: number; y: number; maxWidth: number } {
  return {
    x: box.left + padding.left,
    y: box.top - padding.top - fontSize, // Subtract font size for baseline
    maxWidth: box.width - (padding.left * 2),
  };
}
