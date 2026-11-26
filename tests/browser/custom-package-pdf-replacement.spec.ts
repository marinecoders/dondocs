import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { downloadPackageExport, newPackage, openAddDocuments, openPackageWorkspace } from './_helpers/packageWorkspace';

test('replaces one of two uploaded files and delivers the correct bytes after reload', async ({ page }) => {
  async function file(name: string) {
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText(name);
    return { name, mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
  }
  const [first, second, corrected] = await Promise.all(['First.pdf', 'Second.pdf', 'Corrected.pdf'].map(file));
  await page.goto('/');
  await page.getByRole('button', { name: 'Start writing' }).click();
  const workspace = await openPackageWorkspace(page);
  await newPackage(workspace);
  const custom = workspace.getByRole('group', { name: 'Custom package', exact: true });
  await custom.getByLabel('Package name').fill('Multiple originals');
  await custom.getByRole('button', { name: 'Create package' }).click();
  await openAddDocuments(workspace);
  await workspace.getByLabel('Add original PDF', { exact: true }).setInputFiles([first, second]);
  await workspace.getByRole('navigation', { name: 'Package documents' }).getByRole('button', { name: /2[.] Second.pdf/ }).click();
  await workspace.getByRole('button', { name: 'Replace PDF in this slot', exact: true }).setInputFiles(corrected);
  await expect(workspace.getByText(/Replace Second.pdf with Corrected.pdf/)).toBeVisible();
  const previous = await workspace.getAttribute('data-revision-id');
  await workspace.getByRole('button', { name: 'Replace PDF', exact: true }).click();
  await expect(workspace).not.toHaveAttribute('data-revision-id', previous!);
  await page.reload();
  await openPackageWorkspace(page);
  const archive = JSON.parse((await downloadPackageExport(page, workspace, 'Export editable package', 'Download editable package')).toString());
  const revision = archive.package.revisions.find((item: { id: string }) => item.id === archive.package.currentRevisionId);
  const files = revision.members.map((member: { original: { id: string } }) =>
    archive.portableResources.entries.find((entry: { path: string }) => entry.path === 'assets/' + member.original.id).data);
  expect(files).toEqual([first.buffer.toString('base64'), corrected.buffer.toString('base64')]);
});
