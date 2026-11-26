import { expect, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { expandPackageTools, importPackage, newPackage } from './packageWorkspace';

function fixture(name: string) {
  return readFile(new URL(`../../fixtures/retired-packages/${name}.json`, import.meta.url));
}

export async function importSavedRequest(dialog: Locator, second = false) {
  const buffer = await fixture(second ? 'second-request' : 'request');
  await importPackage(dialog, { name: 'request.dondocs-package.json', mimeType: 'application/json', buffer });
  await expect(dialog.getByRole('heading', { name: JSON.parse(buffer.toString()).package.name, level: 1, exact: true })).toBeVisible();
}

// Drive reusable intake through a user-owned copy of a template from before retirement.
export async function selectSavedTemplate(dialog: Locator, name: string) {
  await newPackage(dialog);
  const disclosure = dialog.locator('summary').filter({ hasText: /^Use a saved conditional template$/ });
  await expect(disclosure).toBeVisible();
  await expandPackageTools(dialog);
  const load = dialog.getByRole('button', { name: 'Load saved conditional templates' });
  await load.click();
  const select = dialog.getByRole('combobox', { name: 'Saved conditional template', exact: true });
  await expect(select).toBeEnabled();
  const option = select.getByRole('option', { name: new RegExp('^' + name + ' ·', 'i') });
  if (!await option.count()) {
    const buffer = await fixture(name.replaceAll(' ', '-'));
    await dialog.getByLabel('Import package template', { exact: true }).setInputFiles({ name: 'template.json', mimeType: 'application/json', buffer });
    await dialog.getByRole('checkbox', { name: /^I reviewed this template's retained text/ }).check();
    await dialog.getByRole('button', { name: 'Import reviewed package template' }).click();
    await expect(dialog.getByText('Package template imported.', { exact: true })).toBeVisible();
    await load.click();
  }
  await expect(option).toHaveCount(1);
  await select.selectOption({ label: await option.innerText() });
  return dialog.getByRole('button', { name: 'Use selected conditional template' });
}
