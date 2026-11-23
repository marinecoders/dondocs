import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { editorLayout: 'scroll', previewVisible: false } }));
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
});

test('edits directive formats through correspondence', async ({ page }) => {
  const picker = page.getByRole('button', { name: /^Correspondence type:/ });
  await picker.click();
  await expect(page.getByRole('group', { name: 'Directives' }).getByRole('option')).toHaveCount(5);
  await page.getByRole('option', { name: 'Marine Corps Bulletin', exact: true }).click();
  await page.getByLabel('Directive number', { exact: true }).fill('5215.1K');
  await page.getByLabel('Cancellation line', { exact: true }).fill('Canc: Sep 2027');
  await picker.click();
  await page.getByRole('option', { name: 'Naval Letter (on letterhead)', exact: true }).click();
  await picker.click();
  await page.getByRole('option', { name: 'Marine Corps Bulletin', exact: true }).click();
  await expect(page.getByLabel('Cancellation line', { exact: true })).toHaveValue('Canc: Sep 2027');
  await picker.click();
  await page.getByRole('option', { name: 'Change Transmittal', exact: true }).click();
  await expect(page.getByText('Attach the approved, already numbered replacement pages', { exact: false })).toBeVisible();
  await expect(page.getByText('SECNAV requires 12-point Courier New', { exact: false })).toBeVisible();
});
