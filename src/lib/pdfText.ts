import { pdfjs } from 'react-pdf';
import { HARDENED_PDF_OPTIONS } from '@/components/pdf/pdfConfig';

/**
 * Extract text from a PDF as ordered lines, in the browser, from the pdf.js
 * already bundled for the preview (same worker, same CVE-2024-4367 hardening).
 * Nothing leaves the tab — consistent with the app's offline/air-gap posture.
 *
 * pdf.js hands back positioned text *fragments*, not lines: a line rendered in
 * two fonts arrives as two items, and items aren't guaranteed left-to-right.
 * So we regroup by vertical position — items whose baseline Y is within a
 * tolerance form one line, sorted left-to-right — and read a paragraph break
 * from a larger-than-normal vertical gap. That reconstruction is what lets the
 * naval-letter parser see "From:", "Subj:", and "1." as whole lines again.
 *
 * Text-layer only: a scanned/image PDF has no text to extract and yields an
 * empty result (that's the OCR path, deliberately out of scope here).
 */

export interface PositionedItem {
  str: string;
  x: number;
  y: number;
  height: number;
}

// Two fragments belong to the same line when their baselines sit within this
// fraction of the text height — enough to absorb sub/superscript jitter without
// merging adjacent lines.
const LINE_TOLERANCE_RATIO = 0.5;

/** Group positioned fragments on one page into left-to-right lines, top-down.
 *  Exported for unit testing without a live pdf.js document. */
export function itemsToLines(items: PositionedItem[]): string[] {
  if (items.length === 0) return [];
  // Top-to-bottom (PDF Y grows upward), then left-to-right within a line.
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: string[] = [];
  let bucket: PositionedItem[] = [sorted[0]];
  let bucketY = sorted[0].y;
  const medianHeight = sorted[0].height || 10;

  const flush = () => {
    const line = bucket
      .sort((a, b) => a.x - b.x)
      .map((it) => it.str)
      .join('')
      .replace(/\s+/g, ' ')
      .trimEnd();
    lines.push(line);
  };

  for (let i = 1; i < sorted.length; i++) {
    const it = sorted[i];
    const tol = Math.max(medianHeight, it.height || medianHeight) * LINE_TOLERANCE_RATIO;
    if (Math.abs(it.y - bucketY) <= tol) {
      bucket.push(it);
    } else {
      flush();
      bucket = [it];
      bucketY = it.y;
    }
  }
  flush();
  return lines;
}

/**
 * Read every page of a PDF (given as bytes) into text lines. Pages are joined
 * with a blank line so the parser sees page breaks as paragraph boundaries.
 * Returns `''` for a PDF with no text layer.
 */
export async function extractPdfText(data: Uint8Array | ArrayBuffer): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const doc = await pdfjs.getDocument({ data: bytes, ...HARDENED_PDF_OPTIONS }).promise;
  try {
    const pageLines: string[][] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items: PositionedItem[] = content.items
        .filter((it): it is Extract<typeof it, { str: string }> => 'str' in it)
        .map((it) => ({
          str: it.str,
          x: it.transform[4],
          y: it.transform[5],
          height: Math.abs(it.transform[3]) || it.height || 10,
        }));
      pageLines.push(itemsToLines(items));
      page.cleanup();
    }
    return pageLines.map((lines) => lines.join('\n')).join('\n\n').trim();
  } finally {
    // Free the worker-side document; a leaked handle keeps the PDF in memory.
    await doc.destroy();
  }
}
