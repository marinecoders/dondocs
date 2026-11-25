import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { downloadPackageExport, importPackage, newPackage, openPackageWorkspace, packageSection } from './_helpers/packageWorkspace';

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
  await workspace.getByRole('button', { name: 'Draft PDF', exact: true }).click();
  await workspace.getByRole('button', { name: 'Prepare draft PDF' }).click();
  await expect(workspace.getByRole('button', { name: 'Download draft PDF' })).toBeDisabled();
  await packageSection(workspace, 'Documents');
  await workspace.getByText('Add printable copy', { exact: true }).click();
  const upload = workspace.getByLabel('Printable PDF for source.pdf');
  await upload.setInputFiles({ name: 'pages.pdf', mimeType: 'application/pdf', buffer: printable });
  await workspace.getByRole('button', { name: 'Use reviewed printable copy' }).click();
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
    await restored.getByRole('button', { name: 'Draft PDF', exact: true }).click();
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
