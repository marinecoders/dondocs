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

for (const theme of ['light', 'dark', 'classic']) test.describe(`action navigation in ${theme}`, () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(value => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'focused' } }));
    }, theme);
  });

  test('untouched action starters support Back, Escape and Close without saving packages', async ({ page }, info) => {
    await page.goto('/');
    let dialog = await openPackages(page);
    const savedCount = await dialog.getByLabel('Saved packages', { exact: true }).getByRole('option').count();
    for (const action of ['administrative request', 'training participation', 'evidence submission']) {
      const start = dialog.getByRole('button', { name: `Start ${action}`, exact: true });
      await start.click();
      const back = dialog.getByRole('button', { name: 'Back to actions', exact: true });
      await expect(back).toBeEnabled();
      if (action === 'administrative request') {
        await back.scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath('package-action-back.png') });
      }
      await back.click();
      await expect(dialog.getByRole('heading', { name: 'Start from an action', exact: true })).toBeFocused();
      await expect(start).toBeEnabled();
      await start.click();
      await expect(back).toBeEnabled();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      dialog = await openPackages(page);
      await dialog.getByRole('button', { name: `Start ${action}`, exact: true }).click();
      await expect(dialog.getByRole('button', { name: 'Back to actions', exact: true })).toBeEnabled();
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(dialog).toBeHidden();
      dialog = await openPackages(page);
      await expect(dialog.getByLabel('Saved packages', { exact: true }).getByRole('option')).toHaveCount(savedCount);
    }
  });

  test('edited action answers survive Escape and cancelled Back until discard is confirmed', async ({ page }) => {
    await page.goto('/');
    const dialog = await openPackages(page);
    await dialog.getByRole('button', { name: 'Start administrative request', exact: true }).click();
    const requester = dialog.getByRole('textbox', { name: 'Requester', exact: true });
    await requester.fill('Alex Example');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(requester).toHaveValue('Alex Example');
    const back = dialog.getByRole('button', { name: 'Back to actions', exact: true });
    await back.click();
    const confirmation = page.getByRole('alertdialog', { name: 'Discard intake changes?', exact: true });
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(requester).toHaveValue('Alex Example');
    await back.click();
    await confirmation.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Start from an action', exact: true })).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Start administrative request', exact: true })).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});

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
