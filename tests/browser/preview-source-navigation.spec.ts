import { test, expect } from '@playwright/test';
test.use({ serviceWorkers: 'block' });
test('rendered paragraph links focus the matching live editor', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'Desktop toolbar navigation has its own test.');
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('PREVIEW SOURCE TEST');
  const paragraph = page.getByRole('textbox', { name: 'Paragraph 1', exact: true });
  await paragraph.fill('This unique paragraph verifies navigation from the rendered PDF to the live editor.');
  const toggle = page.getByRole('button', { name: 'Preview', exact: true });
  if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
  const source = page.getByText('Edit page 1 source', { exact: true });
  await expect(source).toBeVisible({ timeout: 90_000 });
  await source.click();
  await page.getByRole('button', { name: 'Subject', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Paragraph 1', exact: true }).click();
  await expect(paragraph).toBeFocused();
  await expect(paragraph).toHaveText('This unique paragraph verifies navigation from the rendered PDF to the live editor.');
});

for (const theme of ['light', 'dark', 'classic']) {
  test(`mobile source links close the preview and focus the editor in ${theme}`, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile handoff uses the modal preview.');
    test.setTimeout(120_000);
    await page.addInitScript(theme => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme, editorLayout: 'scroll' }, version: 1 }));
    }, theme);
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('MOBILE PREVIEW SOURCE TEST');
    const paragraph = page.getByRole('textbox', { name: 'Paragraph 1', exact: true });
    await paragraph.fill('This uniquely worded mobile paragraph tests returning from the rendered PDF to its editor.');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'PDF preview', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByText('Edit page 1 source', { exact: true }).click({ timeout: 90_000 });
    await dialog.getByRole('button', { name: 'Paragraph 1', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(paragraph).toBeFocused();
    await expect(paragraph).toHaveText('This uniquely worded mobile paragraph tests returning from the rendered PDF to its editor.');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'PDF preview', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });
}

test('links a complete long paragraph from its continuation page', async ({ page, isMobile }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: 'light', editorLayout: 'scroll' }, version: 1 }));
  });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('CROSS PAGE SOURCE');
  const paragraph = page.getByRole('textbox', { name: 'Paragraph 1', exact: true });
  const text = Array.from({ length: 80 }, (_, index) => `Sourceword${index} provides clear unique training directions for the next exercise.`).join(' ');
  await paragraph.fill(text);
  const preview = page.getByRole('button', { name: 'Preview', exact: true });
  if (isMobile || await preview.getAttribute('aria-pressed') !== 'true') await preview.click();
  await expect(page.getByText('Edit page 1 source', { exact: true })).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await page.getByText('Edit page 2 source', { exact: true }).click();
  await page.getByRole('button', { name: 'Paragraph 1', exact: true }).click();
  await expect(paragraph).toBeFocused();
  await expect(paragraph).toHaveText(text);
});

test('editor following reveals the selected paragraph and respects manual PDF navigation', async ({ page, isMobile }, testInfo) => {
  test.skip(!!isMobile, 'Editor and PDF must be visible side by side.');
  test.setTimeout(150_000);
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { editorLayout: 'scroll' }, version: 1 }));
  });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('EDITOR FOLLOW TEST');
  await page.getByRole('textbox', { name: 'Paragraph 1', exact: true }).fill(Array.from({ length: 80 }, (_, index) => `Sourceword${index} provides clear unique training directions for the next exercise.`).join(' '));
  await page.getByRole('button', { name: 'Add paragraph', exact: true }).click();
  const second = page.getByRole('textbox', { name: 'Paragraph 2', exact: true });
  await second.fill('This final uniquely worded paragraph is deliberately selected to reveal its later PDF page.');
  const preview = page.getByRole('button', { name: 'Preview', exact: true });
  if (await preview.getAttribute('aria-pressed') !== 'true') await preview.click();
  await expect(page.getByText('Edit page 1 source', { exact: true })).toBeVisible({ timeout: 90_000 });
  await page.getByRole('combobox', { name: 'Preview following', exact: true }).selectOption('editor');
  await second.click();
  const pageNumber = page.getByRole('textbox', { name: 'Page number', exact: true });
  await expect(pageNumber).not.toHaveValue('1');
  await expect(second).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('editor-follow.png') });
  await page.locator('[data-pdf-layer="active"]').hover();
  await page.mouse.wheel(0, -5000);
  await expect(pageNumber).toHaveValue('1');
  await expect(second).toBeFocused();
  await second.press('End');
  await second.press('ArrowLeft');
  await expect(pageNumber).toHaveValue('1');
  await second.click();
  await expect(pageNumber).not.toHaveValue('1');
  await expect(second).toBeFocused();
});

test('large documents explain the source-navigation limit while keeping PDF delivery available', async ({ page, isMobile }) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { editorLayout: 'scroll', previewVisible: true }, version: 1 }));
  });
  await page.goto('/');
  const draft = { docType: 'naval_letter', documentCategory: 'correspondence', documentMode: 'custom',
    formData: { subject: 'PREVIEW LIMIT TEST', from: 'Training Sender', to: 'Training Recipient', unitLine1: 'TRAINING COMMAND', sigLast: 'EXAMPLE', signatureType: 'none' },
    paragraphs: Array.from({ length: 513 }, (_, index) => ({ id: `budget-${index}`, level: 0,
      text: `Unique source paragraph ${index + 1} provides synthetic training instructions for this exercise.` })),
    references: [], enclosures: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'large-source-test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  if (isMobile) await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByText('Source navigation is unavailable for this large document.', { exact: true })).toBeVisible({ timeout: 100_000 });
  await expect(page.getByLabel('Preview following', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
});
