import { blockedPackagePdf, openPackagePreparation, packageSection, expandPackageTools, packageVersion, selectedPackageRevision, preparePackageExport, packageTool, openPackageWorkspace, choosePackage } from './_helpers/packageWorkspace';
import { expect, test, type Locator, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(180_000);
async function packages(page: Page) {
  return openPackagePreparation(page);
}
async function saveInformation(dialog: Locator) {
  const information = await packageTool(dialog, /^(Details|Package information)$/);
  await information.getByRole('button', { name: /^(Review changes|Preview package changes)$/ }).click();
  await expect(information.getByRole('button', { name: 'Apply package changes', exact: true })).toBeVisible(); if (await information.getByRole('checkbox', { name: /^I reviewed the package values, linked field changes/ }).isVisible()) await information.getByRole('checkbox', { name: /^I reviewed the package values, linked field changes/ }).check();
  await information.getByRole('button', { name: 'Apply package changes', exact: true }).click();
  await expect(information.getByText('Package changes saved as a new revision.', { exact: true })).toBeVisible();
}
async function saveRelationships(relationships: Locator) {
  await relationships.getByRole('button', { name: 'Review relationship changes', exact: true }).click();
  await relationships.getByRole('checkbox', { name: /^I reviewed the relationship declarations/ }).check();
  await relationships.getByRole('button', { name: 'Save relationship changes', exact: true }).click();
  await expect(relationships.getByText('Showing saved relationship declarations.', { exact: true })).toBeVisible();
}

for (const theme of ['light', 'dark', 'classic']) for (const width of [1440, 320]) test(`declared relationships gate package output and preserve scoped exceptions in ${theme} at ${width}px`, async ({ page, context }, info) => {
  await page.setViewportSize({ width, height: width === 320 ? 850 : 1000 });
  await context.addInitScript(value => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'focused' } }));
  }, theme);
  await page.goto('/');
  let dialog = await packages(page);
  await dialog.getByText('Start with a reviewed worksheet', { exact: true }).click();
  const starter = await packageTool(dialog, 'Administrative request starter');
  await starter.getByRole('button', { name: 'Start an administrative request', exact: true }).click();
  for (const [label, value] of Object.entries({ Requester: 'Alex Example', Organization: 'Fictional Training Unit', Recipient: 'Training Officer', 'Request subject': 'Coordination check', 'Request date': '2026-11-17', SSIC: '1500', 'Printed signature name': 'A. EXAMPLE', 'Requested action and justification': 'Request fictional training to exercise package checks.' })) {
    await starter.getByLabel(label, { exact: label !== 'Printed signature name' }).fill(value);
  }
  await starter.getByRole('button', { name: 'Review request starter', exact: true }).click();
  await starter.getByRole('checkbox', { name: /^I reviewed these request details/ }).check();
  await starter.getByRole('button', { name: 'Create reviewed request package', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Request: Coordination check', exact: true, level: 1 })).toBeVisible();
  const information = await packageTool(dialog, /^(Details|Package information)$/);
  await expect(information.getByLabel('Value label 1', { exact: true })).toBeVisible();
  const first = await information.getByLabel(/^Value label \d+$/).count() + 1;
  for (const [offset, label, value] of [[0, 'Start date', '2026-11-19'], [1, 'End date', '2026-11-17']] as const) {
    await information.getByRole('button', { name: 'Add shared value', exact: true }).click();
    await information.getByLabel(`Value label ${first + offset}`, { exact: true }).fill(label);
    await information.getByLabel(`Value kind ${first + offset}`, { exact: true }).selectOption('date');
    await information.getByLabel(`Value ${first + offset}`, { exact: true }).fill(value);
  }
  await saveInformation(dialog);
  await expandPackageTools(dialog);
  let relationships = await packageTool(dialog, 'Package relationships');
  await expandPackageTools(relationships);
  await relationships.getByLabel('New relationship label', { exact: true }).fill('Action dates');
  await relationships.getByRole('combobox', { name: /^Relationship type/ }).selectOption('date-on-or-before');
  await relationships.getByRole('combobox', { name: /^First package value/ }).selectOption({ label: 'Package · Start date' });
  await relationships.getByRole('combobox', { name: /^Second package value/ }).selectOption({ label: 'Package · End date' });
  await relationships.getByRole('button', { name: 'Add relationship to changes', exact: true }).click();
  await saveRelationships(relationships);
  const conflictedRevision = await selectedPackageRevision(dialog);
  await relationships.getByRole('button', { name: 'Check declared relationships', exact: true }).click();
  await expect(relationships.getByText(/conflict: The first date is later than the second date/)).toBeVisible();
  await relationships.getByRole('button', { name: /Inspect Package · End date for Action dates/ }).click();
  await expect(information.locator('legend').filter({ hasText: /^End date$/ })).toBeFocused();
  await expect(await blockedPackagePdf(dialog)).toContainText('Action dates');
  await packageSection(dialog, 'Review', true);
  await dialog.getByRole('button', { name: 'New review copy', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Action dates: The first date is later than the second date.');
  await expect(dialog.getByRole('button', { name: /^Open review / })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Overview', exact: true }).click();
  await relationships.getByLabel('Exception reason for Action dates', { exact: true }).fill('Fictional example: approved local date exception for this training scenario.');
  await relationships.getByRole('button', { name: 'Add exception to changes', exact: true }).click();
  await saveRelationships(relationships);
  await page.reload(); dialog = await openPackageWorkspace(page);
  await choosePackage(dialog, 'Request: Coordination check');
  await expandPackageTools(dialog);
  relationships = await packageTool(dialog, 'Package relationships');
  await relationships.getByRole('button', { name: 'Check declared relationships', exact: true }).click();
  await expect(relationships.getByText(/^excepted:/)).toBeVisible();
  const exceptionRevision = await selectedPackageRevision(dialog);
  expect(exceptionRevision).not.toBe(conflictedRevision);
  await preparePackageExport(dialog, 'pdf');
  await expect(dialog.getByRole('button', { name: 'Download PDF', exact: true })).toBeEnabled();
  if (await dialog.getByRole('checkbox', { name: /^I reviewed every included member, privacy findings/ }).isVisible()) await dialog.getByRole('checkbox', { name: /^I reviewed every included member, privacy findings/ }).check();
  await expect(dialog.getByRole('button', { name: 'Download PDF', exact: true })).toBeEnabled();
  await packageSection(dialog, 'Review', true);
  await dialog.getByRole('button', { name: 'New review copy', exact: true }).click();
  await expect(dialog.getByText('Reviewing exact saved package revision', { exact: true })).toBeVisible();
  await packageSection(dialog, 'Overview', true);
  await expect(relationships.getByRole('textbox', { name: 'Relationship label 1' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Back to current package', exact: true }).click();
  await dialog.getByRole('button', { name: 'Overview', exact: true }).click();
  await packageVersion(dialog, conflictedRevision);
  await relationships.getByRole('button', { name: 'Check declared relationships', exact: true }).click();
  await expect(relationships.getByText(/^conflict:/)).toBeVisible();
  await packageSection(dialog, 'Overview', true);
  await expect(relationships.getByRole('textbox', { name: 'Relationship label 1' })).toBeDisabled();
  await packageVersion(dialog, exceptionRevision);
  await dialog.getByRole('region', { name: /^(Details|Package information)$/ }).getByLabel(`Value ${first}`, { exact: true }).fill('2026-11-20');
  await saveInformation(dialog);
  await relationships.getByRole('button', { name: 'Check declared relationships', exact: true }).click();
  await expect(relationships.getByText('The saved exception does not apply to these current values.', { exact: true })).toBeVisible();
  await expect(await blockedPackagePdf(dialog)).toContainText('Action dates');
  await dialog.getByRole('button', { name: 'Overview', exact: true }).click();
  await relationships.getByRole('textbox', { name: 'Relationship label 1' }).fill('Unsaved label');
  await expect(dialog.getByRole('button', { name: 'Continue editing', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(relationships.getByRole('textbox', { name: 'Relationship label 1' })).toHaveValue('Unsaved label');
  await relationships.getByRole('button', { name: 'Discard relationship changes', exact: true }).click();
  await expect(relationships.getByRole('textbox', { name: 'Relationship label 1' })).toHaveValue('Action dates');
  await relationships.getByRole('button', { name: 'Check declared relationships', exact: true }).click();
  await relationships.getByText('The saved exception does not apply to these current values.', { exact: true }).scrollIntoViewIfNeeded();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath(`package-relationships-${theme}-${width}px.png`) });
});
