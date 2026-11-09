import { expect, it } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { renderFormPdf } from '@/services/pdf/genericFormRenderer';
import { formGeometryIssues, templatePageGeometry } from '@/services/forms/geometry';
import type { FormConfig } from '@/types/formConfig';
const box = { left: 10, top: 90, width: 30, height: 12 };
const config = (): FormConfig => ({ id: 'geometry', label: 'Geometry', directory: 'geometry', pages: ['page1.pdf'], sections: [], fields: { name: { type: 'text', label: 'Name', page: 1, box: { ...box } } } });
async function page() { const doc = await PDFDocument.create();doc.addPage([100, 100]);return doc; }
it('rejects impossible geometry against the actual page even for an empty answer', async () => {
  const cfg = config();cfg.fields.name.box.left = 101;
  await expect(renderFormPdf(cfg, {}, {}, async () => (await page()).save())).rejects.toThrow('fields.name');
});
it.each([90, 180, 270])('requires normalization of a %s-degree source instead of misplacing overlay text', async angle => {
  const doc = await page();doc.getPage(0).setRotation(degrees(angle));
  expect(() => templatePageGeometry(doc.getPage(0))).toThrow('Normalize');
});
it('checks every repeated row and uses explicit irregular row placements', () => {
  const cfg = config();cfg.fields = {};cfg.rowGroups = { roster: { title: 'Roster', page: 1, count: 3, rowStride: 40, columns: { name: { type: 'text', label: 'Name', page: 1, box } } } };
  expect(formGeometryIssues(cfg, [{ width: 100, height: 100 }])).toEqual([expect.stringContaining('roster.2.name')]);
  cfg.rowGroups.roster.placements = [{ name: box }, { name: { ...box, top: 60 } }, { name: { ...box, top: 30 } }];
  expect(formGeometryIssues(cfg, [{ width: 100, height: 100 }])).toEqual([]);
});
it('rejects a crop box that differs from the normalized coordinate space', async () => {
  const doc = await page();doc.getPage(0).setCropBox(10, 10, 80, 80);
  expect(() => templatePageGeometry(doc.getPage(0))).toThrow('Normalize');
});
it('owns legacy renderer inputs before loading a page', async () => {
  const cfg = config();const values = { name: 'Captured' };let release!: (bytes: Uint8Array) => void;
  let started!: () => void;const loaded = new Promise<void>(resolve => { started = resolve; });
  const pending = renderFormPdf(cfg, values, {}, () => new Promise(resolve => { release = resolve;started(); }));
  await loaded;
  values.name = 'Changed';cfg.fields.name.box.left = 200;
  release(await (await page()).save());
  expect((await PDFDocument.load(await pending)).getPageCount()).toBe(1);
});

it('keeps the captured overflow policy when the caller changes it during template loading', async () => {
  const cfg = config();
  cfg.fields.name.box = { left: 10, top: 90, width: 60, height: 15 };
  const policy: Record<string, 'error' | 'shrink'> = { name: 'error' };
  const diagnostics: import('@/services/forms/model').FormDiagnostic[] = [];
  let release!: (bytes: Uint8Array) => void;
  let started!: () => void;
  const loaded = new Promise<void>(resolve => { started = resolve; });
  const pending = renderFormPdf(cfg, { name: 'ABCDEFGHIJK' }, {},
    () => new Promise(resolve => { release = resolve;started(); }), diagnostics, policy);
  await loaded;
  policy.name = 'shrink';
  release(await (await page()).save());
  await pending;
  expect(diagnostics).toContainEqual(expect.objectContaining({ path: 'name', code: 'overflow' }));
});
