import { expect, test } from '@playwright/test';

test('opens a standalone form in Full document and remembers a deliberate One section choice', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Forms', exact: true }).click();
  await page.getByRole('button', { name: 'Form type' }).click();
  await page.getByLabel('Search forms').fill('118');
  await page.getByRole('option', { name: /Administrative Remarks|Page 11/i }).first().click();
  await expect(page.locator('#sec-marine')).toBeVisible();
  await expect(page.locator('#sec-signatures')).toBeVisible();
  const view = page.getByRole('button', { name: 'Editor view' });
  await view.click();
  await expect(page.getByRole('menuitemradio', { name: /Full document/ })).toBeChecked();
  await page.getByRole('menuitemradio', { name: /One section/ }).click();
  await page.getByLabel('Document section', { exact: true }).selectOption('signatures');
  await expect(page.locator('#sec-marine')).toBeHidden();
  await page.reload();
  // The library can reopen the last saved letter when this form has no edits.
  if (!await page.locator('[data-editor-kind="forms"]').count()) {
    await page.getByRole('button', { name: 'Forms', exact: true }).click();
  }
  await expect(page.locator('[data-editor-kind="forms"]')).toBeVisible();
  await expect(page.getByLabel('Document section', { exact: true })).toBeVisible();
  await view.click();
  await expect(page.getByRole('menuitemradio', { name: /One section/ })).toBeChecked();
});
