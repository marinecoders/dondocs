import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
test.setTimeout(90_000);

for (const theme of ['light', 'dark', 'classic']) {
  test(`previews field fixes and reverses each with Undo in ${theme}`, async ({ page }, testInfo) => {
    await page.addInitScript(theme => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme, editorLayout: 'scroll' }, version: 1 }));
    }, theme);
    await page.goto('/');
    const draft = {
      documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter', formType: 'navmc_10274',
      formData: { date: '2026-11-12', sigFirst: ' J . ', sigMiddle: ' R . ', sigLast: 'DOE', subject: 'FORMATTING REVIEW' },
      paragraphs: [{ text: 'Synthetic content stays unchanged.', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [],
    };
    await page.getByLabel('Import draft file').setInputFiles({ name: 'formatting.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    const addressing = page.locator('#sec-addressing');
    const signature = page.locator('#sec-signature');
    const applyDate = addressing.getByRole('button', { name: 'Apply date formatting fix' });
    await applyDate.scrollIntoViewIfNeeded();
    await expect(addressing.getByText('“2026-11-12”')).toBeVisible();
    await expect(addressing.getByText('“12 Nov 26”')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`date-${theme}.png`) });
    await applyDate.click();
    await expect(page.locator('#date')).toHaveValue('12 Nov 26');
    await expect(page.locator('#sigFirst')).toHaveValue(' J . ');

    const undo = async () => {
      await page.getByRole('button', { name: 'Document tools', exact: true }).click();
      await page.getByRole('menuitem', { name: /^Undo/ }).click();
    };
    await undo();
    await expect(page.locator('#date')).toHaveValue('2026-11-12');
    await expect(applyDate).toBeVisible();

    await signature.getByRole('button', { name: 'Apply first name initial formatting fix' }).click();
    await expect(page.locator('#sigFirst')).toHaveValue('J.');
    await expect(page.locator('#sigMiddle')).toHaveValue(' R . ');
    await signature.getByRole('button', { name: 'Apply middle initial formatting fix' }).click();
    await undo();
    await expect(page.locator('#sigFirst')).toHaveValue('J.');
    await expect(page.locator('#sigMiddle')).toHaveValue(' R . ');
    await undo();
    await expect(page.locator('#sigFirst')).toHaveValue(' J . ');
    await expect(page.locator('#body-subject')).toHaveValue('FORMATTING REVIEW');

    // The suggestion layer must leave an imported ambiguous date for review.
    draft.formData.date = '03/04/2026';
    await page.getByLabel('Import draft file').setInputFiles({ name: 'ambiguous.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    await expect(addressing.getByText('Date: review date')).toBeVisible();
    await expect(applyDate).toHaveCount(0);
    await expect(page.locator('#date')).toHaveValue('03/04/2026');
  });
}
