import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import source from '../../src/data/correspondenceManualSource.json' with { type: 'json' };

test.use({ serviceWorkers: 'block' });
async function manual(page: Page) {
  await page.getByRole('button', { name: 'Document tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Document type guide', exact: true }).click();
  const guide = page.getByRole('dialog', { name: 'Document Guide', exact: true });
  await guide.getByRole('tab', { name: 'Manual', exact: true }).click();
  await expect(guide.getByRole('searchbox', { name: 'Search manual' })).toBeVisible();
  return guide;
}
for (const theme of ['light', 'dark', 'classic']) for (const width of [320, 1280]) test(`manual search, source PDF, offline reopen and Escape in ${theme} at ${width}px`, async ({ page, context }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(theme => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme, previewVisible: false } }));
  }, theme);
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('/references/secnav-m-5216-5/')) requests.push(request.url()); });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Document tools', exact: true })).toBeVisible();
  expect(requests).toEqual([]);
  const guide = await manual(page);
  await expect(guide.getByText(/Reference text saved for offline reading/)).toBeVisible({ timeout: 30_000 });
  expect(requests.some(url => url.endsWith('manual.pdf'))).toBe(false);
  await guide.getByRole('searchbox', { name: 'Search manual' }).fill('Are enclosure markings correct?');
  await guide.getByRole('button', { name: 'Search', exact: true }).click();
  await guide.getByRole('button', { name: /Page 2-12 · PDF page 28/ }).click();
  await expect(guide.getByRole('region', { name: 'Manual text page 2-12' })).toContainText('19. Proofreading.');
  await expect(guide.getByRole('region', { name: 'Manual text page 2-12' }).locator('mark')).toBeInViewport();
  await guide.getByRole('button', { name: 'View original PDF page 28' }).click();
  await expect(guide.getByLabel('Original manual PDF page 28').locator('canvas')).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: info.outputPath('manual-original-page28.png') });
  const pending = page.waitForEvent('download');
  await guide.getByRole('button', { name: 'Download original PDF', exact: true }).click();
  const downloaded = await pending;
  const stream = await downloaded.createReadStream(), chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(createHash('sha256').update(Buffer.concat(chunks)).digest('hex')).toBe(source.sourceSha256);
  await guide.getByRole('button', { name: 'Back to reference text' }).click();
  await expect(guide.getByRole('heading', { name: /Page 2-12/ })).toBeFocused();
  await page.screenshot({ path: info.outputPath('manual-reader.png') });
  expect(await guide.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
  await page.keyboard.press('Escape');
  await expect(guide).toBeHidden();
  await expect(page.getByRole('button', { name: 'Document tools', exact: true })).toBeFocused();
  await context.setOffline(true);
  const reopened = await manual(page);
  await expect(reopened.getByText(/Reference text saved for offline reading/)).toBeVisible();
  await reopened.getByRole('searchbox', { name: 'Search manual' }).fill('Proofreading');
  await reopened.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(reopened.getByRole('button', { name: /Page 2-12 · PDF page 28/ })).toBeVisible();
  await reopened.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(reopened).toBeHidden();
  await context.setOffline(false);
});
