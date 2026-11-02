// @vitest-environment node
import { expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { getDocument, OPS, Util } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFArray, PDFDict, PDFName, PDFString } from 'pdf-lib';
import { SL3_PREFACE } from '../../src/data/techpub/sl3Preface';
import { companionSl3 } from '../_helpers/companionSl3';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';
import { pdfRules } from '../_helpers/pdfRules';
import { pdfWordBoxes } from '../_helpers/pdfTableInsets';
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
  const pdf = await PDFDocument.load(bytes);
  const names = pdf.catalog.lookup(PDFName.of('Names'), PDFDict).lookup(PDFName.of('Dests'), PDFDict).lookup(PDFName.of('Names'), PDFArray);
  const normalize = (value: string) => value.replace(/[^A-Za-z0-9]/g, '');
  for (const [paragraph, note] of [[9, SL3_PREFACE[9]], [11, SL3_PREFACE[12]]] as const) {
    expect(note.note).toBe(true);
    const index = Array.from({length:names.size()/2}, (_,i)=>i*2).find(i=>names.lookup(i, PDFString).decodeText()===`sl3.preface.${paragraph}`)!;
    const ref = names.lookup(index+1, PDFArray).get(0)!.toString();
    const page = pdf.getPages().findIndex(p=>p.ref.toString()===ref)+1;
    const pageText = normalize(layout.boxes.filter(b=>b.page===page).map(b=>b.text).join(''));
    expect(pageText).toContain(normalize(note.text));
    const heading = normalize(SL3_PREFACE[paragraph === 9 ? 8 : 11].text.split('.  ')[0]);
    expect(pageText.indexOf(normalize(note.text))).toBeLessThan(pageText.indexOf(heading));
    if (paragraph === 11) {
      const words = pdfWordBoxes(bytes).filter(w=>w.page===page);
      const refer = words.find(w=>w.text==='Refer')!;
      const to = words.find(w=>w.text==='to' && Math.abs(w.top-refer.top)<1 && w.left>refer.right)!;
      // A minipage must not reset the Marine Corps' unjustified right margin
      // and stretch the first line's ordinary interword spaces.
      expect(to.left-refer.right).toBeGreaterThan(2);
      expect(to.left-refer.right).toBeLessThan(3.5);
    }
  }
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
