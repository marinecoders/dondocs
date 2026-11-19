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

test('opens finding and checklist sources without competing dialogs and retains keyboard navigation', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { previewVisible: false } }));
  });
  await page.goto('/');
  const draft = {
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter', formType: 'navmc_10274',
    formData: { date: '19 Nov 26', subject: 'SYNTHETIC SOURCE REVIEW.' },
    paragraphs: [{ level: 0, text: 'Fictional reference-navigation test.' }], references: [], enclosures: [], copyTos: [], distributions: [],
  };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'manual-source-synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  const proofread = page.getByRole('button', { name: /^Proofread: \d+ findings?$/ });
  await proofread.click();
  const review = page.getByRole('dialog', { name: 'Proofread', exact: true });
  const finding = review.getByRole('listitem').filter({ has: page.getByText('Review subject punctuation', { exact: true }) });
  await finding.getByRole('button', { name: 'SECNAV M-5216.5 · Ch 7 ¶9', exact: true }).click();
  const guide = page.getByRole('dialog', { name: 'Document Guide', exact: true });
  await expect(review).toBeHidden();
  await expect(guide.getByRole('region', { name: 'Manual text page 7-5' })).toContainText('9. Subject Line');
  await page.keyboard.press('Escape');
  await expect(guide).toBeHidden();
  await expect(proofread).toBeFocused();

  await proofread.click();
  await review.getByRole('button', { name: 'Read the manual checklist · Ch 2 ¶19', exact: true }).click();
  await expect(review).toBeHidden();
  await expect(guide.getByRole('region', { name: 'Manual text page 2-12' })).toContainText('19. Proofreading.');
  await guide.getByRole('searchbox', { name: 'Search manual' }).fill('Proofreading');
  await guide.getByRole('button', { name: 'Search', exact: true }).click();
  const back = guide.getByRole('button', { name: 'Return to reading', exact: true });
  await back.focus();
  await page.keyboard.press('Enter');
  await expect(guide.getByRole('heading', { name: /Page 2-12/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(guide).toBeHidden();
});
