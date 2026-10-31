// @vitest-environment node
import { expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { getDocument, OPS, Util } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { companionSl3 } from '../_helpers/companionSl3';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';
import { pdfRules } from '../_helpers/pdfRules';
import { validateLetter } from '../../companion/validateLetter';
import { renderToFile } from '../../companion/renderToFile';

async function paintGeometry(bytes: Uint8Array, number: number) {
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  try {
    const ops = await (await pdf.getPage(number)).getOperatorList();
    let matrix = [1, 0, 0, 1, 0, 0];
    const stack: number[][] = [], bottoms: number[] = [];
    const rectangles: { width: number; height: number }[] = [];
    ops.fnArray.forEach((op, i) => {
      if (op === OPS.save) stack.push([...matrix]);
      else if (op === OPS.restore) matrix = stack.pop()!;
      else if (op === OPS.transform) matrix = Util.transform(matrix, ops.argsArray[i]);
      else if (op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject) {
        const points = [[0, 0], [1, 0], [0, 1], [1, 1]];
        for (const point of points) Util.applyTransform(point, matrix);
        bottoms.push(Math.min(...points.map((p) => p[1])));
      } else if (op === OPS.constructPath && ops.argsArray[i][0] === OPS.fill) {
        const [left, bottom, right, top] = ops.argsArray[i][2];
        const a = [left, bottom], b = [right, top];
        Util.applyTransform(a, matrix); Util.applyTransform(b, matrix);
        rectangles.push({ width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]) });
      }
    });
    return { bottoms, rectangles };
  } finally { await pdf.destroy(); }
}

it.each(['portrait', 'landscape'] as const)('renders MCO TAMCN bases and preserves the %s source cover and preface', async (orientation) => {
  const root = await mkdtemp(join(tmpdir(), 'dondocs-sl3-final-'));
  const input = companionSl3();
  input.publication!.sl3!.orientation = orientation;
  input.publication!.endItems![0].tamcn = 'B2565';
  Object.assign(input.publication!.sl3!.components[0], { tamcn: 'B2483', primaryTamcn: 'B2565', configurationRatio: '1:1' });
  input.publication!.sl3!.configurationReference = 'Synthetic comparison of the order’s example';
  const ids = ['A'.repeat(32), 'B'.repeat(32)];
  input.publication!.sl3!.endItemFigureId = ids[0];
  input.publication!.sl3!.components[0].figureId = ids[1];
  input.paragraphs = ids.map((referenceId, i) => ({ referenceId, text: i ? 'Training Adapter' : 'Tool Kit, Training', figure: { fileId: 'art' } }));
  input.publication!.sl3!.artwork = ids.map((figureId) => ({ figureId, lettering: 'none', labels: [] }));
  const png = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="white"/><rect x="100" y="100" width="1000" height="400" fill="none" stroke="black" stroke-width="4"/></svg>')).flatten({ background: 'white' }).png().toBuffer();
  input.attachments = [{ id: 'art', name: 'training.png', mimeType: 'image/png', dataBase64: png.toString('base64') }];
  expect(validateLetter(input)).toEqual([]);
  const result = await renderToFile(input, {}, root);
  const bytes = await readFile(result.path);
  const layout = await pdfTextLayout(bytes);
  expect(layout.collisions).toEqual([]);
  expect(layout.boxes.map((b) => b.text).join(' ')).toContain('B2483');
  const coverRules = await pdfRules(bytes, 1);
  const coverPaint = await paintGeometry(bytes, 1);
  expect(coverPaint.rectangles.filter((r) => Math.abs(r.height - 2.25) < 0.02 && r.width > 460)).toHaveLength(2);
  expect(coverRules.filter((r) => Math.abs(r.right - r.left) < 0.01 && r.top - r.bottom > 20)).toHaveLength(0);
  const scope = layout.boxes.find((b) => /^Scope\.?$/.test(b.text))!;
  const number = layout.boxes.find((b) => b.page === scope.page && b.text === '1.' && Math.abs(b.top - scope.top) < 2)!;
  expect(scope.left - number.left).toBeCloseTo(18, 1);
  const prefaceRules = await pdfRules(bytes, scope.page);
  expect(prefaceRules.some((r) => r.left <= scope.left + 0.2 && r.right >= scope.right - 0.2 && Math.abs(r.bottom - scope.bottom) < 5)).toBe(true);
  for (const [number, minimum] of [[1, 18], [2, 18]]) {
    const caption = layout.boxes.filter((b) => new RegExp(`^Figure\\s*${number}\\.`).test(b.text)).at(-1)!;
    expect(caption, `Figure ${number} must be printed`).toBeDefined();
    // Independent painted-image and font-ascent bounds, measured in PDF points.
    const painted = await paintGeometry(bytes, caption.page);
    expect(painted.bottoms).toHaveLength(1);
    expect(painted.bottoms[0] - caption.top).toBeGreaterThanOrEqual(minimum);
  }
}, 60000);
