import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { assertFormConfig } from '../src/types/formConfig';
import { adaptLegacyForm, compileFormDefinition } from '../src/services/forms/model';
import { templatePageGeometry } from '../src/services/forms/geometry';

export interface GeometryInventory { checked: number; failures: Record<string, string> }
/** Inspect committed published definitions, independently of answer values. */
export async function inspectFormGeometry(root: string): Promise<GeometryInventory> {
  const report: GeometryInventory = { checked: 0, failures: {} };
  const visit = async (directory: string): Promise<void> => {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) { await visit(file);continue; }
      if (entry.name !== 'form.json') continue;
      const key = relative(root, file).replaceAll('\\', '/');report.checked++;
      try {
        const input = JSON.parse(await readFile(file, 'utf8'));
        const names: string[] = input.schemaVersion === 2 ? input.pages.map((p: { file: string }) => p.file) : input.pages;
        if (!Array.isArray(names) || !names.length || names.some(name => !/^[A-Za-z0-9_.-]+\.pdf$/.test(name))) throw new Error('Invalid template page filenames');
        const pages = await Promise.all(names.map(async name => {
          const pdf = await PDFDocument.load(await readFile(join(directory, name)));
          if (pdf.getPageCount() !== 1) throw new Error(`${name}: expected one template page`);
          return { file: name, ...templatePageGeometry(pdf.getPage(0)) };
        }));
        if (input.schemaVersion === 2) {
          const d = compileFormDefinition(input);
          for (const [i, page] of d.pages.entries()) if (Math.abs(page.width - pages[i].width) > 0.1 || Math.abs(page.height - pages[i].height) > 0.1) throw new Error(`${page.file}: declared dimensions differ from the actual page`);
        } else adaptLegacyForm(assertFormConfig(input, key), pages);
      } catch (error) { report.failures[key] = error instanceof Error ? error.message : 'Unreadable form geometry'; }
    }
  };
  await visit(root);return report;
}
