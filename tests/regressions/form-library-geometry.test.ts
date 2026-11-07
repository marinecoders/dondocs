import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { assertFormConfig, type FormFieldBox } from '@/types/formConfig';

const directories = [
  'NAVMC11537A - Reserve Reenlistment Extension Lateral Move (rrelm) Request',
  'NAVMC11631 - Water Survival Stroke Evaluation Checklist',
  'OPNAV5580-1 - Incident Report',
];

describe.each(directories)('Finding 22: %s', directory => {
  it('keeps published and draft placements inside their actual PDF pages', async () => {
    const root = join(process.cwd(), 'public/templates', directory);
    const config = assertFormConfig(JSON.parse(await readFile(join(root, 'form.json'), 'utf8')), directory);
    const draft = assertFormConfig(JSON.parse(await readFile(join(root, 'form.draft.json'), 'utf8')), directory);
    const raw = JSON.parse(await readFile(join(root, 'boxes.draft.json'), 'utf8')) as {
      pages: Record<string, Record<string, FormFieldBox & { rotation?: 270 }>>;
    };
    const pages = await Promise.all(config.pages.map(async file => {
      const pdf = await PDFDocument.load(await readFile(join(root, file)));
      expect(pdf.getPageCount()).toBe(1);
      const page = pdf.getPage(0);
      expect(page.getRotation().angle).toBe(0);
      return page.getSize();
    }));
    const check = (box: FormFieldBox, page: number, key: string) => {
      const size = pages[page - 1];
      expect(size, key).toBeDefined();
      expect(box.left, key).toBeGreaterThanOrEqual(0);
      expect(box.width, key).toBeGreaterThan(0);
      expect(box.height, key).toBeGreaterThan(0);
      expect(box.left + box.width, key).toBeLessThanOrEqual(size.width + 0.1);
      expect(box.top, key).toBeLessThanOrEqual(size.height + 0.1);
      expect(box.top - box.height, key).toBeGreaterThanOrEqual(-0.1);
    };
    expect(draft.pages).toEqual(config.pages);
    expect(Object.keys(draft.fields)).toEqual(Object.keys(config.fields));
    for (const [key, field] of Object.entries(config.fields)) {
      check(field.box, field.page, key);
      expect(draft.fields[key].box, key).toEqual(field.box);
      expect(draft.fields[key].rotation, key).toBe(field.rotation);
      const harvested = raw.pages[`page${field.page}`][key];
      for (const dimension of ['left', 'top', 'width', 'height'] as const) {
        expect(harvested[dimension], key).toBe(field.box[dimension]);
      }
      expect(harvested.rotation, key).toBe(field.rotation);
    }
    for (const [key, group] of Object.entries(config.rowGroups ?? {})) {
      for (let row = 0; row < group.count; row++) {
        for (const [column, field] of Object.entries(group.columns)) {
          check({ ...field.box, top: field.box.top - row * group.rowStride }, group.page, `${key}.${row}.${column}`);
        }
      }
    }
  });
});
