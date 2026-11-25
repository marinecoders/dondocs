import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { choosePackage, downloadPackageExport, importPackage, newPackage, openPackageWorkspace, packageHeading, packageSection } from './_helpers/packageWorkspace';

test('assembles a custom letter and two PDFs and preserves their order on reload and transfer', async ({ page, browser, baseURL }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start writing', exact: true }).click();
  let workspace = await openPackageWorkspace(page);
  await newPackage(workspace);
  const custom = workspace.getByRole('group', { name: 'Custom package', exact: true });
  await custom.getByLabel('Package name').fill('Training correspondence');
  await custom.getByRole('button', { name: 'Create package' }).click();
  await workspace.getByRole('button', { name: 'Add letter', exact: true }).click();
  await expect(workspace.getByRole('heading', { name: '1. Naval letter' })).toBeVisible();
  const actions = workspace.locator('header').filter({ has: page.getByRole('heading', { name: '1. Naval letter' }) });
  await expect(actions.getByRole('button')).toHaveText(['Edit document', 'Sign correspondence']);
  const navigation = workspace.getByRole('navigation', { name: 'Package workspace', exact: true });
  await expect(navigation.getByRole('button', { name: 'Documents' })).toHaveAttribute('aria-current', 'location');
  await workspace.getByLabel('New member role').selectOption('enclosure');
  for (const [index, name] of ['First.pdf', 'Second.pdf'].entries()) {
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText(name);
    await workspace.getByLabel('Add original PDF', { exact: true }).setInputFiles({ name, mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
    await expect(await packageHeading(workspace, (index + 2) + '. ' + name)).toBeVisible();
  }
  await workspace.getByRole('button', { name: 'Move up', exact: true }).click();
  await expect(await packageHeading(workspace, '2. Second.pdf')).toBeVisible();
  await page.reload();
  workspace = await openPackageWorkspace(page);
  await choosePackage(workspace, 'Training correspondence');
  await expect(await packageHeading(workspace, '2. Second.pdf')).toBeVisible();
  const bytes = await downloadPackageExport(page, workspace, 'Export editable package', 'Download editable package');
  const fresh = await browser.newContext({ baseURL });
  try {
    const other = await fresh.newPage();
    await other.goto('/');
    await other.getByRole('button', { name: 'Start writing', exact: true }).click();
    const restored = await openPackageWorkspace(other);
    await importPackage(restored, { name: 'custom.dondocs-package.json', mimeType: 'application/json', buffer: bytes });
    await packageSection(restored, 'Documents');
    for (const label of ['1. Naval letter', '2. Second.pdf', '3. First.pdf']) await expect(await packageHeading(restored, label)).toBeVisible();
  } finally { await fresh.close(); }
});
