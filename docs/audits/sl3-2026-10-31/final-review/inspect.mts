import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { pdfTextLayout } from '../../../../tests/_helpers/pdfTextLayout.ts';
import { pdfRules } from '../../../../tests/_helpers/pdfRules.ts';
import { SL3_PREFACE } from '../../../../src/data/techpub/sl3Preface.ts';

const root = resolve(process.argv[2] ?? '/tmp/dondocs-sl3-final-review');
await writeFile(join(root, 'fixed-preface.json'), JSON.stringify(SL3_PREFACE, null, 2) + '\n');
const report = [];
for (const orientation of ['portrait', 'landscape']) {
  const file = join(root, `complete-${orientation}.pdf`);
  const bytes = await readFile(file);
  const pdf = await PDFDocument.load(bytes);
  const layout = await pdfTextLayout(bytes);
  const outside = layout.boxes.filter((b) => b.left < 17.5 || b.right > pdf.getPage(b.page - 1).getWidth() - 17.5 || b.bottom < 17.5 || b.top > pdf.getPage(b.page - 1).getHeight() - 17.5);
  const page = pdf.getPages().at(-1)!;
  const rules = await pdfRules(bytes, pdf.getPageCount());
  const writingRules = rules.filter((r) => r.right - r.left > 100 && r.right - r.left < 400 && Math.abs(r.top - r.bottom) < 0.01);
  const signature = pdf.getForm().getField('Signature1').acroField.getWidgets()[0];
  const signaturePage = pdf.getPages().findIndex((p) => p.ref.toString() === signature.P()?.toString()) + 1;
  report.push({ file: `complete-${orientation}.pdf`, sha256: createHash('sha256').update(bytes).digest('hex'), pages: pdf.getPageCount(), pageSizes: [...new Set(pdf.getPages().map((p) => `${p.getWidth()}x${p.getHeight()}`))], collisions: layout.collisions, outside, textBoxes: layout.boxes.length, signaturePage, signatureBounds: signature.getRectangle(), finalPageSize: [page.getWidth(), page.getHeight()], writingRules: writingRules.length, captionPages: [1, 2].map((n) => layout.boxes.filter((b) => new RegExp(`^Figure\\s*${n}\\.`).test(b.text)).at(-1)?.page) });
}
await writeFile(join(root, 'layout-observations.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
if (report.some((r) => r.collisions.length || r.outside.length)) process.exitCode = 1;
