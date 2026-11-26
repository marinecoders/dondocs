import { test, expect, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const origin = 'http://127.0.0.1:4178';
const page11 = 'public/templates/NAVMC11811 - Administrative Remarks/2014-05/original.pdf';

async function withBridge(mode: 'native' | 'synthetic', work: (pairing: string, directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'dondocs signing '));
  const child = spawn('python', ['-u', 'tests/windows-signing/fixture.py', mode, directory, '--origin', origin],
    { stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = once(child, 'close');
  const lines = createInterface({ input: child.stdout });
  try {
    const first = await lines[Symbol.asyncIterator]().next();
    const prefix = `Pair ${origin} with this code: `;
    if (first.done || !first.value.startsWith(prefix)) throw new Error('Signing bridge failed to start.');
    await work(first.value.slice(prefix.length), directory);
  } finally {
    lines.close();
    child.kill();
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
});

async function openForm(page: Page, pdf: string) {
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Signing workspace', exact: true }).click();
  await page.getByLabel('Open an official form PDF').setInputFiles(pdf);
}

async function pair(page: Page, code: string, status = 'CAC bridge connected.') {
  const panel = page.getByRole('region', { name: 'Official form signatures' });
  await panel.getByLabel('Local bridge pairing code').fill(code);
  await panel.getByRole('button', { name: 'Connect CAC' }).click();
  const confirm = page.getByRole('button', { name: 'Inspect reviewed PDF' });
  const connected = panel.getByText(status, { exact: true });
  await expect(confirm.or(connected)).toBeVisible();
  if (await confirm.isVisible()) await confirm.click();
  await expect(connected).toBeVisible();
  return panel;
}

test('pairs with the native helper and reports an empty reader', async ({ page }) => {
  await withBridge('native', async code => {
    await openForm(page, page11);
    const panel = await pair(page, code, 'Bridge connected. Insert your signing card and reconnect to sign.');
    await expect(panel.getByRole('listitem').filter({ hasText: 'Available' })).toHaveCount(3);
    await expect(panel.getByRole('button', { name: 'Sign with CAC' })).toBeDisabled();
  });
});

test('preserves the draft on cancellation and verifies the signed PDF on retry', async ({ page }) => {
  await withBridge('synthetic', async (code, directory) => {
    await openForm(page, page11);
    const panel = await pair(page, code);
    await expect(panel.getByLabel('Signing certificate')).toContainText('DonDocs test signer');
    await panel.getByLabel('I reviewed the exact PDF and selected signature field.').check();
    const sign = panel.getByRole('button', { name: 'Sign with CAC' });
    const cancel = join(directory, 'cancel');
    await writeFile(cancel, '');
    await sign.click();
    await expect(panel.getByRole('alert')).toHaveText('CAC signing canceled.');
    await expect(panel.getByText('Official PDF · Revision 1', { exact: true })).toBeVisible();
    await rm(cancel);
    await sign.click();
    await expect(panel.getByText('Official PDF · Revision 2', { exact: true })).toBeVisible();
    await expect(panel.getByText('Signed · trusted chain', { exact: true })).toHaveCount(1);
  });
});

test('countersigns the UPB while retaining the first signature and its field locks', async ({ page }) => {
  await withBridge('synthetic', async code => {
    await openForm(page, 'public/templates/NAVMC10132 - Unit Punishment Book/original.pdf');
    const panel = await pair(page, code);
    const field = panel.getByRole('combobox', { name: 'Signature field', exact: true });
    await expect(panel.getByRole('listitem').filter({ hasText: 'Available' })).toHaveCount(7);
    for (const name of ['9 NJP AUTHORITY SIGNATURE', '11 APPEAL ADVISEMENT SIGNATURE']) {
      await field.selectOption(name);
      await panel.getByLabel('I reviewed the exact PDF and selected signature field.').check();
      await panel.getByRole('button', { name: 'Sign with CAC' }).click();
      await expect(panel.getByRole('listitem').filter({ hasText: name })).toContainText('Signed · trusted chain');
    }
    await expect(panel.getByText('Signed · trusted chain', { exact: true })).toHaveCount(2);
    await expect(panel.getByRole('listitem').filter({ hasText: '2 ACC ELECTION AND RIGHTS SIGNATURE' })).toContainText('Locked');
    await expect(panel.getByText('Official PDF · Revision 3', { exact: true })).toBeVisible();
  });
});

test('signs the selected correspondence draft through its download menu', async ({ page }) => {
  await withBridge('synthetic', async code => {
    const preview = page.getByRole('button', { name: 'Preview', exact: true });
    if (await preview.getAttribute('aria-pressed') !== 'true') await preview.click();
    await expect(page.locator('[data-pdf-layer="active"] canvas').first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('TRAINING CORRESPONDENCE');
    await page.getByRole('textbox', { name: 'Paragraph 1', exact: true }).fill('Review the training letter.');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sign correspondence with CAC', exact: true }).click();
    const panel = await pair(page, code);
    await expect(panel.getByRole('combobox', { name: 'Signature field', exact: true })).toHaveValue('Signing_authority');
    await panel.getByLabel('I reviewed the exact PDF and selected signature field.').check();
    await panel.getByRole('button', { name: 'Sign with CAC' }).click();
    await expect(panel.getByText('Signed · trusted chain', { exact: true })).toBeVisible();
    await expect(panel.getByText('Official PDF · Revision 2', { exact: true })).toBeVisible();
  });
});
