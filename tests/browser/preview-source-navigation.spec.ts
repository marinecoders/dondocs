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
  const source = page.getByRole('button', { name: 'Edit in draft', exact: true });
  await expect(source).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('[data-pdf-layer="active"]').getByRole('button', { name: 'Edit in draft' })).toHaveCount(0);
  await source.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Subject', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).not.toBeVisible();
  await expect(source).toBeFocused();
  await source.click();
  await page.getByRole('menuitem', { name: 'Subject', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toBeFocused();
  await source.click();
  await page.getByRole('menuitem', { name: 'Paragraph 1', exact: true }).click();
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
    const source = dialog.getByRole('button', { name: 'Edit in draft', exact: true });
    await source.click({ timeout: 90_000 });
    await expect(dialog.getByRole('menuitem', { name: 'Paragraph 1', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog.getByRole('menu')).not.toBeVisible();
    await expect(dialog).toBeVisible();
    await source.click();
    await dialog.getByRole('menuitem', { name: 'Paragraph 1', exact: true }).click();
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
  const source = page.getByRole('button', { name: 'Edit in draft', exact: true });
  await source.click({ timeout: 90_000 });
  await expect(page.getByText('On page 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Subject', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Page number', exact: true })).toHaveValue('2');
  await source.click();
  await expect(page.getByText('On page 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Subject', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Paragraph 1', exact: true }).click();
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
  await expect(page.getByRole('button', { name: 'Edit in draft', exact: true })).toBeVisible({ timeout: 90_000 });
  const follow = page.getByRole('button', { name: 'Follow', exact: true });
  if (await follow.isVisible()) {
    await follow.click();
  } else {
    await page.getByRole('button', { name: 'More preview actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Follow', exact: true }).press('ArrowRight');
  }
  await expect(page.getByRole('menuitemradio', { name: 'Off', exact: true })).toBeChecked();
  await page.getByRole('menuitemradio', { name: 'Preview follows editor', exact: true }).click();
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

test('keeps draft editing reachable as the preview toolbar narrows', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'The desktop preview has a resize divider.');
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({
      state: { previewWidth: 60, previewVisible: true, pdfZoomMode: { kind: 'manual', scale: 1.1 } },
      version: 1,
    }));
  });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('NARROW PREVIEW TOOLBAR');
  await page.getByRole('textbox', { name: 'Paragraph 1', exact: true }).fill(
    Array.from({ length: 80 }, (_, index) => `Sourceword${index} provides distinct training directions for the next exercise.`).join(' '),
  );
  const follow = page.getByRole('button', { name: 'Follow', exact: true });
  await follow.click({ timeout: 90_000 });
  await expect(page.getByRole('menuitemradio', { name: 'Off', exact: true })).toBeChecked();
  await page.keyboard.press('Escape');
  const divider = page.getByRole('separator', { name: /Resize preview panel/ });
  for (let step = 0; step < 8; step++) await divider.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', '20');
  await expect(follow).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'More preview actions', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Zoom in', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Follow', exact: true }).press('ArrowRight');
  await expect(page.getByRole('menuitemradio', { name: 'Off', exact: true })).toBeChecked();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1024, height: 1000 });
  const pageNumber = page.getByRole('textbox', { name: 'Page number', exact: true });
  await page.getByRole('button', { name: 'Edit in draft', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Subject', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toBeFocused();
  await expect(pageNumber).toHaveValue('1');
  await expect(page.getByRole('button', { name: 'Next page', exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'More preview actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Next page', exact: true }).click();
  await expect(pageNumber).toHaveValue('2');
  await page.getByRole('button', { name: 'Edit in draft', exact: true }).click();
  await expect(page.getByText('On page 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Paragraph 1', exact: true })).toBeVisible();
  await pageNumber.evaluate(input => {
    const layer = input.closest('.pdf-viewer')?.querySelector('[data-pdf-layer="active"]');
    layer?.scrollTo({ top: 0 });
  });
  await expect(pageNumber).toHaveValue('1');
  await expect(page.getByRole('menu')).not.toBeVisible();
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
  await page.getByRole('button', { name: 'Edit in draft', exact: true }).click({ timeout: 100_000 });
  await expect(page.getByText('Source navigation is unavailable for this large document.', { exact: true })).toBeVisible();
  await expect(page.getByRole('menu')).toHaveAccessibleDescription('Source navigation is unavailable for this large document.');
  await expect(page.getByRole('button', { name: 'Follow', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
});
