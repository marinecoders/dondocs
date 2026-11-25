import { expect, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

export async function openPackageWorkspace(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Action packages', exact: true });
  if (await dialog.isVisible()) {
    await expect(dialog.getByRole('status').filter({ hasText: /^Loading packages…$/ })).toHaveCount(0);
    return dialog;
  }
  const drawer = page.getByRole('dialog', { name: 'Documents', exact: true });
  if (!await drawer.isVisible()) await page.getByRole('button', { name: 'Open workspace', exact: true })
    .or(page.getByRole('button', { name: /^Packages(?:\s|$)/ })).first().click();
  // Wait for the launcher transition before choosing the mobile or desktop path.
  await expect(drawer.or(dialog)).toBeVisible();
  if (await drawer.isVisible()) {
    // A visible portal can precede its focus scope becoming active after reload.
    await expect.poll(() => drawer.evaluate(root => root.contains(document.activeElement))).toBe(true);
    await drawer.getByRole('button', { name: /^Packages(?:\s|$)/ }).click();
  }
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('status').filter({ hasText: /^Loading packages…$/ })).toHaveCount(0);
  return dialog;
}

export async function showPackageLibrary(dialog: Locator) {
  const back = dialog.getByRole('button', { name: 'Back to packages', exact: true });
  if (await back.isVisible()) await back.click();
  await expect(dialog.getByRole('heading', { name: 'Packages', exact: true, level: 1 })).toBeVisible();
}

export async function newPackage(dialog: Locator) {
  if (await dialog.getByRole('heading', { name: 'New package', exact: true, level: 1 }).isVisible()) return;
  await showPackageLibrary(dialog);
  await dialog.getByRole('button', { name: 'New package', exact: true }).click();
}

export async function expandPackageTools(root: Locator) {
  for (let opened = 0; opened < 100; opened++) {
    const summary = root.locator('details:not([open]) > summary:visible').first();
    if (!await summary.count()) break;
    await summary.click();
  }
  // The package details toggle appears only after its lazy panel loads.
  const loadingInformation = root.getByRole('status').filter({ hasText: /^Loading package information…$/ });
  await expect(loadingInformation).toBeHidden();
  const links = root.getByRole('button', { name: 'Field links and other details', exact: true });
  if (await links.isVisible() && await links.getAttribute('aria-expanded') === 'false') await links.click();
}

export async function openPackagePreparation(page: Page) {
  const dialog = await openPackageWorkspace(page);
  if (await dialog.getByRole('button', { name: 'New package', exact: true }).isVisible()) await newPackage(dialog);
  await expandPackageTools(dialog);
  return dialog;
}

export async function packageSection(dialog: Locator, section: 'Overview' | 'Documents' | 'Review' | 'Delivery', advanced = false) {
  await dialog.getByRole('navigation', { name: 'Package workspace', exact: true }).getByRole('button', { name: section, exact: true }).click();
  if (advanced) await expandPackageTools(dialog);
}

export async function newBlankPackage(dialog: Locator, name: string) {
  await newPackage(dialog);
  await expandPackageTools(dialog);
  await dialog.getByLabel('Package name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Create package', exact: true }).click();
  await expect(dialog.getByRole('heading', { name, level: 1, exact: true })).toBeVisible();
}

export async function importPackage(dialog: Locator, file: Parameters<Locator['setInputFiles']>[0]) {
  await newPackage(dialog);
  await expandPackageTools(dialog);
  const input = dialog.getByLabel('Import editable package', { exact: true });
  await expect(input).toBeEnabled();
  await input.setInputFiles(file);
  await expect(dialog.getByRole('navigation', { name: 'Package workspace', exact: true }).or(dialog.page().getByRole('dialog', { name: 'Open shared document', exact: true }))).toBeVisible({ timeout: 30_000 });
}

export async function packageVersion(dialog: Locator, id?: string) {
  await dialog.getByRole('button', { name: 'Version history', exact: true }).click();
  const history = dialog.page().getByRole('dialog', { name: 'Version history', exact: true });
  const select = history.getByLabel('Package revision', { exact: true });
  await expect(select).toBeEnabled();
  if (id) { await select.selectOption(id); await expect(history).toBeHidden(); return id; }
  const current = await select.inputValue();
  await history.getByRole('button', { name: 'Done', exact: true }).click();
  return current;
}

export async function choosePackage(dialog: Locator, name: string) {
  await showPackageLibrary(dialog);
  await dialog.getByRole('list', { name: 'Saved packages', exact: true }).getByRole('button').filter({ has: dialog.page().getByText(name, { exact: true }) }).click();
  await expect(dialog.getByRole('heading', { name, level: 1, exact: true })).toBeVisible();
}

export async function choosePackageById(dialog: Locator, id: string) {
  await showPackageLibrary(dialog);
  await dialog.locator(`button[data-package-id="${id}"]`).click();
  await expect(dialog).toHaveAttribute('data-package-id', id);
}

export async function selectedPackageRevision(dialog: Locator) {
  await expect(dialog).toHaveAttribute('data-revision-id', /.+/);
  const id = await dialog.getAttribute('data-revision-id');
  return id!;
}

export async function selectedPackageId(dialog: Locator) {
  await expect(dialog).toHaveAttribute('data-package-id', /.+/);
  const id = await dialog.getAttribute('data-package-id');
  return id!;
}

export async function versionCount(dialog: Locator) {
  // Read the completed operation's history. Dirty drafts may still leave the
  // revision picker read-only, so do not require it to be enabled just to count.
  await expect(dialog).toHaveAttribute('aria-busy', 'false');
  await dialog.getByRole('button', { name: 'Version history', exact: true }).click();
  const history = dialog.page().getByRole('dialog', { name: 'Version history', exact: true });
  const count = await history.getByLabel('Package revision', { exact: true }).getByRole('option').count();
  await history.getByRole('button', { name: 'Done', exact: true }).click();
  return count;
}

export async function preparePackageExport(dialog: Locator, mode: 'pdf' | 'editable' | 'saved' | 'preview') {
  await packageSection(dialog, 'Delivery');
  const back = dialog.getByRole('button', { name: 'Back to export options', exact: true });
  if (await back.isVisible()) await back.click();
  const cancel = dialog.getByRole('button', { name: 'Cancel export', exact: true });
  if (await cancel.isVisible()) await cancel.click();
  if (mode === 'pdf' || mode === 'editable') {
    await dialog.getByRole('button', { name: mode === 'pdf' ? 'PDF' : 'Editable package', exact: true }).click();
    await dialog.getByRole('button', { name: mode === 'pdf' ? 'Prepare PDF' : 'Prepare editable package', exact: true }).click();
  } else {
    await expandPackageTools(dialog);
    await dialog.getByRole('button', { name: mode === 'saved' ? 'Download retained PDF' : 'Preview retained PDF', exact: true }).click();
  }
  await expect(dialog).toHaveAttribute('aria-busy', 'false', { timeout: 90_000 });
  await expect(dialog.getByRole('button', { name: 'Cancel export', exact: true })).toBeVisible();
  await expandPackageTools(dialog);
}

export async function downloadPackageExport(page: Page, dialog: Locator, prepare: string, deliver: string) {
  const selected = dialog.getByRole('navigation', { name: 'Package workspace', exact: true }).locator('[aria-current="location"]');
  const section = await selected.innerText() as 'Overview' | 'Documents' | 'Review' | 'Delivery';
  await prepareExportByLabel(dialog, prepare);
  const action = dialog.getByRole('button', { name: deliver, exact: true });
  await expect(action).toBeEnabled();
  const pending = page.waitForEvent('download', { timeout: 90_000 });
  await action.click();
  const file = await pending;
  expect(await file.failure()).toBeNull();
  const bytes = await readFile((await file.path())!);
  await packageSection(dialog, section, true);
  return bytes;
}

export async function prepareExportByLabel(dialog: Locator, label: string) {
  const modes = { 'Check readiness and assemble': 'pdf', 'Export editable package': 'editable',
    'Download retained PDF': 'saved', 'Preview retained PDF': 'preview' } as const;
  if (label in modes) await preparePackageExport(dialog, modes[label as keyof typeof modes]);
  else {
    await packageSection(dialog, 'Delivery', true);
    await dialog.getByRole('button', { name: label, exact: true }).click();
  }
}

export async function packageTool(dialog: Locator, name: string | RegExp) {
  await expect(dialog).toHaveAttribute('aria-busy', 'false', { timeout: 90_000 });
  const sections: Record<string, 'Overview' | 'Documents' | 'Review' | 'Delivery'> = {
    'Retained PDF comparison': 'Delivery', 'Template and form upgrades': 'Overview', 'Package information': 'Overview', Details: 'Overview', 'Package relationships': 'Overview',
    'Work and next actions': 'Overview', 'Package change impact': 'Overview', 'Reusable package templates': 'Overview',
    'Action intake': 'Overview', 'Evidence and requirements': 'Overview', 'Supporting evidence files': 'Documents', 'Scanned evidence': 'Documents',
    'Package citation repair': 'Documents', 'Linked references and enclosures': 'Documents',
    'Package signing': 'Delivery', 'Resumable PDF assembly': 'Delivery', 'Word package delivery': 'Delivery',
    'Recipient delivery': 'Delivery', 'Assembly layout': 'Delivery', 'Saved PDF contents': 'Delivery',
    'Captured delivery contents': 'Delivery', 'Apply package feedback': 'Review', 'Portable package reviews': 'Review',
    'Original PDF region review': 'Review', 'Captured form field feedback': 'Review', 'Decide captured form corrections': 'Review',
  };
  if (name === 'Packages from a roster' || name === 'Maintain package templates') await showPackageLibrary(dialog);
  if ((name === 'Reusable package templates' || name === 'Action intake') && !await dialog.getByRole('navigation', { name: 'Package workspace', exact: true }).isVisible()) await newPackage(dialog);
  const section = typeof name === 'string' ? sections[name] : 'Overview';
  if (section && await dialog.getByRole('navigation', { name: 'Package workspace', exact: true }).isVisible()) await packageSection(dialog, section);
  await expandPackageTools(dialog);
  return dialog.getByRole('region', { name, ...(typeof name === 'string' ? { exact: true } : {}) });
}

export async function prepareReviewTransfer(dialog: Locator, mode: 'copy' | 'return') {
  await packageSection(dialog, 'Review');
  const transfer = dialog.getByRole('region', { name: 'Portable package reviews', exact: true });
  const download = transfer.getByRole('button', { name: mode === 'copy' ? 'Download review copy' : 'Download feedback', exact: true });
  const prepare = transfer.getByRole('button', { name: mode === 'copy' ? 'Prepare package reviewer copy' : 'Prepare package feedback return', exact: true });
  await expect(download.or(prepare)).toBeEnabled();
  if (!await download.isVisible()) await prepare.click();
  await expect(download).toBeEnabled();
  return transfer;
}

export async function inspectPackageMember(dialog: Locator, memberId: string) {
  await packageSection(dialog, 'Documents');
  const picker = dialog.getByLabel('Document to inspect', { exact: true });
  if (await picker.isVisible()) await picker.selectOption(memberId);
  else {
    const target = dialog.locator(`[id="package-member-${memberId}"]`);
    const index = await target.evaluate(element => [...element.parentElement!.children].indexOf(element));
    await dialog.getByRole('navigation', { name: 'Package documents', exact: true }).getByRole('button').nth(index).click();
  }
}

export async function packageHeading(root: Locator | Page, name: string) {
  const dialog = 'goto' in root ? root.getByRole('dialog', { name: 'Action packages', exact: true }) : root;
  await packageSection(dialog, 'Documents');
  const heading = dialog.getByRole('heading', { name, exact: true, includeHidden: true });
  const card = heading.locator('xpath=ancestor::li[1]');
  const id = await card.getAttribute('id');
  expect(id).toMatch(/^package-member-/);
  await inspectPackageMember(dialog, id!.slice('package-member-'.length));
  await expandPackageTools(card);
  return dialog.page().getByRole('heading', { name, exact: true });
}

export async function preparePackagePdf(dialog: Locator) {
  await packageSection(dialog, 'Delivery');
  const cancel = dialog.getByRole('button', { name: 'Cancel export', exact: true });
  if (await cancel.isVisible()) await cancel.click();
  await dialog.getByRole('button', { name: 'PDF', exact: true }).click();
  await dialog.getByRole('button', { name: 'Prepare PDF', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'PDF export', exact: true })).toBeVisible();
}

/** Inspect the selected document through the control shown at this viewport. */
export async function expectSelectedPackageMemberKind(dialog: Locator, kind: string) {
  const picker = dialog.getByRole('combobox', { name: 'Document to inspect', exact: true });
  if (await picker.isVisible()) {
    await expect(picker.locator('option:checked')).toContainText(kind);
  } else {
    const navigation = dialog.getByRole('navigation', { name: 'Package documents', exact: true });
    await expect(navigation.locator('button[aria-current="true"]')).toContainText(kind);
  }
}

export async function openAddDocuments(workspace: Locator) {
  const closed = workspace.locator('details[data-add-package-document]:not([open]) > summary');
  if (await closed.isVisible()) await closed.click();
}
