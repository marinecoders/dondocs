import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { choosePackage, downloadPackageExport, importPackage, newPackage, openPackageWorkspace, packageSection } from './_helpers/packageWorkspace';

test('XFA originals travel intact beside the reviewed pages used by the combined PDF', async ({ page, browser, baseURL }) => {
  const input = await PDFDocument.create();
  input.addPage().drawText('Original interactive file');
  const form = input.getForm().acroForm.dict;
  form.set(PDFName.of('XFA'), input.context.register(input.context.stream('<xfa/>')));
  const original = Buffer.from(await input.save());
  const print = await PDFDocument.create();
  print.addPage().drawText('PRINTED TEST CONTENT');
  const printable = Buffer.from(await print.save());
  await page.goto('/');
  await page.getByRole('button', { name: 'Start writing' }).click();
  const workspace = await openPackageWorkspace(page);
  await newPackage(workspace);
  const custom = workspace.getByRole('group', { name: 'Custom package' });
  await custom.getByLabel('Package name').fill('Printable transfer');
  await custom.getByRole('button', { name: 'Create package' }).click();
  await workspace.getByLabel('Add original PDF', { exact: true }).setInputFiles({ name: 'source.pdf', mimeType: 'application/pdf', buffer: original });
  await expect(workspace.getByText(/A printable copy is needed/)).toBeVisible();
  await packageSection(workspace, 'Delivery');
  await workspace.getByRole('checkbox', { name: 'Draft PDF', exact: true }).check();
  await workspace.getByRole('button', { name: 'Prepare draft PDF' }).click();
  await expect(workspace.getByRole('button', { name: 'Download draft PDF' })).toBeDisabled();
  await packageSection(workspace, 'Documents');
  await workspace.getByText('Add printable copy', { exact: true }).click();
  const upload = workspace.getByLabel('Printable PDF for source.pdf');
  await upload.setInputFiles({ name: 'pages.pdf', mimeType: 'application/pdf', buffer: printable });
  await workspace.getByRole('button', { name: 'Use these pages' }).click();
  await expect(workspace.getByText(/Combined PDF uses/)).toContainText('pages.pdf');
  const portable = await downloadPackageExport(page, workspace, 'Export editable package', 'Download editable package');
  const entries: { name: string; data: string }[] = JSON.parse(portable.toString()).portableResources.entries;
  expect(entries.find(entry => entry.name === 'source.pdf')?.data).toEqual(original.toString('base64'));
  expect(entries.find(entry => entry.name === 'pages.pdf')?.data).toEqual(printable.toString('base64'));
  const fresh = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  try {
    const other = await fresh.newPage();
    await other.goto('/');
    await other.getByRole('button', { name: 'Start writing' }).click();
    const restored = await openPackageWorkspace(other);
    await importPackage(restored, { name: 'portable.json', mimeType: 'application/json', buffer: portable });
    await packageSection(restored, 'Delivery');
    await restored.getByRole('checkbox', { name: 'Draft PDF', exact: true }).check();
    await restored.getByRole('button', { name: 'Prepare draft PDF' }).click();
    const pending = other.waitForEvent('download');
    await restored.getByRole('button', { name: 'Download draft PDF' }).click();
    const pdf = await getDocument({ data: new Uint8Array(await readFile((await (await pending).path())!)), useSystemFonts: true }).promise;
    try {
      const content = await (await pdf.getPage(1)).getTextContent();
      expect(content.items.map(item => 'str' in item ? item.str : '').join(' ')).toContain('PRINTED TEST CONTENT');
    } finally { await pdf.destroy(); }
  } finally { await fresh.close(); }
});

test('reviews the current candidate, preserves approved pages on cancel, and exports the accepted file', async ({ page }) => {
  async function file(name: string, labels: string[]) {
    const pdf = await PDFDocument.create();
    for (const label of labels) pdf.addPage().drawText(label);
    return { name, mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
  }
  const source = await file('original.pdf', ['SOURCE 1', 'SOURCE 2']);
  const first = await file('copy.pdf', ['ALPHA']);
  const second = await file('copy.pdf', ['BRAVO']);
  await page.goto('/'); await page.getByRole('button', { name: 'Start writing' }).click();
  const workspace = await openPackageWorkspace(page); await newPackage(workspace);
  const custom = workspace.getByRole('group', { name: 'Custom package' });
  await custom.getByLabel('Package name').fill('Printable review');
  await custom.getByRole('button', { name: 'Create package' }).click();
  await workspace.getByLabel('Uploaded original is signed (preserve unchanged)').check();
  await workspace.getByLabel('Add original PDF', { exact: true }).setInputFiles(source);
  await workspace.getByText('Add printable copy', { exact: true }).click();
  const input = workspace.getByLabel('Printable PDF for original.pdf');
  await input.setInputFiles(first); await input.setInputFiles(second);
  const review = workspace.getByRole('region', { name: 'Review printable pages' });
  const use = review.getByRole('button', { name: 'Use 1 page anyway' });
  await expect(use).toBeEnabled();
  const preview = await review.locator('[data-pdf-layer="active"]').getAttribute('data-preview-blob');
  const bytes = await page.evaluate(async url => Array.from(new Uint8Array(await (await fetch(url!)).arrayBuffer())), preview);
  const pdf = await getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true }).promise;
  try {
    expect((await (await pdf.getPage(1)).getTextContent()).items.map(item => 'str' in item && item.str)).toContain('BRAVO');
  } finally { await pdf.destroy(); }
  await use.click();
  const saved = workspace.getByRole('region', { name: 'Preview of original.pdf' });
  const selector = saved.getByLabel('Preview file');
  await expect(selector).toHaveValue('original');
  for (const [choice, expected] of [['original', source], ['print', second]] as const) {
    await selector.selectOption(choice);
    await expect.poll(async () => {
      const url = await saved.locator('[data-pdf-layer="active"]').getAttribute('data-preview-blob');
      return saved.evaluate(async (_, url) => {
        const bytes = await (await fetch(url!)).arrayBuffer();
        return Array.from(new Uint8Array(bytes));
      }, url);
    }).toEqual(Array.from(expected.buffer));
  }
  await workspace.getByText('Manage printable copy', { exact: true }).click();
  await input.setInputFiles(first); await expect(use).toBeEnabled(); await review.getByRole('button', { name: 'Cancel' }).click();
  await page.reload();
  const restored = await openPackageWorkspace(page);
  await choosePackage(restored, 'Printable review');
  const exported = await downloadPackageExport(page, restored, 'Export editable package', 'Download editable package');
  const entries: { name: string; data: string }[] = JSON.parse(exported.toString()).portableResources.entries;
  expect(entries.find(entry => entry.name === 'copy.pdf')?.data).toEqual(second.buffer.toString('base64'));
});
