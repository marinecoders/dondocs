import { test, expect } from '@playwright/test';
import { utils, write } from 'xlsx';

test.use({ serviceWorkers: 'block' });

test('uploads the first worksheet, maps a later header, and keeps roster corrections reachable', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('{{NAME}} {{MOS}}');
  await page.getByRole('textbox', { name: 'Paragraph 1', exact: true }).fill('{{EVENT_DATE}} {{BODY}}');
  await page.getByRole('button', { name: 'Batch', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Batch generation', exact: true });
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([
    ['Synthetic training roster'], [], ['NAME', 'MOS', 'EVENT_DATE', 'BODY'],
    ['Recipient A', 12, '03/04/2026', ''], ['Recipient B', '0013', '2026-04-04', 'Training example'],
  ]), 'Roster');
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([['Must not appear']]), 'Ignored');
  await modal.getByLabel('Upload Excel roster (.xlsx)').setInputFiles({
    name: 'synthetic-roster.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: write(workbook, { type: 'buffer', bookType: 'xlsx' }),
  });
  const preview = modal.getByRole('table', { name: 'First worksheet preview' });
  await expect(preview).toContainText('Recipient A');
  await expect(modal).not.toContainText('Must not appear');
  await expect(modal.getByRole('button', { name: 'Generate 1 PDF', exact: true })).toBeDisabled();
  await modal.getByLabel('Header row', { exact: true }).fill('3');
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('excel-roster-preview.png') });
  await modal.getByRole('button', { name: 'Map 2 roster rows', exact: true }).click();
  await expect(modal.getByRole('combobox', { name: 'Map column 1: NAME' })).toContainText('{{NAME}}');
  await expect(modal).toContainText('Ambiguous date');
  await expect(modal).toContainText('leading zeros may already be missing');
  await expect(modal).toContainText('BODY: Missing value');
  await page.screenshot({ path: testInfo.outputPath('excel-roster-checks.png') });
  await modal.getByRole('button', { name: 'Apply Mapping', exact: true }).click();
  await modal.getByRole('textbox', { name: 'Row 1: MOS', exact: true }).fill('0012');
  await modal.getByRole('textbox', { name: 'Row 1: EVENT_DATE', exact: true }).fill('2026-04-03');
  await modal.getByRole('textbox', { name: 'Row 1: BODY', exact: true }).fill('Corrected training example');
  await expect(modal).not.toContainText('Roster checks');
  await expect(modal.getByRole('textbox', { name: 'Row 2: MOS', exact: true })).toHaveValue('0013');
  await expect(modal.getByRole('button', { name: 'Generate 2 PDFs', exact: true })).toBeVisible();
  expect(await modal.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('excel-roster-mapped.png') });
});
