import { expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { renderFormPdf } from '@/services/pdf/genericFormRenderer';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';
import type { FormConfig } from '@/types/formConfig';
import { adaptLegacyForm } from '@/services/forms/model';
import { renderForm } from '@/services/forms/render';

it('preserves vertical margin placements through legacy adaptation and native export', async () => {
  const template = await PDFDocument.create();template.addPage([612, 792]);
  const bytes = await template.save();
  const side = { type: 'text' as const, label: 'Incident number', page: 1, rotation: 270 as const, box: { left: 583, top: 679.7, width: 9.9, height: 126.6 } };
  const config: FormConfig = { id: 'vertical', label: 'Vertical', directory: 'vertical', pages: ['page1.pdf'], sections: [], fields: {
    side, normal: { type: 'text', label: 'Normal', page: 1, box: { left: 40, top: 700, width: 150, height: 18 } },
  }, rowGroups: {
    rows: { title: 'Rows', page: 1, count: 1, rowStride: 20, columns: { side: { ...side, box: { ...side.box, left: 20, top: 500 } } } },
  } };
  const definition = adaptLegacyForm(config, [{ width: 612, height: 792 }]);
  const rendered = await renderForm({ definition, answers: { side: '2026-01234', normal: 'Horizontal' }, rows: {
    rows: [{ id: 'row', answers: { side: 'ROWMARGIN' } }],
  }, answerRevision: 1 }, 'export', async () => bytes);
  expect(rendered.diagnostics).toEqual([]);
  const { boxes } = await pdfTextLayout(rendered.bytes);
  for (const [value, box] of [['2026-01234', side.box], ['ROWMARGIN', config.rowGroups!.rows.columns.side.box]] as const) {
    const word = boxes.find(item => item.text === value);expect(word).toBeDefined();
    expect(word!.left).toBeGreaterThanOrEqual(box.left);
    expect(word!.right).toBeLessThanOrEqual(box.left + box.width);
    expect(word!.bottom).toBeGreaterThanOrEqual(box.top - box.height);
    expect(word!.top).toBeLessThanOrEqual(box.top);
    expect(word!.top - word!.bottom).toBeGreaterThan(word!.right - word!.left);
  }
  const normal = boxes.find(item => item.text === 'Horizontal')!;
  expect(normal.left).toBeGreaterThanOrEqual(40);
  expect(normal.right).toBeLessThanOrEqual(190);
  expect(normal.right - normal.left).toBeGreaterThan(normal.top - normal.bottom);
});

it('renders each irregular legacy row in its declared box', async () => {
  const template = await PDFDocument.create();template.addPage([300, 300]);
  const bytes = await template.save();
  const tops = [250, 180, 100];
  const boxes = tops.map(top => ({ left: 30, top, width: 150, height: 18 }));
  const config: FormConfig = { id: 'rows', label: 'Rows', directory: 'rows', pages: ['page1.pdf'], fields: {}, sections: [], rowGroups: {
    roster: { title: 'Roster', page: 1, count: 3, rowStride: 40, columns: { name: { type: 'text', label: 'Name', page: 1, box: boxes[0] } }, placements: boxes.map(name => ({ name })) },
  } };
  const rendered = await renderFormPdf(config, {}, { roster: ['First', 'Second', 'Third'].map(name => ({ name })) }, async () => bytes);
  const { boxes: text, collisions } = await pdfTextLayout(rendered);
  expect(collisions).toEqual([]);
  for (const [i, name] of ['First', 'Second', 'Third'].entries()) {
    const word = text.find(item => item.text === name);expect(word).toBeDefined();
    expect(word!.left).toBeGreaterThanOrEqual(boxes[i].left);
    expect(word!.right).toBeLessThanOrEqual(boxes[i].left + boxes[i].width);
    expect(word!.bottom).toBeGreaterThanOrEqual(boxes[i].top - boxes[i].height - 0.1);
    expect(word!.top).toBeLessThanOrEqual(boxes[i].top + 0.1);
  }
});
