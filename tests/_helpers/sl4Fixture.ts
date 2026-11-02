import { PDFDocument, rgb } from 'pdf-lib';
import { sl3Fixture } from './sl3Fixture';
import { sl4Example } from '@/data/techpub/sl4Examples';
import { figureFile } from '@/lib/figures';

export const SL4_FIGURE_ID = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
export function sl4Fixture() {
  const store = sl3Fixture();
  store.docType = 'sl4';
  store.formData.sl3 = undefined;
  store.formData.sl4 = sl4Example();
  store.formData.sl4.cutoffDate = '2026-10-30';
  store.formData.shortTitle = 'SL-4-12345A';
  store.formData.nomenclature = 'CONTROL BOX, TRAINING';
  store.formData.subject = 'REPAIR PARTS LIST FOR TRAINING CONTROL BOX';
  store.formData.sl4.endItemFigureId = SL4_FIGURE_ID;
  store.formData.sl4.artwork = [{ figureId: SL4_FIGURE_ID, lettering: 'none', labels: [] }];
  store.paragraphs = [{ referenceId: SL4_FIGURE_ID, level: 0, text: 'Control Box, Training', portionMarking: 'U', figure: {
    name: 'training-box.pdf', type: 'application/pdf', portionMarking: 'U',
    fileRef: { id: 'sl4-artwork', name: 'training-box.pdf', type: 'application/pdf', size: 1000 },
  } }];
  return store;
}
/** Fictional line drawing with no baked-in lettering, used only for verification. */
export async function sl4Artwork() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([360, 240]);
  page.drawRectangle({ x: 30, y: 30, width: 300, height: 180, borderColor: rgb(0, 0, 0), borderWidth: 2 });
  page.drawRectangle({ x: 70, y: 70, width: 220, height: 100, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  return { [figureFile(1, 'application/pdf', 'training-box.pdf', 'sl4-artwork')]: await pdf.save() };
}
