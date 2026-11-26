import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { downloadPackageExport, expandPackageTools, newPackage, openPackageWorkspace, packageSection } from './_helpers/packageWorkspace';

test('keeps separate receipts and replaces the orders from intake without removing the slot', async ({ page }) => {
  async function file(name: string) {
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText(name);
    return { name, mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
  }
  const receipts = await Promise.all(['Hotel A.pdf', 'Hotel B.pdf'].map(file));
  const orders = await file('Original orders.pdf'), corrected = await file('Amended orders.pdf');
  await page.goto('/');
  await page.getByRole('button', { name: 'Start writing' }).click();
  const workspace = await openPackageWorkspace(page);
  await newPackage(workspace); await expandPackageTools(workspace);
  await workspace.getByRole('button', { name: 'Start Okinawa TLA claim', exact: true }).click();
  await workspace.getByRole('button', { name: 'When was the lodging used?' }).click();
  const intake = workspace.getByRole('region', { name: 'Action intake', exact: true });
  const questions = intake.getByRole('region', { name: 'Intake questions' });
  await questions.getByLabel('When was the lodging used?').selectOption('departure');
  for (const question of ['Did you use off-base lodging?', 'Does your departure require a billeting or barracks letter?', 'Are you departing for separation processing?'])
    await questions.getByLabel(question).selectOption('false');
  const orderSlot = intake.getByLabel('PDF for Orders with applicable endorsements', { exact: true });
  await orderSlot.setInputFiles(orders);
  await expect(intake.getByText('Selected: ' + orders.name, { exact: true })).toBeVisible();
  await intake.getByLabel('PDF for Itemized zero-balance lodging receipts', { exact: true }).setInputFiles(receipts);
  await expect(intake.getByRole('button', { name: 'Remove Hotel B.pdf' })).toBeVisible();
  async function apply() {
    const revision = await workspace.getAttribute('data-revision-id');
    await intake.getByRole('button', { name: 'Apply changes' }).click();
    await expect(workspace).not.toHaveAttribute('data-revision-id', revision!);
  }
  await intake.getByRole('button', { name: 'Review changes' }).click();
  await apply();
  await page.reload();
  await openPackageWorkspace(page);
  await packageSection(workspace, 'Overview');
  const edit = intake.getByRole('button', { name: 'Edit details' }); if (await edit.isVisible()) await edit.click();
  await orderSlot.setInputFiles(corrected);
  await intake.getByRole('button', { name: 'Review changes' }).click();
  await expect(intake.getByText(/Replace Original orders.pdf with Amended orders.pdf/)).toBeVisible();
  await apply();
  await packageSection(workspace, 'Documents');
  const nav = workspace.getByRole('navigation', { name: 'Package documents' });
  await nav.getByRole('button', { name: /Hotel B.pdf/ }).click();
  const card = workspace.locator('li[data-selected="true"]');
  await card.getByText('Document details', { exact: true }).click();
  await card.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(nav.getByRole('button', { name: /Hotel B.pdf/ })).toHaveCount(0);
  const archive = JSON.parse((await downloadPackageExport(page, workspace, 'Export editable package', 'Download editable package')).toString());
  const revision = archive.package.revisions.find((item: {id: string}) => item.id === archive.package.currentRevisionId);
  const entries = archive.portableResources.entries as {path: string; data: string}[];
  const values = revision.members.filter((member: { kind: string }) => member.kind === 'original').map((member: {original: {id: string}}) =>
    entries.find(entry => entry.path === 'assets/' + member.original.id)?.data);
  expect(values).toContain(receipts[0].buffer.toString('base64'));
  expect(values).toContain(corrected.buffer.toString('base64'));
  expect(values).not.toContain(receipts[1].buffer.toString('base64'));
  expect(values).not.toContain(orders.buffer.toString('base64'));
});
