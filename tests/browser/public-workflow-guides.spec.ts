import { test, expect } from '@playwright/test';
test.use({ javaScriptEnabled: false, serviceWorkers: 'block' });
test('public guides work without application scripts', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Naval letter generator and correspondence workspace');
  await page.getByRole('link', { name: 'Read the correspondence workflow guides' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Correspondence workflow guides');
  for (const title of ['Prepare a naval letter', 'Prepare a Page 11 entry', 'Prepare an endorsement', 'Assemble a document package']) {
    await page.getByRole('link', { name: title, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(page.getByRole('link', { name: 'Open DonDocs', exact: true })).toHaveAttribute('href', '../');
    await page.getByRole('link', { name: 'All guides' }).click();
  }
});

test.describe('guides from an installed application', () => {
  test.use({ javaScriptEnabled: true, serviceWorkers: 'allow' });
  test('keeps guide navigation separate from the editor and reopens a visited guide offline', async ({ page, context }) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await page.goto('/guides/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Correspondence workflow guides');
    await page.getByRole('link', { name: 'Prepare a naval letter', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Prepare a naval letter');
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Prepare a naval letter');
  });
});
