import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

for (const theme of ['light', 'dark', 'classic']) {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 320, height: 568 }]) {
    test.describe(`${theme} at ${viewport.width}px`, () => {
      test.use({ viewport });

      test('reviews current findings and opens the exact editor field without editing it', async ({ page }, testInfo) => {
        await page.addInitScript(theme => {
          localStorage.setItem('browser-test-visitor', 'returning');
          localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme, editorLayout: 'focused' }, version: 1 }));
        }, theme);
        await page.goto('/');
        const draft = {
          documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter', formType: 'navmc_10274',
          formData: { unitLine1: 'SYNTHETIC UNIT', from: 'Commanding Officer', to: 'Director', date: '2026-11-12',
            sigLast: 'EXAMPLE', subject: 'SYNTHETIC REVIEW' },
          paragraphs: [{ id: 'synthetic-review-body', text: 'A synthetic paragraph for review.', level: 0 }],
          references: [], enclosures: [], copyTos: [], distributions: [],
        };
        await page.getByLabel('Import draft file').setInputFiles({ name: 'synthetic-review.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
        await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Review draft', exact: true })).toBeHidden();
        const entry = page.getByRole('button', { name: /^Proofread: \d+ findings?$/ });
        await entry.click();
        const dialog = page.getByRole('dialog', { name: 'Proofread', exact: true });
        await expect(dialog.getByText('Use the date format for this document.', { exact: true })).toBeVisible();
        const status = dialog.getByRole('status').first();
        const count = Number((await status.textContent())?.match(/\d+/)?.[0]);
        expect(count).toBeGreaterThan(0);
        await expect(dialog.locator('li')).toHaveCount(count);
        await expect(dialog.getByText(/Birth Date.*pattern/)).toHaveCount(0);
        expect(await dialog.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
        await page.screenshot({ path: testInfo.outputPath(`proofread-${theme}-${viewport.width}.png`) });
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(entry).toBeFocused();

        await entry.click();
        const dateFinding = dialog.locator('li').filter({ hasText: 'Use the date format for this document.' });
        const go = dateFinding.getByRole('button', { name: 'Go to Addressing', exact: true });
        await go.focus();
        await page.keyboard.press('Enter');
        await expect(dialog).toBeHidden();
        const date = page.locator('#date');
        await expect(date).toBeFocused();
        await expect(date).toHaveValue('2026-11-12');
        await expect(page.locator('#subject')).toHaveValue('SYNTHETIC REVIEW');
        await page.getByRole('button', { name: 'Apply date formatting fix' }).click();
        await expect(date).toHaveValue('12 Nov 26');
        await entry.click();
        await expect(dialog.getByText('Use the date format for this document.', { exact: true })).toHaveCount(0);
        await expect(dialog.getByText(/No findings from the available checks/)).toBeVisible();
        await dialog.getByRole('button', { name: 'Done', exact: true }).click();
        await expect(dialog).toBeHidden();
      });
    });
  }
}

test('combines existing check groups and links a sensitive-text finding to its own paragraph', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: 'light', editorLayout: 'focused' }, version: 1 }));
  });
  await page.goto('/');
  const draft = {
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter', formType: 'navmc_10274',
    formData: { unitLine1: '', from: 'Commanding Officer', to: 'Director', date: '2026-11-12',
      sigLast: 'EXAMPLE', subject: 'SYNTHETIC REVIEW', classLevel: 'unclassified' },
    paragraphs: [{ id: 'synthetic-opening', text: 'NATO reference (z).', level: 0 },
      { id: 'synthetic-sensitive', text: 'Synthetic example 123-45-6789.', header: 'Synthetic heading', level: 1, portionMarking: 'S' }],
    references: [], enclosures: [], copyTos: [], distributions: [],
  };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'synthetic-findings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review draft', exact: true })).toBeHidden();
  await page.getByRole('button', { name: /^Proofread: \d+ findings?$/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Proofread', exact: true });
  for (const group of ['Required fields', 'Formatting', 'Paragraph structure', 'References', 'Markings', 'Abbreviations', 'Sensitive text']) {
    await expect(dialog.getByRole('heading', { name: new RegExp(`^${group} \\(`) })).toHaveCount(1);
  }
  await expect(dialog).not.toContainText('123-45-6789');
  const privacy = dialog.locator('li').filter({ hasText: 'Social Security Number pattern in Paragraph 2' });
  await privacy.getByRole('button', { name: 'Go to Paragraphs', exact: true }).click();
  await expect(dialog).toBeHidden();
  const body = page.locator('[data-paragraph-id="synthetic-sensitive"] [contenteditable="true"]');
  await expect(body).toBeFocused();
  await expect(body).toHaveText('Synthetic example 123-45-6789.');
});
