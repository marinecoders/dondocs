import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { downloadPackageExport, expandPackageTools, importPackage, newPackage, openPackageWorkspace, packageSection } from './_helpers/packageWorkspace';

test.use({ serviceWorkers: 'block' });
test('starts an NJP action and edits both catalog forms inside the saved package', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
  await page.goto('/');
  const workspace = await openPackageWorkspace(page);
  await newPackage(workspace);
  await expandPackageTools(workspace);
  const intake = workspace.getByRole('region', { name: 'Action intake' });
  await intake.getByRole('button', { name: 'Start NJP' }).click();
  const blanks = workspace.getByRole('region', { name: 'Blank forms and guides' });
  await expect(blanks.getByRole('button')).toHaveCount(7, { timeout: 20_000 });
  await expect(workspace.getByRole('heading', { name: '1. Unit Punishment Book' })).toBeVisible();
  await page.route('**/templates/**', route => route.abort());
  await page.reload();
  await openPackageWorkspace(page);
  await packageSection(workspace, 'Documents');
  const files = [
    ['JAGMAN A-1-d - Rights notice and election.pdf', 'jagman/a-1-d/5800.7G-CH2/original.pdf'],
    ['JAGMAN A-1-f - Proceedings guide.pdf', 'jagman/a-1-f/5800.7G-CH2/original.pdf'],
    ['JAGMAN A-1-g - Appeal rights.pdf', 'jagman/a-1-g/5800.7G-CH2/original.pdf'],
    ['JAGMAN A-1-e - Education assistance reimbursement notice.pdf', 'jagman/a-1-e/5800.7G-CH2/original.pdf'],
    ['JAGMAN A-1-o - Suspect rights acknowledgment and statement.pdf', 'jagman/a-1-o/5800.7G-CH2/original.pdf'],
    ['JAGMAN A-1-h - Sample punitive letter of reprimand.pdf', 'jagman/a-1-h/5800.7G-CH2/original.pdf'],
    ['NAVMC 10274 - Administrative Action.pdf', 'NAVMC10274 - Administrative Action/2020-07/original.pdf'],
  ];
  for (const [name, file] of files) {
    await blanks.getByRole('button', { name, exact: true }).click();
    const reader = page.getByRole('dialog', { name, exact: true });
    const pending = page.waitForEvent('download');
    await reader.getByRole('button', { name: 'Download original' }).click();
    const download = await pending;
    await page.keyboard.press('Escape');
    expect(download.suggestedFilename()).toBe(name);
    expect(await readFile((await download.path())!)).toEqual(await readFile('public/templates/' + file));
  }
  await workspace.getByRole('button', { name: 'Edit form', exact: true }).first().click();
  const initial = page.getByRole('dialog', { name: 'Nonjudicial punishment (NJP)', exact: true });
  await initial.getByLabel('18 Accused full name', { exact: true }).fill('RIVERA EXAMPLE');
  const switchForm = initial.getByRole('combobox', { name: 'Package form' });
  await switchForm.selectOption({ label: '2. Rights notice and election' });
  await initial.getByLabel('Marine name', { exact: false }).first().fill('RIVERA EXAMPLE');
  await initial.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(initial.getByText('Saved to package', { exact: true })).toBeVisible();
  await page.reload();
  await expect(initial.getByLabel('Marine name', { exact: false }).first()).toHaveValue('RIVERA EXAMPLE');
  await initial.getByRole('button', { name: 'Back to package' }).click();
  await packageSection(workspace, 'Overview');
  await intake.getByLabel('Package name', { exact: true }).fill('NJP training');
  await intake.getByLabel('Case reference', { exact: true }).fill('TRAINING-01');
  await intake.getByLabel('Unit', { exact: true }).fill('Training unit');
  await intake.getByLabel('Allegation summary', { exact: true }).fill('Synthetic case for package testing');
  await intake.getByLabel('Case stage').selectOption('preparing');
  await expect(intake.getByLabel('Is there an applicable Page 11 entry?')).toBeHidden();
  await intake.getByLabel('Case stage').selectOption('punishment-imposed');
  await intake.getByLabel('Is there an applicable Page 11 entry?').selectOption('true');
  await intake.getByLabel('Was an appeal filed?').selectOption('true');
  await intake.getByLabel('Is the appeal for a corporal or below?').selectOption('true');
  await intake.getByLabel('Has the appeal authority issued its decision?').selectOption('false');
  const decision = intake.getByLabel('PDF for Signed appeal decision correspondence to the Marine', { exact: true });
  await expect(decision).toBeHidden();
  await intake.getByLabel('Has the appeal authority issued its decision?').selectOption('true');
  await intake.getByLabel('Appeal decision', { exact: true }).selectOption('original');
  await expect(decision).toBeVisible();
  const response = await PDFDocument.create();
  response.addPage().drawText('Synthetic appeal response for package testing');
  await decision.setInputFiles({ name: 'training-response.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await response.save()) });
  await expect(intake.getByText('Selected: training-response.pdf', { exact: true })).toBeVisible();
  for (const label of [ 'Are there suspension or vacation documents?', 'Is a finance or IPAC handoff needed?',
    'Does the command require a separate administrative action?', 'Does DD Form 2701 issuance need tracking?']) {
    const field = intake.getByLabel(label, { exact: true });
    if (!(await field.isVisible())) await intake.getByRole('button', { name: 'Next questions' }).click();
    await field.selectOption('false');
  }
  await intake.getByRole('button', { name: 'Review changes' }).click();
  const preview = intake.getByRole('region', { name: 'Action changes preview' });
  await expect(preview).toContainText('Rights notice and election', { timeout: 30_000 });
  await preview.getByRole('button', { name: 'Apply changes' }).click();
  await expect(intake.getByText('Changes saved as a new version.', { exact: true })).toBeVisible({ timeout: 30_000 });
  await packageSection(workspace, 'Documents');
  await workspace.getByRole('button', { name: 'Edit form', exact: true }).first().click();
  const editor = page.getByRole('dialog', { name: 'NJP training' });
  const picker = editor.getByRole('combobox', { name: 'Package form', exact: true });
  await picker.selectOption({ label: '1. Unit Punishment Book' });
  await expect(editor.getByLabel('18 Accused full name', { exact: true })).toHaveValue('RIVERA EXAMPLE');
  await picker.selectOption({ label: '5. Page 11' });
  await editor.getByLabel('Last Name', { exact: true }).fill('EXAMPLE');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor.getByText('Saved to package', { exact: true })).toBeVisible();
  await page.reload();
  await expect(editor.getByLabel('Last Name', { exact: true })).toHaveValue('EXAMPLE');
  await picker.selectOption({ label: '1. Unit Punishment Book' });
  await expect(editor.getByLabel('18 Accused full name', { exact: true })).toHaveValue('RIVERA EXAMPLE');
  await editor.getByRole('button', { name: 'Back to package' }).click();
  await packageSection(workspace, 'Overview');
  await intake.getByRole('button', { name: 'Edit details', exact: true }).click();
  await expect(intake.getByText('Saved original: training-response.pdf', { exact: true })).toBeVisible();
});

test('transfers an incomplete NJP to a fresh browser with its working forms and original guides', async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start writing', exact: true }).click();
  const workspace = await openPackageWorkspace(page);
  await newPackage(workspace);
  await expandPackageTools(workspace);
  await workspace.getByRole('button', { name: 'Start NJP' }).click();
  await expect(workspace.getByRole('heading', { name: '1. Unit Punishment Book' })).toBeVisible({ timeout: 20_000 });
  const rights = { name: /^2\. Rights notice and election/ };
  await workspace.getByRole('navigation', { name: 'Package documents' }).getByRole('button', rights).click();
  await workspace.getByRole('button', { name: 'Edit form', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Nonjudicial punishment (NJP)', exact: true });
  await editor.getByLabel('Marine name', { exact: false }).first().fill('TRANSFER EXAMPLE');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor.getByText('Saved to package', { exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Back to package', exact: true }).click();
  const bytes = await downloadPackageExport(page, workspace, 'Export editable package', 'Download editable package');
  const fresh = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  try {
    const restored = await fresh.newPage();
    await restored.goto('/');
    await restored.getByRole('button', { name: 'Start writing', exact: true }).click();
    const copy = await openPackageWorkspace(restored);
    await importPackage(copy, { name: 'training.dondocs-package.json', mimeType: 'application/json', buffer: bytes });
    await packageSection(copy, 'Documents');
    await copy.getByRole('navigation', { name: 'Package documents' }).getByRole('button', rights).click();
    await expect(copy.getByRole('heading', rights)).toBeVisible();
    const guides = copy.getByRole('region', { name: 'Blank forms and guides' });
    await expect(guides.getByRole('button')).toHaveCount(7);
    await copy.getByRole('button', { name: 'Edit form', exact: true }).click();
    const restoredEditor = restored.getByRole('dialog', { name: 'Nonjudicial punishment (NJP)', exact: true });
    await expect(restoredEditor.getByLabel('Marine name', { exact: false }).first()).toHaveValue('TRANSFER EXAMPLE');
  } finally { await fresh.close(); }
});
