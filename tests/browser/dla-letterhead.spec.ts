import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { editorLayout: 'scroll', previewVisible: false } }));
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
});

test('edits dla letterhead through correspondence', async ({ page }) => {
  const picker = page.getByRole('button', { name: /^Correspondence type:/ });
  await picker.click();
  await page.getByRole('option', { name: 'Business Letter', exact: true }).click();
  await page.getByLabel('Letterhead format', { exact: true }).click();
  await page.getByRole('option', { name: 'Defense Logistics Agency', exact: true }).click();
  await expect(page.getByLabel('Letterhead format', { exact: true })).toHaveText('Defense Logistics Agency');
  await expect(page.getByLabel('Seal', { exact: true })).toBeDisabled();
});

test('can select DLA stationery from the record memorandum editor', async ({ page }) => {
  await page.getByRole('button', { name: /^Correspondence type:/ }).click();
  await page.getByRole('option', { name: 'Memorandum for the Record (MFR)', exact: true }).click();
  const format = page.getByLabel('Letterhead format', { exact: true });
  await format.click();
  await page.getByRole('option', { name: 'Defense Logistics Agency', exact: true }).click();
  await expect(format).toHaveText('Defense Logistics Agency');
  await page.getByRole('button', { name: 'Use preprinted stationery', exact: true }).click();
  await expect(page.getByLabel('Letterhead style', { exact: true })).toHaveText('Preprinted stationery');
  await expect(format).toHaveText('Defense Logistics Agency');
  await page.getByLabel('Letterhead style', { exact: true }).click();
  await page.getByRole('option', { name: 'Full letterhead', exact: true }).click();
  await expect(format).toHaveText('Defense Logistics Agency');
});
