import { openPackagePreparation, importPackage, packageSection, expandPackageTools, packageVersion, selectedPackageRevision, packageTool } from './_helpers/packageWorkspace';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(120_000);
async function packages(page: Page) {
  return openPackagePreparation(page);
}
async function saveTasks(work: Locator) {
  await work.getByRole('button', { name: 'Review task changes', exact: true }).click();
  await work.getByRole('checkbox', { name: /^I reviewed the tasks, responsible people, dates/ }).check();
  await work.getByRole('button', { name: 'Save task changes', exact: true }).click();
  await expect(work.getByText('Showing saved tasks.', { exact: true })).toBeVisible();
}
for (const theme of ['light', 'dark', 'classic']) for (const width of [1440, 320]) test(`saved work and real next actions remain separate in ${theme} at ${width}px`, async ({ page, context }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await context.addInitScript(value => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'focused' } }));
  }, theme);
  await page.goto('/');
  let dialog = await packages(page);
  const bytes = await readFile(new URL('../fixtures/package-render/baseline-1.3.98.dondocs-package.json', import.meta.url));
  await importPackage(dialog, { name: 'synthetic-work-package.json', mimeType: 'application/json', buffer: bytes });
  await packageSection(dialog, 'Overview', true);
  await expect(dialog.getByRole('button', { name: 'Add shared value', exact: true })).toBeEnabled();
  const baseline = await selectedPackageRevision(dialog);
  await expandPackageTools(dialog);
  let work = await packageTool(dialog, 'Work and next actions');
  await work.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(work.getByLabel('Task 1 title', { exact: true })).toBeFocused();
  await work.getByLabel('Task 1 title', { exact: true }).fill('Coordinate fictional training');
  await work.getByLabel('Responsible person for task 1', { exact: true }).fill('Alex Example');
  await work.getByLabel('Due date for task 1', { exact: true }).fill('2026-02-30');
  await expect(work.getByText('Use a real date in YYYY-MM-DD format.', { exact: true })).toBeVisible();
  await work.getByRole('button', { name: 'Review task changes', exact: true }).click();
  await expect(work.getByRole('alert')).toContainText('due date');
  await work.getByLabel('Due date for task 1', { exact: true }).fill('2020-01-01');
  await work.getByLabel('Notes for task 1', { exact: true }).fill('Synthetic coordination note preserved with this package revision.');
  await expect(dialog.getByRole('button', { name: 'Continue editing', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Continue editing', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Add shared value', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  await expect(work.getByLabel('Task 1 title', { exact: true })).toHaveValue('Coordinate fictional training');
  await saveTasks(work);
  const pending = await selectedPackageRevision(dialog); expect(pending).not.toBe(baseline);
  await work.getByRole('button', { name: 'Check next actions', exact: true }).click();
  const taskAction = work.getByRole('button', { name: 'Open Coordinate fictional training', exact: true });
  await expect(taskAction).toBeVisible(); await taskAction.click();
  await expect(work.getByLabel('Task 1 title', { exact: true })).toBeFocused();
  await expect(work.getByText('Overdue', { exact: true })).toBeVisible();
  await work.getByLabel('Mark task 1 complete', { exact: true }).check(); await saveTasks(work);
  const complete = await selectedPackageRevision(dialog); expect(complete).not.toBe(pending);
  await page.reload(); dialog = await packages(page);
  await expandPackageTools(dialog);
  work = dialog.getByRole('region', { name: 'Work and next actions', exact: true });
  await expect(work.getByLabel('Mark task 1 complete', { exact: true })).toBeChecked();
  await expect(work.getByLabel('Responsible person for task 1', { exact: true })).toHaveValue('Alex Example');
  await packageVersion(dialog, pending);
  await expect(work.getByLabel('Mark task 1 complete', { exact: true })).not.toBeChecked();
  await expect(work.getByLabel('Task 1 title', { exact: true })).toBeDisabled();
  await packageVersion(dialog, complete);
  await work.getByRole('button', { name: 'Check next actions', exact: true }).click();
  await expect(work.getByRole('button', { name: 'Open Prepare PDF assembly', exact: true })).toBeVisible();
  await expect(work.getByRole('button', { name: 'Open Coordinate fictional training', exact: true })).toHaveCount(0);
  await work.getByRole('button', { name: 'Add task', exact: true }).click();
  await work.getByLabel('Task 2 title', { exact: true }).fill('Discard this temporary change');
  await work.getByRole('button', { name: 'Discard task changes', exact: true }).click();
  await expect(work.getByLabel('Task 2 title', { exact: true })).toHaveCount(0);
  if (width === 320) {
    const operationBounds = await work.getByLabel('Next action operation', { exact: true }).boundingBox();
    expect(operationBounds).not.toBeNull(); expect(operationBounds!.width).toBeGreaterThanOrEqual(160);
  }
  await work.scrollIntoViewIfNeeded();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath(`package-work-${theme}-${width}px.png`) });
});
