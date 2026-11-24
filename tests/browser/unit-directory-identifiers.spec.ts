import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('looks up identifiers and former names and applies a Navy unit to the letterhead', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { editorLayout: 'scroll', previewVisible: false }, version: 1 }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Browse Units', exact: true }).click();

  const directory = page.getByRole('dialog', { name: /^Unit Directory/ });
  const search = directory.getByRole('textbox', { name: 'Search unit directory' });
  await expect(search).toBeEnabled();
  await search.fill('RUC: 00910');
  const marineUnit = directory.getByRole('button', { name: /1ST LAAD BN/ });
  await expect(marineUnit.getByText('RUC 00910', { exact: true })).toBeVisible();
  await expect(marineUnit.getByText('UIC M00910', { exact: true })).toBeVisible();
  await expect(marineUnit.getByText('MCC 1PC', { exact: true })).toBeVisible();

  await search.fill('mcc 1pc');
  await expect(marineUnit).toBeVisible();
  await search.fill('3rd Marine Regiment');
  const regiment = directory.getByRole('button', { name: /3D MAR LITTORAL REGT 3D MARDIV/ });
  await expect(regiment.getByText('Formerly 3d Marine Regiment')).toBeVisible();

  await search.fill(' uic : n65888 ');
  const navyUnit = directory.getByRole('button', { name: /FLEET READINESS CENTER SOUTHWEST/ });
  await expect(navyUnit.getByText('UIC N65888', { exact: true })).toBeVisible();
  await expect(navyUnit.getByText('San Diego, CA 92135-7058', { exact: false })).toBeVisible();
  await expect(directory.getByText('1 unit found')).toBeVisible();
  expect(await directory.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
  await navyUnit.click();
  await expect(directory).toBeHidden();
  await expect(page.locator('#unitLine1')).toHaveValue('FLEET READINESS CENTER SOUTHWEST');
  await expect(page.locator('#addressStreet')).toHaveValue('PO BOX 357058');
  await expect(page.locator('#addressCity')).toHaveValue('SAN DIEGO');
  await expect(page.locator('#addressState')).toHaveValue('CA');
  await expect(page.locator('#addressZip')).toHaveValue('92135-7058');
});
