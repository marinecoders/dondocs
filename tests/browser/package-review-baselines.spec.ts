import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const fixturePath = fileURLToPath(new URL('../fixtures/package-render/baseline-1.3.98.dondocs-package.json', import.meta.url));
test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(120_000);
async function packages(page: Page) {
  const drawer = page.getByRole('dialog', { name: 'Documents', exact: true });
  if (!(await drawer.isVisible())) await page.getByRole('button', { name: 'Open workspace', exact: true })
    .or(page.getByRole('button', { name: /^Packages(?:\s|$)/ })).first().click();
  if (await drawer.isVisible()) await drawer.getByRole('button', { name: /^Packages(?:\s|$)/ }).click();
  return page.getByRole('dialog', { name: 'Action packages', exact: true });
}
for (const theme of ['light', 'dark', 'classic']) test(`exact package review survives membership changes and reload in ${theme}`, async ({ page, context }, info) => {
  await context.addInitScript(value => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'focused' } }));
  }, theme);
  await page.goto('/');
  let modal = await packages(page);
  const bytes = await readFile(fixturePath), packet = JSON.parse(bytes.toString('utf8'));
  const revision = packet.package.revisions[0];
  await modal.getByLabel('Import editable package', { exact: true }).setInputFiles({ name: 'synthetic-review.dondocs-package.json', mimeType: 'application/json', buffer: bytes });
  await expect(modal.getByRole('button', { name: 'Start package review', exact: true })).toBeVisible();
  await expect(modal).not.toHaveAttribute('aria-busy', 'true');
  await modal.getByRole('button', { name: 'Start package review', exact: true }).click();
  await expect(modal.getByText('Reviewing exact saved package revision', { exact: true })).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Check readiness and assemble', exact: true })).toBeDisabled();
  await expect(modal.getByLabel('Saved package reviews')).toContainText(`${revision.members.length} captured members`);
  await modal.getByRole('button', { name: 'Return to package workspace', exact: true }).click();
  const removedLabel = revision.members.at(-1).label;
  await modal.getByRole('listitem').filter({ has: page.getByRole('heading', { name: `${revision.members.length}. ${removedLabel}`, exact: true }) })
    .getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(modal.getByRole('heading', { name: `${revision.members.length}. ${removedLabel}`, exact: true })).toBeHidden();
  await modal.getByRole('button', { name: 'Open review Package review 1', exact: true }).click();
  await expect(modal.getByRole('heading', { name: `${revision.members.length}. ${removedLabel}`, exact: true })).toBeVisible();
  await expect(modal.getByLabel('Package revision', { exact: true })).toHaveValue(revision.id);
  await page.reload();
  modal = await packages(page);
  await modal.getByLabel('Saved packages', { exact: true }).selectOption(packet.package.id);
  await modal.getByRole('button', { name: 'Open review Package review 1', exact: true }).click();
  await expect(modal.getByText('Reviewing exact saved package revision', { exact: true })).toBeVisible();
  await expect(modal.getByRole('heading', { name: `${revision.members.length}. ${removedLabel}`, exact: true })).toBeVisible();
  await modal.getByRole('button', { name: 'Close package review', exact: true }).click();
  await expect(modal.getByRole('button', { name: 'Reopen package review', exact: true })).toBeVisible();
  await info.attach('exact-package-review', { body: await modal.getByLabel('Saved package reviews').innerText(), contentType: 'text/plain' });
});
