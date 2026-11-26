import { openPackageWorkspace, importPackage, packageTool, selectedPackageId, choosePackageById } from './_helpers/packageWorkspace';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(90_000);
for (const theme of ['light', 'dark', 'classic']) test(`edits, links, reviews and restores package information in ${theme}`, async ({ page, context }, info) => {
  await context.addInitScript(value => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'focused' } }));
  }, theme);
  await page.goto('/');
  let dialog = await openPackageWorkspace(page);
  const bytes = await readFile(new URL('../fixtures/package-render/baseline-1.3.98.dondocs-package.json', import.meta.url));
  await importPackage(dialog, { name: 'synthetic-package.json', mimeType: 'application/json', buffer: bytes });
  const id = await selectedPackageId(dialog);
  let panel = await packageTool(dialog, 'Details');
  if (await panel.getByRole('button', { name: 'Field links and other details', exact: true }).getAttribute('aria-expanded') === 'false') await panel.getByRole('button', { name: 'Field links and other details', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Add shared value', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: 'Add shared value', exact: true }).click();
  await panel.getByLabel('Value label 1', { exact: true }).fill('Shared subject');
  await panel.getByLabel('Value 1', { exact: true }).fill('SYNTHETIC SHARED PACKAGE SUBJECT');
  await expect(panel.getByText('Draft saved locally · not applied', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  dialog = await openPackageWorkspace(page);
  await choosePackageById(dialog, id);
  panel = dialog.getByRole('region', { name: 'Details', exact: true });
  await expect(panel.getByText('Recovered unapplied edits.', { exact: true })).toBeVisible();
  if (await panel.getByRole('button', { name: 'Field links and other details', exact: true }).getAttribute('aria-expanded') === 'false') await panel.getByRole('button', { name: 'Field links and other details', exact: true }).click();
  await expect(panel.getByLabel('Value 1', { exact: true })).toHaveValue('SYNTHETIC SHARED PACKAGE SUBJECT');
  await panel.getByRole('button', { name: 'Load document fields', exact: true }).click();
  const targets = panel.getByLabel('Link field for value 1', { exact: true });
  await expect(targets).toBeVisible();
  const subject = targets.getByRole('option').filter({ hasText: ' · Subject · ' });
  await targets.selectOption(await subject.getAttribute('value') ?? '');
  await panel.getByRole('button', { name: 'Link value 1', exact: true }).click();
  await panel.getByRole('button', { name: /^(Review changes|Preview package changes)$/ }).click();
  const changes = panel.getByRole('region', { name: 'Package changes preview', exact: true });
  await expect(changes).toContainText('Package value: SYNTHETIC SHARED PACKAGE SUBJECT');
  await expect(changes.getByRole('button', { name: 'Apply package changes', exact: true })).toBeEnabled();
  await changes.getByRole('button', { name: 'Apply package changes', exact: true }).click();
  await expect(panel.getByText('Package changes saved as a new revision.', { exact: true })).toBeVisible();
  await expect(panel.getByLabel('Value kind 1', { exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'Undo package changes', exact: true }).click();
  await expect(panel.getByText('Package changes undone in a new revision.', { exact: true })).toBeVisible();
  await expect(panel.getByLabel('Value 1', { exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Add shared value', exact: true }).click();
  await panel.getByLabel('Value label 1', { exact: true }).fill('Control number');
  await panel.getByLabel('Value kind 1', { exact: true }).selectOption('identifier');
  await panel.getByLabel('Value 1', { exact: true }).fill('000042');
  await panel.getByRole('button', { name: /^(Review changes|Preview package changes)$/ }).click();
  await panel.getByRole('button', { name: 'Apply package changes', exact: true }).click();
  await expect(panel.getByText('Package changes saved as a new revision.', { exact: true })).toBeVisible();
  await page.reload();
  dialog = await openPackageWorkspace(page);
  await choosePackageById(dialog, id);
  panel = dialog.getByRole('region', { name: 'Details', exact: true });
  if (await panel.getByRole('button', { name: 'Field links and other details', exact: true }).getAttribute('aria-expanded') === 'false') await panel.getByRole('button', { name: 'Field links and other details', exact: true }).click();
  await expect(panel.getByLabel('Value 1', { exact: true })).toHaveValue('000042');
  await dialog.getByRole('navigation', { name: 'Package workspace', exact: true }).getByRole('button', { name: 'Documents', exact: true }).click();
  await dialog.getByRole('navigation', { name: 'Package workspace', exact: true }).getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Back to packages', exact: true })).toBeInViewport();
  await panel.getByRole('heading', { name: 'Details', exact: true }).scrollIntoViewIfNeeded();
  const bounds = await panel.boundingBox();
  expect(bounds).not.toBeNull(); expect(bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await dialog.evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: info.outputPath(`package-information-${theme}.png`) });
});

test('review a local exception and a shared change from the document being edited', async ({ page, context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { editorLayout: 'focused' } }));
  });
  await page.goto('/');
  const dialog = await openPackageWorkspace(page);
  const bytes = await readFile(new URL('../fixtures/package-render/baseline-1.3.98.dondocs-package.json', import.meta.url));
  await importPackage(dialog, { name: 'sample.json', mimeType: 'application/json', buffer: bytes });
  const panel = await packageTool(dialog, 'Details');
  const advanced = panel.getByRole('button', { name: 'Field links and other details' });
  if (await advanced.getAttribute('aria-expanded') === 'false') await advanced.click();
  await panel.getByRole('button', { name: 'Add shared value' }).click();
  await panel.getByLabel('Value label 1', { exact: true }).fill('Shared subject');
  await panel.getByLabel('Value 1', { exact: true }).fill('ORIGINAL SUBJECT');
  await panel.getByRole('button', { name: 'Load document fields' }).click();
  const target = panel.getByLabel('Link field for value 1');
  await target.selectOption(await target.getByRole('option').filter({ hasText: ' · Subject · ' }).getAttribute('value') ?? '');
  await panel.getByRole('button', { name: 'Link value 1' }).click();
  async function apply() {
    await panel.getByRole('button', { name: 'Review changes', exact: true }).click();
    const preview = panel.getByRole('region', { name: 'Package changes preview' });
    await expect(preview).toContainText('Subject');
    await preview.getByRole('button', { name: 'Apply package changes' }).click();
    await expect(panel.getByText('Package changes saved as a new revision.')).toBeVisible();
  }
  await apply();
  for (const [action, value] of [['Keep for this document', 'DOCUMENT EXCEPTION'], ['Update package details', 'NEW SHARED SUBJECT']]) {
    await dialog.getByRole('navigation', { name: 'Package workspace' }).getByRole('button', { name: 'Documents' }).click();
    await dialog.getByRole('button', { name: 'Edit document', exact: true }).click();
    const editor = page.getByRole('dialog').filter({ has: page.getByRole('combobox', { name: 'Package document', exact: true }) });
    await editor.getByLabel('Document section', { exact: true }).selectOption('addressing');
    const subject = editor.getByRole('textbox', { name: 'Subject', exact: true });
    await subject.fill(value); await subject.blur();
    await expect(editor.getByRole('button', { name: action })).toBeEnabled();
    await editor.getByRole('button', { name: action }).click();
    if (action === 'Keep for this document') {
      await expect(editor.getByText(/Document override/)).toBeVisible();
      await expect(subject).toHaveValue(value);
      await editor.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(editor.getByRole('button', { name: action })).toBeVisible();
      await editor.getByRole('button', { name: action }).click();
      await expect(editor.getByText(/Document override/)).toBeVisible();
      await editor.getByRole('button', { name: 'Back to package' }).click();
    } else {
      await expect(panel.getByText('Review the shared value and the documents it will update.')).toBeVisible();
      await apply();
      await expect(panel.getByText(value, { exact: true }).first()).toBeVisible();
    }
  }
});
