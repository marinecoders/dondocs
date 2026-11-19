import { openPackagePreparation, importPackage, packageSection, expandPackageTools, packageVersion, selectedPackageRevision, versionCount, preparePackageExport, packageTool } from './_helpers/packageWorkspace';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const fixtureUrl = new URL('../fixtures/package-render/baseline-1.3.98.dondocs-package.json', import.meta.url);
test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(180_000);
async function openPackages(page: Page) {
  return openPackagePreparation(page);
}
async function saveInformation(dialog: Locator) {
  const panel = await packageTool(dialog, /^(Details|Package information)$/);
  await panel.getByRole('button', { name: /^(Review changes|Preview package changes)$/ }).click();
  const preview = panel.getByRole('region', { name: 'Package changes preview', exact: true });
  const impact = preview.getByRole('region', { name: 'Package impact details', exact: true });
  await expect(impact).toBeVisible();
  await expect(impact).toContainText('1 changed document input');
  // The proposed revision is private and has no saved destinations yet.
  await expect(impact.getByRole('button', { name: /^Inspect / })).toHaveCount(0);
  if (await preview.getByRole('checkbox', { name: /^I reviewed the package values, linked field changes/ }).isVisible()) await preview.getByRole('checkbox', { name: /^I reviewed the package values, linked field changes/ }).check();
  await preview.getByRole('button', { name: 'Apply package changes', exact: true }).click();
  await expect(panel.getByText('Package changes saved as a new revision.', { exact: true })).toBeVisible();
  return selectedPackageRevision(dialog);
}
async function compare(dialog: Locator) {
  const panel = await packageTool(dialog, 'Package change impact');
  if (!await panel.isVisible()) await expandPackageTools(dialog);
  await panel.getByRole('button', { name: 'Compare saved revisions', exact: true }).click();
  return panel.getByRole('region', { name: 'Package impact details', exact: true });
}

for (const theme of ['light', 'dark', 'classic']) test(`captured impact preserves removed values, older PDF bytes and exact reviews in ${theme}`, async ({ page, context }, info) => {
  await context.addInitScript(value => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'focused' } }));
  }, theme);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  let dialog = await openPackages(page);
  const fixtureBytes = await readFile(fixtureUrl), fixture = JSON.parse(fixtureBytes.toString('utf8'));
  const captured = fixture.package.revisions[0], output = captured.outputs[0];
  const retained = fixture.portableResources.entries.find((entry: { sha256: string }) => entry.sha256 === output.asset.sha256);
  expect(retained).toBeDefined();
  await importPackage(dialog, { name: 'synthetic-impact-package.json', mimeType: 'application/json', buffer: fixtureBytes });
  await packageSection(dialog, 'Overview', true);
  await expect(dialog).toHaveAttribute('data-package-id', fixture.package.id);
  await expect(dialog).toHaveAttribute('aria-busy', 'false');
  await packageSection(dialog, 'Review', true);
  await dialog.getByRole('button', { name: 'New review copy', exact: true }).click();
  await expect(dialog.getByText('Reviewing exact saved package revision', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Back to current package', exact: true }).click();

  let information = await packageTool(dialog, /^(Details|Package information)$/);
  await information.getByRole('button', { name: 'Add shared value', exact: true }).click();
  await information.getByLabel('Value label 1', { exact: true }).fill('Shared subject');
  await information.getByLabel('Value 1', { exact: true }).fill('SYNTHETIC FIRST IMPACT SUBJECT');
  await information.getByRole('button', { name: 'Load document fields', exact: true }).click();
  const targets = information.getByLabel('Link field for value 1', { exact: true });
  const subject = targets.getByRole('option').filter({ hasText: ' · Subject · ' });
  await expect(subject).toHaveCount(1);
  const subjectTarget = await subject.getAttribute('value');
  if (!subjectTarget) throw new Error('The captured native subject field is unavailable.');
  await targets.selectOption(subjectTarget);
  await information.getByRole('button', { name: 'Link value 1', exact: true }).click();
  await information.getByRole('button', { name: 'Add shared value', exact: true }).click();
  await information.getByLabel('Value label 2', { exact: true }).fill('Local routing note');
  await information.getByLabel('Value 2', { exact: true }).fill('Retain this exact earlier routing instruction.');
  const firstUpdate = await saveInformation(dialog);
  await information.getByLabel('Value 1', { exact: true }).fill('SYNTHETIC FINAL IMPACT SUBJECT');
  await information.getByRole('button', { name: 'Remove value 2', exact: true }).click();
  const finalUpdate = await saveInformation(dialog);
  expect(finalUpdate).not.toBe(firstUpdate);
  expect(await versionCount(dialog)).toBe(3);

  let impact = await compare(dialog);
  await expect(impact).toContainText('1 changed document input');
  await expandPackageTools(impact);
  await impact.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath(`package-impact-${theme}-desktop.png`) });
  await page.setViewportSize({ width: 320, height: 850 });
  await impact.scrollIntoViewIfNeeded();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const itemText = await impact.locator('li:visible').first().locator(':scope > p').nth(1).boundingBox();
  expect(itemText).not.toBeNull();
  expect(itemText!.width).toBeGreaterThanOrEqual(160);
  await page.screenshot({ path: info.outputPath(`package-impact-${theme}-mobile.png`) });
  await impact.getByRole('button', { name: 'Inspect shared value · Local routing note · location 1', exact: true }).click();
  await expect(dialog).toHaveAttribute('data-revision-id', firstUpdate);
  await expect(information.locator('legend').filter({ hasText: /^Local routing note$/ })).toBeFocused();
  await expect(information.getByLabel('Value 2', { exact: true })).toHaveValue('Retain this exact earlier routing instruction.');
  await expect(information.getByLabel('Value 2', { exact: true })).toBeDisabled();

  await packageVersion(dialog, finalUpdate);
  impact = await compare(dialog);
  await expandPackageTools(impact);
  await expect(impact.getByText(/This legacy PDF has no recorded input fingerprint/)).toBeVisible();
  await impact.getByRole('button', { name: 'Inspect retained PDF · Retained PDF 1 · location 1', exact: true }).click();
  await expect(dialog).toHaveAttribute('data-revision-id', captured.id);
  await expect(dialog.locator(`[data-package-output-id="${output.id}"]`)).toBeFocused();
  await preparePackageExport(dialog, 'saved');
  if (await dialog.getByRole('checkbox', { name: /^I reviewed every included member/ }).isVisible()) await dialog.getByRole('checkbox', { name: /^I reviewed every included member/ }).check();
  const pending = page.waitForEvent('download', { timeout: 90_000 });
  await dialog.getByRole('button', { name: 'Download reviewed retained PDF', exact: true }).click();
  const downloaded = await pending;
  expect(await downloaded.failure()).toBeNull();
  expect(await readFile((await downloaded.path())!)).toEqual(Buffer.from(retained.data, 'base64'));

  await packageVersion(dialog, finalUpdate);
  impact = await compare(dialog);
  await expandPackageTools(impact);
  await impact.getByRole('button', { name: 'Inspect review · Package review 1 · location 1', exact: true }).click();
  await expect(dialog.getByText('Reviewing exact saved package revision', { exact: true })).toBeVisible();
  await expect(dialog.locator('[data-package-review-id]').first()).toBeFocused();
  await expect(dialog).toHaveAttribute('data-revision-id', captured.id);
  await packageSection(dialog, 'Delivery');
  await expect(dialog.getByRole('button', { name: 'Prepare PDF', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Back to current package', exact: true }).click();
  await expect(dialog).toHaveAttribute('data-revision-id', finalUpdate);
  await packageSection(dialog, 'Overview', true);
  await expect(information.getByLabel('Value 1', { exact: true })).toHaveValue('SYNTHETIC FINAL IMPACT SUBJECT');
  await expect(information.getByLabel('Value 2', { exact: true })).toHaveCount(0);
  expect(await versionCount(dialog)).toBe(3);
  await page.reload();
  dialog = await openPackages(page); information = dialog.getByRole('region', { name: /^(Details|Package information)$/ });
  await expect(dialog).toHaveAttribute('data-revision-id', finalUpdate);
  await packageSection(dialog, 'Overview', true);
  await expect(information.getByLabel('Value 1', { exact: true })).toHaveValue('SYNTHETIC FINAL IMPACT SUBJECT');
});
