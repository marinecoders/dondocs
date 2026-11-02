// @vitest-environment node
import { expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { denseSl3Input } from '../_helpers/denseSl3';
import { renderToFile } from '../../companion/renderToFile';
import { pdfWordBoxes } from '../_helpers/pdfTableInsets';
import { pdfImages } from '../_helpers/pdfImages';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';

it.each(['portrait', 'landscape'] as const)('keeps missing illustrations in individual %s grid positions', async orientation => {
  const root = await mkdtemp(join(tmpdir(), 'sl3-missing-'));
  for (const capacity of [1,2,4,8,12,16] as const) for (const allMissing of [false,true]) {
    const input = await denseSl3Input(orientation, capacity);
    const missing = input.publication!.sl3!.components.flatMap((c,i) => {
      if (allMissing || i%3!==1) { c.figureId=''; return [i+1]; }
      return [];
    });
    input.paragraphs = input.paragraphs!.filter((_,i)=>!missing.includes(i+1));
    input.attachments = input.attachments!.filter((_,i)=>!missing.includes(i+1));
    input.publication!.sl3!.artwork = input.publication!.sl3!.artwork.filter((_,i)=>!missing.includes(i+1));
    const bytes = await readFile((await renderToFile(input,{},root)).path);
    const pdf = await PDFDocument.load(bytes);
    const words = pdfWordBoxes(bytes);
    const placeholders = words.filter(w=>w.text==='Not').flatMap(not => {
      const shown = words.find(w=>w.page===not.page && w.text==='Shown' && Math.abs(w.top-not.top)<1 && w.left>not.right && w.left-not.right<10);
      if (!shown) return [];
      const center = (not.left+shown.right)/2;
      // The placeholder is centered inside the image area; its item number
      // sits below that area's bottom, just like a real photograph's number.
      const number = words.filter(w=>w.page===not.page && /^\d+$/.test(w.text) && not.bottom-w.top>0 && not.bottom-w.top<200 && Math.abs((w.left+w.right)/2-center)<1).sort((a,b)=>b.top-a.top)[0];
      return number ? [{page:not.page, number:Number(number.text)}] : [];
    });
    expect(placeholders.map(p=>p.number).sort((a,b)=>a-b)).toEqual(missing);
    const plates = [];
    for (let page=1; page<=pdf.getPageCount(); page++) {
      const count = placeholders.filter(p=>p.page===page).length;
      // Only the cover has artwork outside the component illustration pages.
      const images = page>1 ? await pdfImages(bytes,page) : [];
      if (count || images.length) plates.push(count+images.length);
    }
    expect(plates).toEqual([15,16].flatMap(n=>Array.from({length:Math.ceil(n/capacity)},(_,i)=>Math.min(capacity,n-i*capacity))));
    const layout = await pdfTextLayout(bytes);
    expect(layout.collisions).toEqual([]);
    expect(layout.boxes.filter(b=>b.left<17.5 || b.right>pdf.getPage(b.page-1).getWidth()-17.5 || b.bottom<17.5 || b.top>pdf.getPage(b.page-1).getHeight()-17.5)).toEqual([]);
  }
}, 240000);
