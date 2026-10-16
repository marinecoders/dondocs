import { getDocument, OPS, Util } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Axis-aligned stroked rules in PDF coordinates, deduplicated by geometry. */
export async function pdfRules(bytes: Uint8Array, pageNumber: number) {
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
  try {
    const ops = await (await pdf.getPage(pageNumber)).getOperatorList();
    let state = { matrix: [1, 0, 0, 1, 0, 0], width: 1 };
    const stack: typeof state[] = [];
    const rules = new Map<string, { left: number; right: number; bottom: number; top: number; weight: number }>();
    ops.fnArray.forEach((op, i) => {
      const args = ops.argsArray[i];
      if (op === OPS.save) stack.push({ ...state, matrix: [...state.matrix] });
      else if (op === OPS.restore) state = stack.pop()!;
      else if (op === OPS.transform) state.matrix = Util.transform(state.matrix, args);
      else if (op === OPS.setLineWidth) state.width = args[0];
      else if (op === OPS.constructPath && args[0] === OPS.stroke) {
        const bounds = args[2];
        if (!bounds || (bounds[0] !== bounds[2] && bounds[1] !== bounds[3])) return;
        const a = [bounds[0], bounds[1]], b = [bounds[2], bounds[3]];
        Util.applyTransform(a, state.matrix);
        Util.applyTransform(b, state.matrix);
        const horizontal = Math.abs(a[1] - b[1]) < 0.001;
        const rule = { left: Math.min(a[0], b[0]), right: Math.max(a[0], b[0]), bottom: Math.min(a[1], b[1]), top: Math.max(a[1], b[1]),
          weight: state.width * (horizontal ? Math.hypot(state.matrix[2], state.matrix[3]) : Math.hypot(state.matrix[0], state.matrix[1])) };
        rules.set(JSON.stringify(rule), rule);
      }
    });
    return [...rules.values()];
  } finally { await pdf.destroy(); }
}
