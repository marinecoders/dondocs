import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { newBlankPackage, openAddDocuments, openPackageWorkspace, packageSection } from './_helpers/packageWorkspace';
import { PDFDocument } from 'pdf-lib';

test('downloads the native Administrative Action form from a new standalone draft', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Forms', exact: true }).click();
  await expect(page.locator('#actionNo')).toBeVisible();
  await page.locator('#actionNo').fill('TEST-10274');
  await page.locator('#actionNo').blur();
  await expect(page.getByText('The editable PDF includes all three official pages.')).toBeVisible();
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const download = page.waitForEvent('download', { timeout: 25000 });
  await page.getByRole('menuitem', { name: 'Download PDF' }).click();
  const file = await (await download).path();
  const pdf = await PDFDocument.load(await readFile(file!));
  expect(pdf.getPageCount()).toBe(3);
  expect(pdf.getForm().getTextField('form1[0].ActNum[0]').getText()).toBe('TEST-10274');
});

test('edits an official Administrative Action inside a package and delivers its printed PDF', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Forms', exact: true }).click();
  await expect(page.locator('#actionNo')).toBeVisible();
  const workspace = await openPackageWorkspace(page);
  await newBlankPackage(workspace, 'Training action');
  await packageSection(workspace, 'Documents', true);
  await openAddDocuments(workspace);
  await workspace.getByRole('button', { name: 'Forms', exact: true }).click();
  await workspace.getByRole('searchbox', { name: 'Search documents to add' }).fill('10274');
  await workspace.getByRole('button', { name: 'Add NAVMC 10274 - Administrative Action' }).click();
  await workspace.getByRole('button', { name: 'Edit document', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Training action', exact: true });
  await editor.locator('#actionNo').fill('PKG-10274');
  await editor.locator('#actionNo').blur();
  await expect(editor.getByText('Saved to package', { exact: true })).toBeVisible();
  await page.reload();
  await expect(editor.locator('#actionNo')).toHaveValue('PKG-10274');
  await editor.getByRole('button', { name: 'Back to package' }).click();
  await packageSection(workspace, 'Delivery');
  await workspace.getByRole('button', { name: 'Receive original files' }).click();
  const delivery = workspace.getByRole('region', { name: 'Recipient delivery' });
  await delivery.getByLabel('Delivery scope').selectOption('selected');
  await delivery.getByRole('checkbox', { name: /^Include / }).first().check();
  await delivery.getByRole('button', { name: 'Prepare selected delivery' }).click();
  const download = delivery.getByRole('button', { name: 'Download reviewed delivery bundle' });
  await expect(download).toBeEnabled({ timeout: 30000 });
  const file = page.waitForEvent('download');
  await download.click();
  const archive = await JSZip.loadAsync(await readFile((await (await file).path())!));
  const files = archive.file(/\.pdf$/);
  expect(files).toHaveLength(1);
  const bytes = await files[0].async('uint8array');
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  const printed = await getDocument({ data: bytes, isEvalSupported: false }).promise;
  try {
    const text = await (await printed.getPage(1)).getTextContent();
    expect(text.items.some(item => 'str' in item && item.str.includes('PKG-10274'))).toBe(true);
  } finally { await printed.destroy(); }
});

test('the signing workspace identifies an official form without CAC fields before connecting', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Signing workspace', exact: true }).click();
  const workspace = page.getByRole('dialog', { name: 'Signing workspace' });
  await workspace.getByLabel('Open PDF').setInputFiles('public/templates/NAVMC10274 - Administrative Action/2020-07/original.pdf');
  await expect(workspace.getByRole('alert')).toHaveText('This official PDF has no supported CAC signature fields.');
  await expect(workspace.getByRole('button', { name: 'Connect CAC' })).toHaveCount(0);
});
