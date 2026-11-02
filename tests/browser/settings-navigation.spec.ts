import { test, expect, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Document actions', exact: true })).toBeVisible();
});

async function openWorkspaceTool(page: Page, name: string) {
  const workspace = page.getByRole('button', { name: 'Open workspace', exact: true });
  if (await workspace.isVisible()) await workspace.click();
  await page.getByRole('button', { name, exact: true }).click();
}

async function expectBackupControls(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  const heading = dialog.getByRole('heading', { name: 'Backup & restore', exact: true });
  await heading.scrollIntoViewIfNeeded();
  await expect(heading).toBeInViewport({ ratio: 1 });
  for (const name of ['Download workspace backup', 'Restore from backup']) {
    const button = dialog.getByRole('button', { name, exact: true });
    await button.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await expect(button).toBeInViewport({ ratio: 1 });
    await expect(button).toBeEnabled();
    const contained = await button.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const scroll = element.closest('section')!.parentElement!.getBoundingClientRect();
      return bounds.left >= scroll.left - 1 && bounds.right <= scroll.right + 1
        && bounds.top >= scroll.top - 1 && bounds.bottom <= scroll.bottom + 1;
    });
    expect(contained).toBe(true);
  }
  const overflow = await dialog.evaluate(element => element.scrollWidth > element.clientWidth);
  expect(overflow).toBe(false);
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 320, height: 568 }, { width: 568, height: 320 }]) {
  test.describe(`Settings at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('backup controls remain reachable inside Settings and closing restores keyboard focus', async ({ page }, testInfo) => {
      await openWorkspaceTool(page, 'Settings');
      const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
      await expect(dialog.getByRole('radio', { checked: true })).toBeFocused();
      await expectBackupControls(page);
      await page.screenshot({ path: testInfo.outputPath('settings-backup.png') });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      const workspace = page.getByRole('button', { name: 'Open workspace', exact: true });
      await expect(await workspace.isVisible() ? workspace : page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
    });
  });
}

test('Help and search still open Settings directly at backups', async ({ page }) => {
  await openWorkspaceTool(page, 'Help');
  await page.getByRole('button', { name: 'Backup & restore', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Backup & restore', exact: true })).toBeFocused();
  await expectBackupControls(page);
  await expect(page.getByRole('dialog', { name: 'Help', exact: true })).toBeHidden();
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Command search' }).fill('Backup and restore settings');
  await expect(page.getByRole('option', { name: /^Backup and restore settings/ })).toBeVisible();
  await page.getByRole('combobox', { name: 'Command search' }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Backup & restore', exact: true })).toBeFocused();
  await expectBackupControls(page);
  await expect(page.getByRole('dialog', { name: 'Search workspace', exact: true })).toBeHidden();
});

test('backup tour highlights workspace navigation rather than document actions', async ({ page }, testInfo) => {
  await openWorkspaceTool(page, 'Help');
  await page.getByRole('button', { name: 'Take optional tour', exact: true }).click();
  const title = page.getByRole('heading', { name: 'Download workspace backup', exact: true });
  for (let step = 0; step < 8 && !await title.isVisible(); step++) {
    await page.getByRole('button', { name: 'Next', exact: true }).click();
  }
  await expect(title).toBeVisible();
  const target = page.locator('[data-tour="settings"], [data-tour="workspace-menu"][aria-haspopup="dialog"]').first();
  await expect(target).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('dialog', { name: 'Documents', exact: true })).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('backup-tour.png') });
  await page.keyboard.press('Escape');
  await expect(title).toBeHidden();
});
