import { rgb, PDFHexString, PDFName, beginText, endText, moveText, setFontAndSize, showText, type PDFDocument, type PDFPage, type PDFRef } from 'pdf-lib';

export const REVIEW_FONT = 'Arial, "Noto Sans", sans-serif';
const hex = (text: string) => Array.from({ length: text.length }, (_, i) => text.charCodeAt(i).toString(16).padStart(4, '0')).join('').toUpperCase();
export function reviewTextDirection(text: string): 'rtl' | 'ltr' {
  for (const char of text) if (/\p{L}/u.test(char)) return /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/.test(char) ? 'rtl' : 'ltr';
  return 'ltr';
}

/** Compare graphemes with missing-glyph and replacement shapes before export. */
export async function assertRedlineGlyphs(text: string, canvas: HTMLCanvasElement, context: CanvasRenderingContext2D,
  cancelled: () => boolean = () => false): Promise<void> {
  const assertActive = () => { if (cancelled()) throw new Error('Redline PDF preparation cancelled.'); };
  assertActive();
  canvas.width = 160;canvas.height = 96;
  const fingerprint = (value: string) => {
    context.clearRect(0, 0, canvas.width, canvas.height);context.font = `32px ${REVIEW_FONT}`;context.fillStyle = '#000';context.textBaseline = 'alphabetic';
    context.fillText(value, 4, 64);
    return { width: context.measureText(value).width, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
  };
  const missing = [fingerprint('\u{10ffff}'), fingerprint('\ufffd')], seen = new Set<string>();
  let checkpoint = performance.now(), scanned = 0;
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    // Canvas readbacks are synchronous. Give cancellation and owner changes a
    // turn during preflight, including long runs of already-seen characters.
    if (++scanned % 64 === 0) {
      assertActive();
      if (performance.now() - checkpoint >= 8) {
        await new Promise(resolve => setTimeout(resolve, 0));assertActive();checkpoint = performance.now();
      }
    }
    if (Array.from(segment).every(char => char.codePointAt(0)! < 128) || seen.has(segment) || /^[\p{Cf}\p{Z}]+$/u.test(segment)) continue;
    seen.add(segment);
    const actual = fingerprint(segment);
    if (missing.some(shape => actual.width === shape.width && actual.pixels.every((value, i) => value === shape.pixels[i]))) {
      const code = Array.from(segment, char => `U+${char.codePointAt(0)!.toString(16).toUpperCase()}`).join(' ');
      throw new Error(`This device has no readable glyph for ${code}. Use a device with a font for this text, then prepare the redline again.`);
    }
  }
  assertActive();
}

/** Embed the shaped appearance, then map complete Unicode graphemes in
 * conventional Type3 font units. DOM ranges supply browser bidi positions.
 * This is a searchable review copy, not a tagged PDF or a general font engine. */
export async function drawReviewUnicodeLine(pdf: PDFDocument, page: PDFPage, text: string, x: number, y: number, size: number,
  canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, name: string, marks: Array<{ start: number; end: number; style: 'insert' | 'delete' }> = []): Promise<void> {
  const element = document.createElement('span');
  element.style.cssText = `position:fixed;left:-100000px;top:0;white-space:pre;font:${size}px ${REVIEW_FONT};line-height:1;direction:${reviewTextDirection(text)};unicode-bidi:plaintext;`;
  element.textContent = text;document.body.appendChild(element);
  try {
    const bounds = element.getBoundingClientRect();
    if (bounds.width > 540 || !Number.isFinite(bounds.width)) throw new Error('This Unicode line exceeds the PDF page. Prepare a smaller review.');
    const width = Math.max(bounds.width + 4, 4), height = size * 2.5;
    canvas.width = Math.ceil(width * 2);canvas.height = Math.ceil(height * 2);
    context.font = `${size * 2}px ${REVIEW_FONT}`;context.textBaseline = 'alphabetic';context.fillStyle = '#17202a';
    context.direction = reviewTextDirection(text);context.textAlign = context.direction === 'rtl' ? 'right' : 'left';
    context.fillText(text, context.direction === 'rtl' ? canvas.width - 4 : 4, size * 2);
    const image = await pdf.embedPng(canvas.toDataURL('image/png'));
    page.drawImage(image, { x, y: y + size - height, width, height });
    const node = element.firstChild!;
    const clusters = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), ({ segment, index }) => {
      const range = document.createRange();range.setStart(node, index);range.setEnd(node, index + segment.length);
      const rect = range.getBoundingClientRect();
      return { text: segment, x: rect.left - bounds.left, width: rect.width };
    });
    if (clusters.some(cluster => Array.from(cluster.text).length > 8)) throw new Error('A character cluster exceeds this PDF reader compatibility limit. Use the decision summary HTML to preserve this text.');
    // Readers infer a paragraph direction per font run. Keep strong RTL words
    // separate from surrounding LTR/neutral text, so short mixed lines do not
    // change logical order under pdf.js's base-direction heuristic.
    const runs: typeof clusters[] = [];
    const strongRtl = (text: string) => /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/.test(text) && /\p{L}/u.test(text);
    let previous: boolean | undefined;
    for (const [index, cluster] of clusters.entries()) {
      // A space between two RTL words belongs to their shared run. Boundary
      // spaces stay with surrounding LTR text, avoiding discarded space-only runs.
      const rtl = strongRtl(cluster.text) || /^\s+$/u.test(cluster.text) && previous === true
        && clusters.slice(index + 1).find(next => !/^\s+$/u.test(next.text)) !== undefined
        && strongRtl(clusters.slice(index + 1).find(next => !/^\s+$/u.test(next.text))!.text);
      if (rtl !== previous) runs.push([]);
      runs.at(-1)!.push(cluster);previous = rtl;
    }
    for (const [runIndex, run] of runs.entries()) {
      const glyphs = [...run].sort((a, b) => a.x - b.x).map(cluster => ({ char: cluster.text, x: cluster.x, width: cluster.width }));
    for (let start = 0; start < glyphs.length; start += 240) {
      const batch = glyphs.slice(start, start + 240), procs: Record<string, PDFRef> = {}, differences: Array<number | string> = [1];
      for (const [i, scalar] of batch.entries()) {
        procs[`g${i}`] = pdf.context.register(pdf.context.flateStream(`${scalar.width * 1000 / size} 0 d0`));differences.push(`g${i}`);
      }
      const mappings = batch.map((scalar, i) => `<${(i + 1).toString(16).padStart(2, '0')}> <${hex(scalar.char)}>`).join('\n');
      const cmap = pdf.context.flateStream(`/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /DonDocsUnicode def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange ${batch.length} beginbfchar\n${mappings}\nendbfchar endcmap CMapName currentdict /CMap defineresource pop end end`);
      const ref = pdf.context.register(pdf.context.obj({ Type: 'Font', Subtype: 'Type3', FontBBox: [0, -200, 1200, 1000], FontMatrix: [.001, 0, 0, .001, 0, 0], CharProcs: procs,
        Encoding: { Type: 'Encoding', Differences: differences }, FirstChar: 1, LastChar: batch.length, Widths: batch.map(scalar => scalar.width * 1000 / size), Resources: {}, ToUnicode: pdf.context.register(cmap) }));
      const fontName = PDFName.of(`${name}_${runIndex}_${start}`);page.node.setFontDictionary(fontName, ref);
      page.pushOperators(beginText(), setFontAndSize(fontName, size), moveText(x + batch[0].x, y),
        showText(PDFHexString.of(batch.map((_, i) => (i + 1).toString(16).padStart(2, '0')).join(''))), endText());
    }
    }
    for (const mark of marks) {
      const range = document.createRange();range.setStart(node, mark.start);range.setEnd(node, mark.end);
      for (const rect of Array.from(range.getClientRects())) {
        const yMark = y + (mark.style === 'delete' ? size * .3 : -2);
        page.drawLine({ start: { x: x + rect.left - bounds.left, y: yMark }, end: { x: x + rect.right - bounds.left, y: yMark }, thickness: .8, color: mark.style === 'delete' ? rgb(.55, .08, .08) : rgb(0, .28, .15) });
      }
    }
  } finally { element.remove(); }
}
