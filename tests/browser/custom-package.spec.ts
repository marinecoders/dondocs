import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { openAddDocuments, choosePackage, downloadPackageExport, importPackage, newPackage, openPackageWorkspace, packageHeading, packageSection } from './_helpers/packageWorkspace';

test('assembles a custom letter and two PDFs and preserves their order on reload and transfer', async ({ page, browser, baseURL }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start writing', exact: true }).click();
  let workspace = await openPackageWorkspace(page);
  await newPackage(workspace);
  const custom = workspace.getByRole('group', { name: 'Custom package', exact: true });
  for (const name of ['Administrative request', 'Training participation', 'Evidence submission']) {
    await expect(workspace.getByRole('heading', { name, exact: true })).toHaveCount(0);
    await expect(workspace.getByRole('button', { name: 'Start ' + name.toLowerCase(), exact: true })).toHaveCount(0);
  }
  await custom.getByLabel('Package name').fill('Training correspondence');
  await custom.getByRole('button', { name: 'Create package' }).click();
  await workspace.getByRole('button', { name: 'Add letter', exact: true }).click();
  await expect(workspace.getByRole('heading', { name: '1. Naval letter' })).toBeVisible();
  const actions = workspace.locator('header').filter({ has: page.getByRole('heading', { name: '1. Naval letter' }) });
  await expect(actions.getByRole('button')).toHaveText(['Edit document', 'Sign correspondence']);
  const navigation = workspace.getByRole('navigation', { name: 'Package workspace', exact: true });
  await expect(navigation.getByRole('button', { name: 'Documents' })).toHaveAttribute('aria-current', 'location');
  await openAddDocuments(workspace);
  await expect(workspace.getByLabel('New member role')).toHaveValue('');
  await workspace.getByLabel('New member role').selectOption('enclosure');
  for (const [index, name] of ['First.pdf', 'Second.pdf'].entries()) {
    await openAddDocuments(workspace);
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText(name);
    await workspace.getByLabel('Add original PDF', { exact: true }).setInputFiles({ name, mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
    await expect(await packageHeading(workspace, (index + 2) + '. ' + name)).toBeVisible();
  }
  const sidebar = workspace.getByRole('navigation', { name: 'Package documents' });
  const source = sidebar.getByRole('button', { name: 'Reorder Second.pdf', exact: true });
  const target = sidebar.getByRole('button', { name: 'Reorder First.pdf', exact: true });
  await source.scrollIntoViewIfNeeded();
  const from = (await source.boundingBox())!, to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await expect(workspace.getByRole('status').filter({ hasText: 'Drop at position 2, First.pdf.' })).toBeAttached();
  await page.mouse.up();
  await expect(sidebar.getByRole('button', { name: /2[.] Second[.]pdf/ })).toBeVisible();
  await workspace.getByRole('button', { name: 'Undo document reorder' }).click();
  await expect(sidebar.getByRole('button', { name: /3[.] Second[.]pdf/ })).toBeVisible();
  await expect(workspace.getByRole('button', { name: 'Undo document reorder' })).toHaveCount(0);
  await source.focus(); await page.keyboard.press('Space'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Space');
  await expect(sidebar.getByRole('button', { name: /2[.] Second[.]pdf/ })).toBeVisible();
  const revision = await workspace.getAttribute('data-revision-id');
  await source.focus(); await page.keyboard.press('Space');
  await expect(source).toHaveAttribute('aria-pressed', 'true'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape');
  await expect(workspace).toHaveAttribute('data-revision-id', revision!);
  for (const [arrow, position] of [['ArrowDown', 3], ['ArrowUp', 2]] as const) {
    await source.focus(); await page.keyboard.press('Space');
    await expect(source).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press(arrow);
    if (position === 3) await expect(workspace.getByRole('status').filter({ hasText: 'Drop at position ' + position })).toBeAttached();
    await page.keyboard.press('Space');
    await expect(sidebar.getByRole('button', { name: new RegExp(position + '[.] Second[.]pdf') })).toBeVisible();
    await expect(source).toBeFocused();
  }
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

test('promotion requires confirmation and saves one main document at the start', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start writing', exact: true }).click();
  const workspace = await openPackageWorkspace(page);
  await newPackage(workspace);
  const custom = workspace.getByRole('group', { name: 'Custom package', exact: true });
  await custom.getByLabel('Package name').fill('Main document selection');
  await custom.getByRole('button', { name: 'Create package' }).click();
  await workspace.getByRole('button', { name: 'Add letter', exact: true }).click();
  await openAddDocuments(workspace);
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('New lead document');
  await workspace.getByLabel('Add original PDF', { exact: true }).setInputFiles({
    name: 'Lead.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()),
  });
  await expect(workspace.getByRole('heading', { name: '2. Lead.pdf' })).toBeVisible();
  await workspace.getByText('Document details', { exact: true }).filter({ visible: true }).click();
  await workspace.getByText('Make main document', { exact: true }).click();
  await expect(workspace.getByLabel('Role for Lead.pdf')).toHaveValue('supporting-document');
  await workspace.getByRole('button', { name: 'Confirm main document' }).click();
  await expect(workspace.getByRole('heading', { name: '1. Lead.pdf' })).toBeVisible();
  await page.reload();
  const restored = await openPackageWorkspace(page);
  await choosePackage(restored, 'Main document selection');
  await expect(await packageHeading(restored, '2. Naval letter')).toBeVisible();
  await expect(restored.getByLabel('Role for Naval letter')).toHaveValue('supporting-document');
  await expect(await packageHeading(restored, '1. Lead.pdf')).toBeVisible();
  await expect(restored.getByLabel('Role for Lead.pdf')).toHaveValue('basic-letter');
});

test('places the first main letter ahead of existing supporting material', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start writing', exact: true }).click();
  const workspace = await openPackageWorkspace(page);
  await newPackage(workspace);
  const custom = workspace.getByRole('group', { name: 'Custom package' });
  await custom.getByLabel('Package name').fill('Supporting material first');
  await custom.getByRole('button', { name: 'Create package' }).click();
  await workspace.getByRole('button', { name: 'Add coordination page' }).click();
  await expect(workspace.getByRole('heading', { name: '1. Coordination page' })).toBeVisible();
  await openAddDocuments(workspace);
  await workspace.getByRole('button', { name: 'Add letter', exact: true }).click();
  await expect(workspace.getByRole('heading', { name: '1. Naval letter' })).toBeVisible();
  await expect(await packageHeading(workspace, '2. Coordination page')).toBeVisible();
});

test('finds documents by type and form number without leaving the package', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start writing', exact: true }).click();
  const draft = { docType: 'naval_letter', documentMode: 'compliant', documentCategory: 'correspondence', formData: { subject: 'LIBRARY FIRST' },
    paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'letter.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await expect(page.getByRole('banner').getByRole('button', { name: 'LIBRARY FIRST', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New correspondence', exact: true }).click();
  const workspace = await openPackageWorkspace(page);
  await newPackage(workspace);
  const custom = workspace.getByRole('group', { name: 'Custom package', exact: true });
  await custom.getByLabel('Package name').fill('Command correspondence');
  await custom.getByRole('button', { name: 'Create package' }).click();
  const search = workspace.getByRole('searchbox', { name: 'Search documents to add' });
  await search.fill('business letter');
  await workspace.getByRole('button', { name: /^Add Business Letter/i }).click();
  await expect(workspace.getByRole('heading', { name: /^1\. Business Letter/i })).toBeVisible();
  await openAddDocuments(workspace);
  await search.fill('10132');
  await workspace.getByRole('button', { name: 'Add Unit Punishment Book', exact: true }).click();
  await expect(workspace.getByRole('heading', { name: '2. Unit Punishment Book' })).toBeVisible();
  await openAddDocuments(workspace);
  await workspace.getByRole('button', { name: 'My documents', exact: true }).click();
  await workspace.getByRole('button', { name: /Add .*LIBRARY FIRST/i }).click();
  await expect(workspace.getByRole('heading', { name: /3\..*LIBRARY FIRST/i })).toBeVisible();
  await expect(workspace.getByRole('navigation', { name: 'Package documents' }).getByRole('button', { name: /^[0-9]+[.]/ })).toHaveCount(3);
});
