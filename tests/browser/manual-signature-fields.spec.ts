import { expect, test } from '@playwright/test';
import { PDFDocument, degrees } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

test.use({ serviceWorkers: 'block' });
test('retains manual positions across reload and exports real rotated PDF signature widgets', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
  const pdf = await PDFDocument.create();pdf.addPage([400, 600]).setRotation(degrees(90));
  await page.goto('/');
  async function open() { await page.getByRole('button', { name: 'Download', exact: true }).click();await page.getByRole('menuitem', { name: 'Signing workspace', exact: true }).click(); }
  await open();
  const dialog = page.getByRole('dialog', { name: 'Signing workspace', exact: true });
  await dialog.getByLabel('Unsigned PDF for signing').setInputFiles({ name: 'Synthetic.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await expect(dialog.getByText('Exact source PDF saved. Add the fields you need.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add signature box', exact: true }).click();
  await dialog.getByLabel('Signer name', { exact: true }).fill('JANE EXAMPLE');
  await dialog.getByLabel('Left (%)', { exact: true }).fill('20');await dialog.getByLabel('Top (%)', { exact: true }).fill('30');
  await dialog.getByLabel('Width (%)', { exact: true }).fill('40');await dialog.getByLabel('Height (%)', { exact: true }).fill('10');
  await dialog.getByRole('button', { name: 'Save signature placement', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Signature placement saved in this browser.');
  await page.reload();await open();
  await expect(dialog.getByLabel('Signer name', { exact: true })).toHaveValue('JANE EXAMPLE');
  await expect(dialog.getByLabel('Left (%)', { exact: true })).toHaveValue('20');
  await dialog.getByRole('combobox', { name: 'Signing preview zoom', exact: true }).selectOption('1.25');
  await expect(dialog.locator('canvas')).toBeVisible();
  await dialog.getByRole('checkbox').check();
  const download = page.waitForEvent('download');await dialog.getByRole('button', { name: 'Download PDF with signature boxes', exact: true }).click();
  const output = await PDFDocument.load(await readFile((await (await download).path())!));
  const fields = output.getForm().getFields();expect(fields).toHaveLength(1);expect(fields[0].getName()).toContain('JANE EXAMPLE');
  const rect = fields[0].acroField.getWidgets()[0].getRectangle();
  expect(rect.x).toBeCloseTo(120);expect(rect.y).toBeCloseTo(120);
  expect(rect.width).toBeCloseTo(40);expect(rect.height).toBeCloseTo(240);
});
