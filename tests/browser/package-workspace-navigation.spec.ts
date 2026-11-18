import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ serviceWorkers: 'block' });
test.setTimeout(90_000);

async function openPackages(page: Page) {
  const drawer = page.getByRole('dialog', { name: 'Documents', exact: true });
  if (!await drawer.isVisible()) await page.getByRole('button', { name: 'Open workspace', exact: true })
    .or(page.getByRole('button', { name: /^Packages(?:\s|$)/ })).first().click();
  if (await drawer.isVisible()) await drawer.getByRole('button', { name: /^Packages(?:\s|$)/ }).click();
  return page.getByRole('dialog', { name: 'Action packages', exact: true });
}

for (const theme of ['light', 'dark', 'classic']) test(`package workspace resumes the exact selected revision and original member in ${theme}`, async ({ page, context }, info) => {
  await context.addInitScript(value => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'focused' } }));
  }, theme);
  await page.goto('/');
  let dialog = await openPackages(page);
  const bytes = await readFile(new URL('../fixtures/package-render/baseline-1.3.98.dondocs-package.json', import.meta.url));
  const fixture = JSON.parse(bytes.toString());
  const savedRevision = fixture.package.currentRevisionId;
  const original = fixture.package.revisions[0].members[1];
  await dialog.getByLabel('Import editable package', { exact: true }).setInputFiles({ name: 'synthetic-package.json', mimeType: 'application/json', buffer: bytes });
  const originalHeading = dialog.getByRole('heading', { name: `2. ${original.label}`, exact: true });
  await expect(originalHeading).toBeVisible();
  await originalHeading.locator('..').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(originalHeading).toHaveCount(0);
  await dialog.getByLabel('Package revision', { exact: true }).selectOption(savedRevision);
  await expect(originalHeading).toBeVisible();
  await dialog.getByRole('navigation', { name: 'Package workspace', exact: true }).getByRole('button', { name: 'Documents', exact: true }).click();
  const picker = dialog.getByLabel('Document to inspect', { exact: true });
  if (await picker.isVisible()) await picker.selectOption(original.id);
  else await dialog.getByRole('navigation', { name: 'Package documents', exact: true }).getByRole('button', { name: /^2\./ }).click();
  await expect(originalHeading.locator('..')).toHaveAttribute('data-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  dialog = await openPackages(page);
  await expect(dialog.getByLabel('Package revision', { exact: true })).toHaveValue(savedRevision);
  await expect(dialog.getByRole('heading', { name: `2. ${original.label}`, exact: true }).locator('..')).toHaveAttribute('data-selected', 'true');
  await page.reload();
  dialog = await openPackages(page);
  await expect(dialog.getByLabel('Saved packages', { exact: true })).toHaveValue(fixture.package.id);
  await expect(dialog.getByLabel('Package revision', { exact: true })).toHaveValue(savedRevision);
  await expect(dialog.getByText('Historical saved revision', { exact: false })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: `2. ${original.label}`, exact: true }).locator('..')).toHaveAttribute('data-selected', 'true');
  await expect(dialog.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Download unchanged original', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`package-workspace-${theme}.png`), fullPage: true });
  await dialog.evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: info.outputPath(`package-workspace-overview-${theme}.png`) });
});
