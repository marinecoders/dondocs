import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface PdfTextBox {
  page: number;
  text: string;
  left: number;
  right: number;
  bottom: number;
  top: number;
}

/** Uses PDF text positions and font ascent/descent, independent of generator strings. */
export async function pdfTextLayout(bytes: Uint8Array) {
  const pdf = await getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
  }).promise;
  const boxes: PdfTextBox[] = [];
  const collisions: { first: PdfTextBox; second: PdfTextBox }[] = [];
  try {
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const seen = new Set<string>();
      const pageBoxes: PdfTextBox[] = [];
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim() || item.width <= 0) continue;
        const [a, b, c, d, x, y] = item.transform;
        const horizontal = Math.hypot(a, b),
          vertical = Math.hypot(c, d);
        if (!horizontal || !vertical) continue;
        const style = content.styles[item.fontName];
        const low = (style?.descent ?? -0.2) * vertical;
        const high = (style?.ascent ?? 0.8) * vertical;
        const corners = [0, item.width].flatMap((advance) =>
          [low, high].map((rise) => ({
            x: x + (advance * a) / horizontal + (rise * c) / vertical,
            y: y + (advance * b) / horizontal + (rise * d) / vertical,
          })),
        );
        const box = {
          page: number,
          text: item.str,
          left: Math.min(...corners.map((p) => p.x)),
          right: Math.max(...corners.map((p) => p.x)),
          bottom: Math.min(...corners.map((p) => p.y)),
          top: Math.max(...corners.map((p) => p.y)),
        };
        // Identical overprints do not create the two different word runs this
        // test diagnoses (e.g. a long acronym intruding into its definition).
        const key = JSON.stringify(box);
        if (seen.has(key)) continue;
        seen.add(key);
        for (const previous of pageBoxes) {
          const overlapX =
            Math.min(box.right, previous.right) -
            Math.max(box.left, previous.left);
          const overlapY =
            Math.min(box.top, previous.top) -
            Math.max(box.bottom, previous.bottom);
          if (overlapX > 0.5 && overlapY > 0.5)
            collisions.push({ first: previous, second: box });
        }
        pageBoxes.push(box);
      }
      boxes.push(...pageBoxes);
    }
    return { boxes, collisions };
  } finally {
    await pdf.destroy();
  }
}
