import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

for (const theme of ['light', 'dark', 'classic']) {
  test(`reviews type-aware findings and clears personal checks in ${theme}`, async ({ page }, testInfo) => {
    await page.addInitScript(theme => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme, editorLayout: 'focused' }, version: 1 }));
    }, theme);
    await page.goto('/');
    const draft = {
      documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter', formType: 'navmc_10274',
      formData: { date: '19 Nov 26', subject: 'SYNTHETIC PROOFREAD.' },
      paragraphs: [{ text: 'See enclosure (2) for the fictional supporting document.', level: 0 }],
      references: [], enclosures: [], copyTos: [], distributions: [],
    };
    const importDraft = async (name: string) => {
      await page.getByLabel('Import draft file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
      await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Review draft', exact: true })).toBeHidden();
    };
    await importDraft('proofread-synthetic.json');
    const proofread = page.getByRole('button', { name: /^Proofread: \d+ findings?$/ });
    await proofread.click();
    const dialog = page.getByRole('dialog', { name: 'Proofread', exact: true });
    await expect(dialog.getByText('Review subject punctuation', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Check enclosure (2)', { exact: true })).toHaveCount(1);
    const firstCheck = dialog.getByRole('checkbox', { name: 'Inspect the letterhead and its alignment.' });
    await firstCheck.check();
    await expect(dialog.getByText('1 of 15 personal checks completed')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`proofread-${theme}.png`), fullPage: true });
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await proofread.click();
    await expect(firstCheck).toBeChecked();
    const subjectFinding = dialog.getByRole('listitem').filter({ has: page.getByText('Review subject punctuation', { exact: true }) });
    await subjectFinding.getByRole('button', { name: /^Go to/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('#subject')).toBeFocused();
    await page.locator('#subject').fill('SYNTHETIC PROOFREAD');
    await proofread.click();
    await expect(dialog.getByText('Review subject punctuation', { exact: true })).toHaveCount(0);
    await expect(firstCheck).not.toBeChecked();
    await firstCheck.check();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();

    // Importing the same content as another document must not carry confirmations.
    await importDraft('another-proofread-synthetic.json');
    await proofread.click();
    await expect(firstCheck).not.toBeChecked();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
}

test('opens the CUI contact field in a format without a Signature section', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { editorLayout: 'focused', previewVisible: false }, version: 1 }));
  });
  await page.goto('/');
  const draft = {
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'joint_letter', formType: 'navmc_10274',
    formData: { date: '19 Nov 26', jointJuniorDate: '19 Nov 26', jointSubject: 'SYNTHETIC CONTACT CHECK',
      classLevel: 'cui', cuiControlledBy: 'Synthetic training office', cuiCategory: 'PRVCY' },
    paragraphs: [{ text: 'Fictional test content.', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [],
  };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'fictional-cui-contact.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  const proofread = page.getByRole('button', { name: /^Proofread: \d+ findings?$/ });
  await proofread.click();
  const dialog = page.getByRole('dialog', { name: 'Proofread', exact: true });
  const finding = dialog.getByRole('listitem').filter({ has: page.getByText('POC email is empty', { exact: true }) });
  await finding.getByRole('button', { name: 'Go to Classification', exact: true }).click();
  await expect(page.locator('#cuiPocEmail')).toBeFocused();
  await page.locator('#cuiPocEmail').fill('training-office@example.test');
  await proofread.click();
  await expect(dialog.getByText('POC email is empty', { exact: true })).toHaveCount(0);
});
