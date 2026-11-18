import { expect, test, type Locator, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(180_000);
async function packages(page: Page) {
  const drawer = page.getByRole('dialog', { name: 'Documents', exact: true });
  if (!await drawer.isVisible()) await page.getByRole('button', { name: 'Open workspace', exact: true })
    .or(page.getByRole('button', { name: /^Packages(?:\s|$)/ })).first().click();
  if (await drawer.isVisible()) await drawer.getByRole('button', { name: /^Packages(?:\s|$)/ }).click();
  return page.getByRole('dialog', { name: 'Action packages', exact: true });
}
async function saveInformation(dialog: Locator) {
  const information = dialog.getByRole('region', { name: 'Package information', exact: true });
  await information.getByRole('button', { name: 'Preview package changes', exact: true }).click();
  await information.getByRole('checkbox', { name: /^I reviewed the package values, linked field changes/ }).check();
  await information.getByRole('button', { name: 'Apply package changes', exact: true }).click();
  await expect(information.getByText('Showing saved package information.', { exact: true })).toBeVisible();
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
  await dialog.locator('summary').filter({ hasText: /^Quick request starter/ }).click();
  const starter = dialog.getByRole('region', { name: 'Administrative request starter', exact: true });
  await starter.getByRole('button', { name: 'Start an administrative request', exact: true }).click();
  for (const [label, value] of Object.entries({ Requester: 'Alex Example', Organization: 'Fictional Training Unit', Recipient: 'Training Officer', 'Request subject': 'Coordination check', 'Request date': '2026-11-17', SSIC: '1500', 'Printed signature name': 'A. EXAMPLE', 'Requested action and justification': 'Request fictional training to exercise package checks.' })) {
    await starter.getByLabel(label, { exact: label !== 'Printed signature name' }).fill(value);
  }
  await starter.getByRole('button', { name: 'Review request starter', exact: true }).click();
  await starter.getByRole('checkbox', { name: /^I reviewed these request details/ }).check();
  await starter.getByRole('button', { name: 'Create reviewed request package', exact: true }).click();
  await expect(dialog.getByLabel('Package name', { exact: true })).toHaveValue('Request: Coordination check');
  const information = dialog.getByRole('region', { name: 'Package information', exact: true });
  await expect(information.getByLabel('Value label 1', { exact: true })).toBeVisible();
  const first = await information.getByLabel(/^Value label \d+$/).count() + 1;
  for (const [offset, label, value] of [[0, 'Start date', '2026-11-19'], [1, 'End date', '2026-11-17']] as const) {
    await information.getByRole('button', { name: 'Add shared value', exact: true }).click();
    await information.getByLabel(`Value label ${first + offset}`, { exact: true }).fill(label);
    await information.getByLabel(`Value kind ${first + offset}`, { exact: true }).selectOption('date');
    await information.getByLabel(`Value ${first + offset}`, { exact: true }).fill(value);
  }
  await saveInformation(dialog);
  await dialog.locator('summary').filter({ hasText: /^Consistency checks/ }).click();
  let relationships = dialog.getByRole('region', { name: 'Package relationships', exact: true });
  await relationships.locator('summary').filter({ hasText: 'Add a relationship' }).click();
  await relationships.getByLabel('New relationship label', { exact: true }).fill('Action dates');
  await relationships.getByRole('combobox', { name: /^Relationship type/ }).selectOption('date-on-or-before');
  await relationships.getByRole('combobox', { name: /^First package value/ }).selectOption({ label: 'Package · Start date' });
  await relationships.getByRole('combobox', { name: /^Second package value/ }).selectOption({ label: 'Package · End date' });
  await relationships.getByRole('button', { name: 'Add relationship to changes', exact: true }).click();
  await saveRelationships(relationships);
  const conflictedRevision = await dialog.getByLabel('Package revision', { exact: true }).inputValue();
  await relationships.getByRole('button', { name: 'Check declared relationships', exact: true }).click();
  await expect(relationships.getByText(/conflict: The first date is later than the second date/)).toBeVisible();
  await relationships.getByRole('button', { name: /Inspect Package · End date for Action dates/ }).click();
  await expect(information.locator('legend').filter({ hasText: /^End date$/ })).toBeFocused();
  await dialog.getByRole('button', { name: 'Check readiness and assemble', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Package readiness: incomplete', exact: true })).toBeVisible();
  await expect(dialog.getByText('Required: Action dates: The first date is later than the second date.', { exact: true })).toBeVisible();
  await dialog.getByRole('checkbox', { name: /^I reviewed every included member, privacy findings/ }).check();
  await expect(dialog.getByRole('button', { name: 'Assemble and retain PDF', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Start package review', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Action dates: The first date is later than the second date.');
  await expect(dialog.getByRole('button', { name: /^Open review / })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Overview', exact: true }).click();
  await relationships.getByLabel('Exception reason for Action dates', { exact: true }).fill('Fictional example: approved local date exception for this training scenario.');
  await relationships.getByRole('button', { name: 'Add exception to changes', exact: true }).click();
  await saveRelationships(relationships);
  await page.reload(); dialog = await packages(page);
  await dialog.locator('summary').filter({ hasText: /^Consistency checks/ }).click();
  relationships = dialog.getByRole('region', { name: 'Package relationships', exact: true });
  await relationships.getByRole('button', { name: 'Check declared relationships', exact: true }).click();
  await expect(relationships.getByText(/^excepted:/)).toBeVisible();
  const exceptionRevision = await dialog.getByLabel('Package revision', { exact: true }).inputValue();
  expect(exceptionRevision).not.toBe(conflictedRevision);
  await dialog.getByRole('button', { name: 'Check readiness and assemble', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Package readiness: ready', exact: true })).toBeVisible();
  await dialog.getByRole('checkbox', { name: /^I reviewed every included member, privacy findings/ }).check();
  await expect(dialog.getByRole('button', { name: 'Assemble and retain PDF', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Start package review', exact: true }).click();
  await expect(dialog.getByText('Reviewing exact saved package revision', { exact: true })).toBeVisible();
  await expect(relationships.getByRole('textbox', { name: 'Relationship label 1' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Return to package workspace', exact: true }).click();
  await dialog.getByRole('button', { name: 'Overview', exact: true }).click();
  await dialog.getByLabel('Package revision', { exact: true }).selectOption(conflictedRevision);
  await relationships.getByRole('button', { name: 'Check declared relationships', exact: true }).click();
  await expect(relationships.getByText(/^conflict:/)).toBeVisible();
  await expect(relationships.getByRole('textbox', { name: 'Relationship label 1' })).toBeDisabled();
  await dialog.getByLabel('Package revision', { exact: true }).selectOption(exceptionRevision);
  await dialog.getByRole('region', { name: 'Package information', exact: true }).getByLabel(`Value ${first}`, { exact: true }).fill('2026-11-20');
  await saveInformation(dialog);
  await relationships.getByRole('button', { name: 'Check declared relationships', exact: true }).click();
  await expect(relationships.getByText('The saved exception does not apply to these current values.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Check readiness and assemble', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Package readiness: incomplete', exact: true })).toBeVisible();
  await dialog.getByRole('checkbox', { name: /^I reviewed every included member, privacy findings/ }).check();
  await expect(dialog.getByRole('button', { name: 'Assemble and retain PDF', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Overview', exact: true }).click();
  await relationships.getByRole('textbox', { name: 'Relationship label 1' }).fill('Unsaved label');
  await expect(dialog.getByLabel('Saved packages', { exact: true })).toBeDisabled();
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
