import { expect, type Page } from '@playwright/test';

/** Initialize only the published app, policy and ordinary preview resources.
 * No source documents, template catalogs or transfer assets are installed here.
 */
export async function prepareOfflineApp(page: Page, url?: string): Promise<void> {
  if (url) await page.goto(url);
  else await page.reload();
  await expect(page.getByRole('button', { name: 'Document actions', exact: true })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  if (!await page.evaluate(() => navigator.serviceWorker.controller !== null)) await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const preview = page.getByRole('button', { name: 'Preview', exact: true });
  await expect(preview).toBeVisible();
  const mobile = await preview.getAttribute('aria-haspopup') === 'dialog';
  if (mobile || await preview.getAttribute('aria-pressed') !== 'true') await preview.click();
  await expect(page.locator('[data-pdf-layer="active"] canvas').first()).toBeVisible();
  // Populate the real worker's normal deployment-policy cache before disconnecting.
  const policyPath = '/classification.config.json?deployment-policy=runtime';
  await page.evaluate(async path => {
    const response = await fetch(path, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Published deployment policy could not be loaded: ${response.status}`);
    await response.text();
  }, policyPath);
  await expect.poll(() => page.evaluate(async path => !!await caches.match(new URL(path, location.href)), policyPath)).toBe(true);
  if (mobile) await page.getByRole('button', { name: 'Close preview', exact: true }).click();
}
