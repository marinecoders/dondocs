import { expect, test } from '@playwright/test';
import { newBlankPackage, openPackageWorkspace, packageSection } from './_helpers/packageWorkspace';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { editorLayout: 'scroll', previewVisible: false } }));
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
});

test('edits staff papers through correspondence', async ({ page }) => {
  const picker = page.getByRole('button', { name: /^Correspondence type:/ });
  await picker.click();
  await expect(page.getByRole('group', { name: 'Staff Papers' }).getByRole('option')).toHaveCount(3);
  await page.getByRole('option', { name: 'HQMC Information Paper', exact: true }).click();
  await page.getByLabel('Prepared by', { exact: true }).fill('Casey Example');
  await expect(page.getByLabel('Subject', { exact: true }).filter({ visible: true })).toHaveCount(1);
  await picker.click();
  await page.getByRole('option', { name: 'Naval Letter (on letterhead)', exact: true }).click();
  await picker.click();
  await page.getByRole('option', { name: 'HQMC Information Paper', exact: true }).click();
  await expect(page.getByLabel('Prepared by', { exact: true })).toHaveValue('Casey Example');
  await picker.click();
  await page.getByRole('option', { name: 'HQMC Position/Decision Paper', exact: true }).click();
  const officials = page.getByLabel('Officials in routing order', { exact: true });
  await expect(officials).toHaveValue(/DMCS\nACMC\nCMC$/);
  await officials.fill('Executive Officer\nCommanding Officer');
  await expect(officials).toHaveValue('Executive Officer\nCommanding Officer');
});

test('adds a native coordination sheet directly to a package', async ({ page }) => {
  const dialog = await openPackageWorkspace(page);
  await newBlankPackage(dialog, 'Administrative package');
  await packageSection(dialog, 'Documents');
  const button = dialog.getByRole('button', { name: 'Add coordination page', exact: true });
  if (!await button.isVisible()) await dialog.getByText('Add documents', { exact: true }).click();
  await button.click();
  await expect(dialog.getByRole('heading', { name: '1. Coordination page', exact: true })).toBeVisible();
  await dialog.getByText('Document details', { exact: true }).click();
  await expect(dialog.getByLabel('Role for Coordination page', { exact: true })).toHaveValue('coordination-sheet');
  await dialog.getByRole('button', { name: 'Edit document', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Correspondence type: Coordination Page', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add coordinating office', exact: true }).click();
  await page.getByLabel('Office', { exact: true }).fill('Operations');
  await expect(page.getByLabel('Office', { exact: true })).toHaveValue('Operations');
});
