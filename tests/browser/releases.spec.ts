import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startUpgradeServer } from './upgradeServer';
import { releaseManifest } from '../../src/lib/releases';

let server: Awaited<ReturnType<typeof startUpgradeServer>>, root: string;
const first = process.env.RELEASE_BUILD_A, second = process.env.RELEASE_BUILD_B;
let firstId: string, secondId: string;
test.beforeAll(async () => {
  if (!first || !second) throw new Error('Set RELEASE_BUILD_A and RELEASE_BUILD_B to two opt-in production builds');
  firstId = JSON.parse(await readFile(resolve(first, 'release.json'), 'utf8')).id;
  secondId = JSON.parse(await readFile(resolve(second, 'release.json'), 'utf8')).id;
  expect(firstId).not.toBe(secondId);
  expect(await readFile(resolve(first, 'sw.js'), 'utf8')).toBe(await readFile(resolve(second, 'sw.js'), 'utf8'));
  server = await startUpgradeServer({ root: () => root });
  server.retain(first); server.retain(second);
});
test.afterAll(async () => { await server?.close(); });
test.beforeEach(() => { root = resolve(first!); server.faults.clear(); server.requests.length = 0; });

async function ready(page: Page, id: string) {
  await expect.poll(() => page.evaluate(async id => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.active) return false;
    return new Promise<boolean>(resolve => {
      const channel = new MessageChannel(), timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 2000);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data?.ready === true); };
      registration.active!.postMessage({ type: 'IS_RELEASE_READY', id }, [channel.port2]);
    });
  }, id), { timeout: 120000 }).toBe(true);
}
async function start(page: Page) {
  await page.addInitScript(() => localStorage.setItem('dondocs-welcome-shown', '3.0'));
  await page.goto(server.origin);
  await page.locator('#subject:visible, #body-subject:visible').fill('RELEASE CHECKPOINT');
  await expect(page.locator('[title^="Saved "]')).toBeVisible({ timeout: 15000 });
  await ready(page, firstId);
}

test('updates only the accepting tab and reopens the staged release offline', async ({ page, context }) => {
  await start(page);
  const other = await context.newPage(); await other.goto(server.origin);
  await expect(other.locator('#subject:visible, #body-subject:visible')).toHaveValue('RELEASE CHECKPOINT');
  const original = await page.evaluate(() => performance.timeOrigin);
  root = resolve(second!);
  await other.bringToFront(); await other.evaluate(() => window.dispatchEvent(new Event('focus')));
  const update = other.getByRole('button', { name: 'Update Available', exact: true });
  await expect(update).toBeVisible({ timeout: 120000 });
  await expect(other.getByRole('dialog')).toHaveCount(0);
  await update.click(); await other.getByRole('button', { name: 'Update Now', exact: true }).click();
  await expect(other.locator('meta[name="dondocs-release"]')).toHaveAttribute('content', secondId);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(original);
  await expect(page.locator('meta[name="dondocs-release"]')).toHaveAttribute('content', firstId);
  await page.locator('#subject:visible, #body-subject:visible').fill('STILL EDITING THE ORIGINAL');
  await context.setOffline(true);
  await other.reload();
  await expect(other.locator('meta[name="dondocs-release"]')).toHaveAttribute('content', secondId);
  await expect(other.locator('#subject:visible, #body-subject:visible')).toBeVisible();
});

test('does not advertise an incomplete release and retries after the origin recovers', async ({ page }) => {
  await start(page);
  const next = releaseManifest.parse(JSON.parse(await readFile(resolve(second!, 'release.json'), 'utf8')));
  const missing = next.assets.find(asset => asset.group === 'shell' && asset.url.endsWith('.js'));
  if (!missing) throw new Error('Missing shell script fixture');
  server.faults.set(missing.url, { status: 503 }); root = resolve(second!);
  const original = await page.evaluate(() => performance.timeOrigin);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => server.requests.some(request => request.path === missing.url && request.status === 503)).toBe(true);
  await expect(page.getByRole('button', { name: 'Update Available', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(original);
  server.faults.clear(); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: 'Update Available', exact: true })).toBeVisible({ timeout: 120000 });
});
