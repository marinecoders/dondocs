import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import type { PackageDeliveryManifest } from '@/lib/packageDeliveryBundle';
import { expandPackageTools, newPackage, openPackageWorkspace, packageHeading, packageSection, packageTool } from './_helpers/packageWorkspace';

async function startPackage(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start writing', exact: true }).click();
  const workspace = await openPackageWorkspace(page);
  await newPackage(workspace);
  await expandPackageTools(workspace);
  await workspace.getByRole('button', { name: 'Start ' + name, exact: true }).click();
  return workspace;
}

test('starts a dependency application with the official blank and a slot for the signed return', async ({ page }) => {
  const workspace = await startPackage(page, 'dependency application');
  const download = page.waitForEvent('download');
  await workspace.getByRole('list', { name: 'Document requirements' }).getByRole('listitem').filter({ hasText: 'NAVMC 10922' }).getByRole('button', { name: 'Download blank', exact: true }).click();
  const blank = await download;
  expect(blank.suggestedFilename()).toBe('NAVMC 10922 - Dependency Application.pdf');
  const slot = workspace.getByRole('listitem').filter({ hasText: 'Completed and signed NAVMC 10922' });
  const input = slot.getByLabel('Attach completed original for Completed and signed NAVMC 10922');
  await input.setInputFiles({ name: 'official-blank.pdf', mimeType: 'application/pdf', buffer: await readFile((await blank.path())!) });
  await expect(workspace.getByRole('alert').filter({ hasText: 'This is the blank form' })).toBeVisible();
  await workspace.getByRole('button', { name: 'What changed?', exact: true }).click();
  await expect(workspace.getByRole('region', { name: 'Action intake' }).getByLabel('What changed?', { exact: true })).toBeVisible();
});

test('delivers the attested application and written agreement as exact originals', async ({ page }) => {
  test.setTimeout(120_000);
  const workspace = await startPackage(page, 'dependency application');
  const application = 'Completed and signed NAVMC 10922';
  const agreement = 'Court order or written agreement concerning support, maintenance, or paternity';
  const evidence = new Map<string, Buffer>();
  for (const [label, lines] of [
    [application, ['Synthetic dependency application', 'Claimant signature: /s/ Training Marine', 'Attesting signature: /s/ Training Official, by direction']],
    ['Birth certificate', ['Synthetic birth certificate']],
    [agreement, ['Synthetic written paternity agreement', 'No court order']],
  ] as const) {
    const pdf = await PDFDocument.create();
    const sheet = pdf.addPage();
    lines.forEach((line, i) => sheet.drawText(line, { x: 40, y: 700 - 25 * i, size: 12 }));
    evidence.set(label, Buffer.from(await pdf.save()));
  }
  await workspace.getByRole('button', { name: 'What changed?', exact: true }).click();
  const intake = workspace.getByRole('region', { name: 'Action intake' });
  await intake.getByLabel('What changed?', { exact: true }).selectOption('birth');
  await intake.getByLabel('Is there a court order or written agreement in effect concerning support, maintenance, or paternity?', { exact: true }).selectOption('true');
  for (const [label, buffer] of evidence) {
    await intake.getByLabel('PDF for ' + label, { exact: true }).setInputFiles({ name: label + '.pdf', mimeType: 'application/pdf', buffer });
    await expect(intake.getByRole('button', { name: 'Remove selected PDF for ' + label })).toBeVisible();
  }
  await intake.getByRole('button', { name: 'Review changes' }).click();
  await intake.getByRole('button', { name: 'Apply changes' }).click();
  await expect(workspace.getByRole('heading', { name: '1. ' + application })).toBeVisible();
  const delivery = await packageTool(workspace, 'Recipient delivery');
  await delivery.getByRole('button', { name: 'Prepare selected delivery' }).click();
  await expect(delivery.getByText(/Confirm in Documents: I verified the claimant/).first()).toBeVisible();
  await packageSection(workspace, 'Documents');
  const confirmation = workspace.getByRole('checkbox', { name: /I verified the claimant signed/ });
  await confirmation.click();
  await expect(confirmation).toBeChecked();

  for (const [index, label] of [[3, agreement], [1, application]] as const) {
    const heading = await packageHeading(workspace, index + '. ' + label);
    const card = heading.locator('xpath=ancestor::li[1]');
    const updated = await PDFDocument.load(evidence.get(label)!);
    updated.setSubject('Revised training copy');
    const buffer = Buffer.from(await updated.save());
    await card.getByLabel('Replace PDF in this slot').setInputFiles({ name: 'replacement.pdf', mimeType: 'application/pdf', buffer });
    await card.getByRole('button', { name: 'Replace PDF', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Replace PDF', exact: true })).toHaveCount(0);
    evidence.set(label, buffer);
    await packageHeading(workspace, '1. ' + application);
    if (label === agreement) await expect(confirmation).toBeChecked();
    else await expect(confirmation).not.toBeChecked();
  }
  await confirmation.click();
  await expect(confirmation).toBeChecked();
  await expect(workspace).toHaveAttribute('aria-busy', 'false');
  await packageTool(workspace, 'Recipient delivery');
  await delivery.getByRole('button', { name: 'Prepare selected delivery' }).click();
  const contents = delivery.getByRole('region', { name: 'Captured delivery contents' });
  await expect(contents).toBeVisible();
  const review = contents.getByRole('checkbox');
  if (await review.count()) await review.check();
  const download = page.waitForEvent('download');
  await contents.getByRole('button', { name: 'Download reviewed delivery bundle' }).click();
  const zip = await JSZip.loadAsync(await readFile((await (await download).path())!));
  const manifest: PackageDeliveryManifest = JSON.parse(await zip.file('manifest.json')!.async('text'));
  expect(manifest.members.map(member => member.label)).toEqual([...evidence.keys()]);
  const files = manifest.files.filter(file => file.path.startsWith('files/'));
  expect(files).toHaveLength(evidence.size);
  for (const [i, file] of files.entries()) {
    expect(await zip.file(file.path)!.async('nodebuffer')).toEqual(evidence.get(manifest.members[i].label));
  }
});
