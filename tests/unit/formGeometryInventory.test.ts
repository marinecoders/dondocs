import { expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { inspectFormGeometry } from '../../scripts/form-geometry-lib';

it('checks legacy published configs against their actual template and every generated row', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dondocs-geometry-'));
  try {
    const directory = join(root, 'fixture');await mkdir(directory);
    const doc = await PDFDocument.create();doc.addPage([100, 100]);await writeFile(join(directory, 'page1.pdf'), await doc.save());
    const config = { id: 'fixture', label: 'Fixture', directory: 'fixture', pages: ['page1.pdf'], fields: {}, sections: [], rowGroups: {
      roster: { title: 'Roster', page: 1, count: 3, rowStride: 40, columns: { name: { type: 'text', label: 'Name', page: 1, box: { left: 10, top: 90, width: 30, height: 12 } } } },
    } };
    await writeFile(join(directory, 'form.json'), JSON.stringify(config));
    const invalid = await inspectFormGeometry(root);
    expect(invalid.checked).toBe(1);expect(Object.keys(invalid.failures)).toEqual(['fixture/form.json']);expect(invalid.failures['fixture/form.json']).toContain('outside page');
    config.rowGroups.roster.rowStride = 25;await writeFile(join(directory, 'form.json'), JSON.stringify(config));
    expect(await inspectFormGeometry(root)).toEqual({ checked: 1, failures: {} });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('detects a misplaced native widget on a later page of the retained official PDF', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dondocs-native-geometry-'));
  const source = resolve('public/templates/NAVMC10132 - Unit Punishment Book');
  try {
    const definition = JSON.parse(await readFile(join(source, 'form.json'), 'utf8'));
    await symlink(join(source, 'original.pdf'), join(root, 'original.pdf'));
    await writeFile(join(root, 'form.json'), JSON.stringify(definition));
    expect(await inspectFormGeometry(root)).toEqual({ checked: 1, failures: {} });
    const placement = definition.placements.find((item: { page: number }) => item.page === 2);
    placement.box.left += 1;
    await writeFile(join(root, 'form.json'), JSON.stringify(definition));
    expect((await inspectFormGeometry(root)).failures['form.json']).toBe(
      `Page 2: ${placement.fieldId} does not match a native widget`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
