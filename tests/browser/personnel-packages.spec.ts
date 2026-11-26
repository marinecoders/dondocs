import { expect, test, type Page } from '@playwright/test';
import { expandPackageTools, newPackage, openPackageWorkspace } from './_helpers/packageWorkspace';

async function startPackage(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start writing', exact: true }).click();
  const workspace = await openPackageWorkspace(page);
  await newPackage(workspace);
  await expandPackageTools(workspace);
  await workspace.getByRole('button', { name: 'Start ' + name, exact: true }).click();
  return workspace;
}

test('starts a dependency application with the official blank and a slot for the signed return', async ({ page }) => {
  const workspace = await startPackage(page, 'dependency application');
  const download = page.waitForEvent('download');
  await workspace.getByRole('list', { name: 'Document requirements' }).getByRole('listitem').filter({ hasText: 'NAVMC 10922' }).getByRole('button', { name: 'Download blank', exact: true }).click();
  const blank = await download;
  expect(blank.suggestedFilename()).toBe('NAVMC 10922 - Dependency Application.pdf');
  const slot = workspace.getByRole('listitem').filter({ hasText: 'Completed and signed NAVMC 10922' });
  const input = slot.getByLabel('Attach completed original for Completed and signed NAVMC 10922');
  const { readFile } = await import('node:fs/promises');
  await input.setInputFiles({ name: 'official-blank.pdf', mimeType: 'application/pdf', buffer: await readFile((await blank.path())!) });
  await expect(workspace.getByRole('alert').filter({ hasText: 'This is the blank form' })).toBeVisible();
  await workspace.getByRole('button', { name: 'What changed?', exact: true }).click();
  await expect(workspace.getByRole('region', { name: 'Action intake' }).getByLabel('What changed?', { exact: true })).toBeVisible();
});

test('saves counseling topics inside the package and restores them after reload', async ({ page }) => {
  const workspace = await startPackage(page, 'developmental counseling');
  await workspace.getByRole('button', { name: 'Edit form', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Developmental counseling', exact: true });
  const topics = editor.getByLabel(/Subjects discussed and progress/);
  await topics.fill('Practice the shift handoff.');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor.getByText('Saved to package', { exact: true })).toBeVisible();
  await page.reload();
  await expect(topics).toHaveValue('Practice the shift handoff.');
});

test('opens the official COLA form in the package editor', async ({ page }) => {
  const workspace = await startPackage(page, 'Okinawa overseas COLA');
  await workspace.getByRole('button', { name: 'Edit form', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Okinawa overseas COLA', exact: true });
  const member = editor.getByLabel('Member name (last, first, middle initial)', { exact: false });
  await member.fill('EXAMPLE, MARINE');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor.getByText('Saved to package', { exact: true })).toBeVisible();
  const preview = editor.getByRole('button', { name: 'Show preview' });
  if (await preview.isVisible()) await preview.click();
  await expect(editor.locator('[data-pdf-layer="active"] canvas').first()).toBeVisible();
});

test('opens the saved Okinawa filing guide inside a TLA claim', async ({ page }) => {
  const workspace = await startPackage(page, 'Okinawa TLA claim');
  await workspace.getByRole('button', { name: /Okinawa TLA - Arrival and departure filing guides/ }).click();
  const reader = page.getByRole('dialog', { name: /Okinawa TLA - Arrival and departure filing guides/ });
  await expect(reader.locator('canvas').first()).toBeVisible();
  await expect(reader.getByRole('button', { name: 'Download original' })).toBeVisible();
});
