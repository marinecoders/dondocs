import { getDocument, OPS, Util } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Painted image rectangles, independently of the generated TeX boxes. */
export async function pdfImages(bytes: Uint8Array, pageNumber: number) {
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  try {
    const ops = await (await pdf.getPage(pageNumber)).getOperatorList();
    let matrix = [1, 0, 0, 1, 0, 0];
    const stack: number[][] = [];
    const images: { left: number; right: number; top: number; bottom: number; width: number; height: number }[] = [];
    ops.fnArray.forEach((op, i) => {
      const args = ops.argsArray[i];
      if (op === OPS.save) stack.push([...matrix]);
      else if (op === OPS.restore) matrix = stack.pop()!;
      else if (op === OPS.transform) matrix = Util.transform(matrix, args);
      else if (op === OPS.paintImageXObject) {
        const points = [[0, 0], [1, 0], [0, 1], [1, 1]];
        points.forEach(p => Util.applyTransform(p, matrix));
        images.push({ left: Math.min(...points.map(p => p[0])), right: Math.max(...points.map(p => p[0])),
          bottom: Math.min(...points.map(p => p[1])), top: Math.max(...points.map(p => p[1])), width: args[1], height: args[2] });
      }
    });
    return images;
  } finally { await pdf.destroy(); }
}
