import { expect, test } from '@playwright/test';
import { expandPackageTools, newPackage, openPackageWorkspace, packageHeading } from './_helpers/packageWorkspace';

test.use({ serviceWorkers: 'block' });

test('fills the official DD Form 368 inside a new conditional release package and restores it after reload', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start writing', exact: true }).click();
  const workspace = await openPackageWorkspace(page);
  await newPackage(workspace);
  await expandPackageTools(workspace);
  await workspace.getByRole('button', { name: 'Start conditional release' }).click();
  await expect(workspace.getByRole('heading', { name: '1. Transfer request letter' })).toBeVisible();
  await expect(await packageHeading(workspace, '2. Command endorsement')).toBeVisible();
  await expect(await packageHeading(workspace, '3. DD Form 368 – Request for Conditional Release')).toBeVisible();
  await workspace.getByRole('button', { name: 'Edit form', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Conditional release', exact: true });
  const name = editor.getByLabel('Member name (last, first, middle initial)', { exact: false });
  await name.fill('RIVERA, EXAMPLE');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor.getByText('Saved to package', { exact: true })).toBeVisible();
  const show = editor.getByRole('button', { name: 'Show preview' });
  if (await show.isVisible()) await show.click();
  await expect(editor.locator('[data-pdf-layer="active"] canvas').first()).toBeVisible({ timeout: 30_000 });
  const fields = editor.getByRole('button', { name: 'Show fields' });
  if (await fields.isVisible()) await fields.click();
  await page.reload();
  await expect(editor).toBeVisible();
  if (await fields.isVisible()) await fields.click();
  await expect(name).toHaveValue('RIVERA, EXAMPLE');
});

test('opens DD Form 368 standalone from the form picker', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Forms', exact: true }).click();
  await page.getByRole('button', { name: 'Form type' }).click();
  await page.getByLabel('Search forms').fill('368');
  await page.getByRole('option', { name: /Request for Conditional Release/ }).click();
  await page.getByLabel('Member name (last, first, middle initial)', { exact: false }).fill('EXAMPLE, STANDALONE');
  await page.reload();
  await expect(page.getByLabel('Member name (last, first, middle initial)', { exact: false })).toHaveValue('EXAMPLE, STANDALONE');
});
