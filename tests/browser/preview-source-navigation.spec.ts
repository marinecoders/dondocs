import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { downloadBrowserPdf } from '../_helpers/downloadBrowserPdf';

async function inspectPdf(bytes: Uint8Array) {
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  try {
    const first = await pdf.getPage(1);
    return {
      text: (await first.getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' '),
      annotations: await first.getAnnotations(),
    };
  } finally {
    await pdf.destroy();
  }
}

async function readPreviewText(page: Page) {
  const bytes = await page.evaluate(async () => {
    const blob = (window as Window & { latestPreview?: Blob }).latestPreview;
    return blob ? Array.from(new Uint8Array(await blob.arrayBuffer())) : [];
  });
  return bytes.length ? (await inspectPdf(new Uint8Array(bytes))).text : '';
}

const previewUpdateTimeout = 15_000;

async function openPreviewDraft(page: Page, docType: string, documentMode: 'compliant' | 'custom') {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    if (!localStorage.getItem('dondocs_ui')) {
      localStorage.setItem('dondocs_ui', JSON.stringify({ state: { editorLayout: 'scroll' }, version: 1 }));
    }
    const create = URL.createObjectURL;
    URL.createObjectURL = object => {
      if (object instanceof Blob && object.type === 'application/pdf') {
        (window as Window & { latestPreview?: Blob }).latestPreview = object;
      }
      return create.call(URL, object);
    };
  });
  await page.goto('/');
  await page.getByLabel('Import draft file').setInputFiles({
    name: 'preview-format.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      docType, documentMode, documentCategory: 'correspondence', formData: {},
      paragraphs: [{ level: 0, text: '' }], references: [], enclosures: [], copyTos: [], distributions: [],
    })),
  });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
}

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

test('starter examples disappear by edited category and exports only contain entered values', async ({ page, isMobile }, info) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    if (!localStorage.getItem('dondocs_ui')) {
      localStorage.setItem('dondocs_ui', JSON.stringify({ state: { editorLayout: 'scroll' }, version: 1 }));
    }
    const create = URL.createObjectURL;
    URL.createObjectURL = (object) => {
      if (object instanceof Blob && object.type === 'application/pdf') {
        (window as Window & { latestPreview?: Blob }).latestPreview = object;
      }
      return create.call(URL, object);
    };
  });
  await page.goto('/');
  const subject = page.getByRole('textbox', { name: 'Subject', exact: true });
  const recipient = page.getByRole('textbox', { name: 'To', exact: true });
  const lastName = page.getByRole('textbox', { name: 'Last Name', exact: true });
  const body = page.getByRole('textbox', { name: 'Paragraph 1', exact: true });
  await expect(subject).toHaveValue('');
  await expect(recipient).toHaveValue('');
  await expect(lastName).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'From', exact: true })).toHaveValue('');
  await expect(body).toHaveText('');

  const toggle = page.getByRole('button', { name: 'Preview', exact: true });
  const openPreview = async () => {
    if (isMobile || await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
  };
  const closeMobilePreview = async () => {
    if (isMobile) await page.getByRole('button', { name: 'Close preview', exact: true }).click();
  };
  const readPreview = () => readPreviewText(page);
  await openPreview();
  const activePdf = page.locator('[data-pdf-layer="active"]');
  const toHint = activePdf.getByRole('button', { name: 'Edit To', exact: true });
  const addressExamples = /MARINE FORCES RESERVE|MCDONALD STREET|NEWBURGH/;
  const senderExample = 'Ser S-3/0123';
  const copyExamples = 'G-3/5 G-4 Regimental S-3';
  await expect(toHint).toBeVisible({ timeout: 90_000 });
  expect(await readPreview()).toContain('[RECIPIENT]');
  expect(await readPreview()).toContain('Marine Innovation Unit');
  expect(await readPreview()).toContain('MARINE FORCES RESERVE');
  expect(await readPreview()).toContain('10 MCDONALD STREET');
  expect(await readPreview()).toContain('NEWBURGH, NY 12550');
  expect(await readPreview()).toContain(senderExample);
  expect(await readPreview()).toContain(copyExamples);
  await toHint.click();
  await expect(recipient).toBeFocused();
  await expect(recipient).toHaveValue('');

  await recipient.fill('Training Office');
  await openPreview();
  await expect.poll(readPreview, { timeout: previewUpdateTimeout }).toContain('Training Office');
  const writing = await readPreview();
  expect(writing).toMatch(addressExamples);
  expect(writing).toContain(senderExample);
  expect(writing).toContain(copyExamples);
  expect(writing).toContain('[SUBJECT]');
  await closeMobilePreview();

  // Date is still in the input buffer. Desktop can inspect the PDF without
  // blurring it and committing the value to the draft.
  if (!isMobile) {
    const date = page.getByRole('textbox', { name: 'Date', exact: true });
    await date.fill('2');
    await expect(date).toBeFocused();
    await expect.poll(readPreview, { timeout: previewUpdateTimeout }).not.toContain(senderExample);
    await expect(date).toBeFocused();
    expect(await readPreview()).toContain('5216');
    expect(await readPreview()).toMatch(addressExamples);
    expect(await readPreview()).toContain(copyExamples);
    await date.clear();
  }

  const serial = page.locator('#serial');
  await serial.fill('044');
  await openPreview();
  await expect.poll(readPreview, { timeout: previewUpdateTimeout }).toContain('Ser 044');
  const withSerial = await readPreview();
  expect(withSerial).toContain('5216');
  expect(withSerial).not.toContain(senderExample);
  expect(withSerial).toMatch(addressExamples);
  expect(withSerial).toContain(copyExamples);
  await closeMobilePreview();
  await serial.clear();

  // The first state letter is not yet a valid state code and is omitted
  // from the saved address. It still counts as editing the letterhead.
  const state = page.locator('#addressState');
  await state.fill('V');
  await openPreview();
  await expect.poll(readPreview, { timeout: previewUpdateTimeout }).not.toMatch(addressExamples);
  expect(await readPreview()).toContain('MARINE INNOVATION UNIT');
  expect(await readPreview()).toContain(copyExamples);
  await closeMobilePreview();
  await state.clear();

  const street = page.locator('#addressStreet');
  await street.fill('52 MAIN STREET');
  await openPreview();
  await expect.poll(readPreview, { timeout: previewUpdateTimeout }).toContain('52 MAIN STREET');
  const withStreet = await readPreview();
  expect(withStreet).toContain('MARINE INNOVATION UNIT');
  expect(withStreet).not.toMatch(addressExamples);
  expect(withStreet).not.toContain(senderExample);
  expect(withStreet).toContain(copyExamples);
  await closeMobilePreview();
  await street.clear();
  await recipient.fill('');
  await openPreview();
  await expect.poll(readPreview, { timeout: previewUpdateTimeout }).toContain('[RECIPIENT]');
  expect(await readPreview()).not.toMatch(addressExamples);
  expect(await readPreview()).not.toContain(senderExample);
  await closeMobilePreview();

  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Save checkpoint/ }).click();
  await expect(page.getByText('Checkpoint saved in this browser', { exact: true })).toBeVisible();
  await page.reload();
  await openPreview();
  await expect(toHint).toBeVisible({ timeout: 90_000 });
  const reopened = await readPreview();
  expect(reopened).not.toMatch(addressExamples);
  expect(reopened).not.toContain(senderExample);
  expect(reopened).toContain(copyExamples);
  await closeMobilePreview();

  await recipient.fill('Training Office');
  await subject.fill('REAL TRAINING SUBJECT');
  await body.fill('This training paragraph remains in the exported document.');
  await openPreview();
  const more = page.getByRole('button', { name: 'More preview actions', exact: true });
  const showExamples = page.getByRole('menuitemcheckbox', { name: 'Show starter examples', exact: true });
  const copyHint = activePdf.getByRole('button', { name: 'Edit Copy-to recipient 1', exact: true });
  await expect(copyHint).toBeVisible();
  await copyHint.click();
  const addRecipient = page.getByRole('button', { name: 'Add recipient', exact: true });
  await expect(addRecipient).toBeFocused();
  await addRecipient.click();
  const copyTo = page.getByRole('textbox', { name: 'Copy-to recipient 1', exact: true });
  await expect(copyTo).toHaveValue('');
  await copyTo.fill('Records Team');
  await openPreview();
  const signer = activePdf.getByRole('button', { name: 'Edit Signer’s last name', exact: true });
  await expect(signer).toBeVisible();
  await expect.poll(readPreview, { timeout: previewUpdateTimeout }).toContain('Records Team');
  const latest = await readPreview();
  expect(latest).not.toContain('[RECIPIENT]');
  expect(latest).toContain('J. A. DOE');
  expect(latest).toContain('Copy to: Records Team');
  expect(latest).not.toContain('G-3/5');
  await expect(toHint).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open in browser tab', exact: true })).toHaveCount(0);
  await closeMobilePreview();
  const firstName = page.getByRole('textbox', { name: 'First Name', exact: true });
  await firstName.fill('Sam');
  await openPreview();
  await expect.poll(readPreview, { timeout: previewUpdateTimeout }).toContain('S. DOE');
  expect(await readPreview()).not.toContain('S. A. DOE');
  await expect(signer).toBeVisible();
  await closeMobilePreview();
  await firstName.clear();
  await copyTo.fill('');
  await openPreview();
  await expect.poll(readPreview, { timeout: previewUpdateTimeout }).not.toContain('Records Team');
  const cleared = await readPreview();
  expect(cleared).not.toContain('Copy to:');
  expect(cleared).not.toContain(copyExamples);
  await closeMobilePreview();
  await copyTo.fill('Records Team');
  await openPreview();
  await more.click();
  await expect(showExamples).not.toBeChecked();
  await showExamples.click();
  await expect.poll(readPreview, { timeout: previewUpdateTimeout }).toContain('MARINE FORCES RESERVE');
  expect(await readPreview()).not.toContain('G-3/5');
  await closeMobilePreview();
  await serial.fill('045');
  await openPreview();
  await expect.poll(readPreview, { timeout: previewUpdateTimeout }).toContain('Ser 045');
  expect(await readPreview()).toMatch(addressExamples);
  expect(await readPreview()).not.toContain(senderExample);
  await closeMobilePreview();

  const openDownload = () => page.getByRole('button', { name: 'Download', exact: true }).click();
  const noHints = /\bDOE\b|PreviewHint|dondocs\.invalid|\[RECIPIENT\]|Marine Innovation Unit|MARINE FORCES RESERVE|MCDONALD STREET|NEWBURGH|Regimental S-3|G-3\/5/i;
  await openDownload();
  const bytes = await downloadBrowserPdf(page, info.project.name, () => page.getByRole('menuitem', { name: /^Download PDF(?:\s|$)/ }).click());
  const downloaded = await inspectPdf(bytes);
  expect(downloaded.text).toContain('REAL TRAINING SUBJECT');
  expect(downloaded.text).toContain('Training Office');
  expect(downloaded.text).toContain('Records Team');
  expect(downloaded.text).not.toMatch(noHints);
  expect(downloaded.annotations).not.toContainEqual(expect.objectContaining({ url: expect.stringContaining('dondocs.invalid') }));

  await openDownload();
  const wordDownload = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true }).click();
  const word = await JSZip.loadAsync(await readFile((await (await wordDownload).path())!));
  const document = await word.file('word/document.xml')!.async('string');
  expect(document).toContain('REAL TRAINING SUBJECT');
  expect(document).not.toMatch(noHints);

  await openDownload();
  const texDownload = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download LaTeX', exact: true }).click();
  const tex = await readFile((await (await texDownload).path())!, 'utf8');
  expect(tex).toContain('REAL TRAINING SUBJECT');
  expect(tex).not.toMatch(noHints);

  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  const draftDownload = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export draft (.json)', exact: true }).click();
  const draft = await readFile((await (await draftDownload).path())!, 'utf8');
  expect(JSON.parse(draft).formData).toMatchObject({ to: 'Training Office', sigLast: '', from: '' });
  expect(draft).not.toMatch(noHints);

  // Tagged output requires actual From and Date values. Leave the signer and
  // letterhead empty to exercise export while the draft still has grey hints.
  await page.getByRole('textbox', { name: 'From', exact: true }).fill('Training Command');
  const date = page.getByRole('textbox', { name: 'Date', exact: true });
  await date.fill('23 Nov 26');
  await date.press('Tab');
  await openDownload();
  await page.getByRole('menuitem', { name: 'Tagged PDF (experimental)', exact: true }).click();
  const tagged = page.getByRole('dialog', { name: 'Export tagged PDF', exact: true });
  const exportTagged = tagged.getByRole('button', { name: 'Export tagged PDF', exact: true });
  await expect(exportTagged).toBeEnabled();
  const taggedBytes = await downloadBrowserPdf(page, info.project.name, () => exportTagged.click());
  const taggedOutput = await inspectPdf(taggedBytes);
  expect(taggedOutput.text).toContain('REAL TRAINING SUBJECT');
  expect(taggedOutput.text).not.toMatch(noHints);
  expect(taggedOutput.annotations).not.toContainEqual(expect.objectContaining({ url: expect.stringContaining('dondocs.invalid') }));
});

test('starter examples follow category controls and stay scoped to their draft', async ({ page, isMobile }, info) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    if (!localStorage.getItem('dondocs_ui')) {
      localStorage.setItem('dondocs_ui', JSON.stringify({ state: { editorLayout: 'scroll' }, version: 1 }));
    }
    const create = URL.createObjectURL;
    URL.createObjectURL = object => {
      if (object instanceof Blob && object.type === 'application/pdf') {
        (window as Window & { latestPreview?: Blob }).latestPreview = object;
      }
      return create.call(URL, object);
    };
  });
  await page.goto('/');
  const readPreview = () => readPreviewText(page);
  const toggle = page.getByRole('button', { name: 'Preview', exact: true });
  const openPreview = async () => {
    if (isMobile || await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
  };
  const closePreview = async () => {
    if (isMobile) await page.getByRole('button', { name: 'Close preview', exact: true }).click();
  };
  const setExamples = async (checked: boolean) => {
    await page.getByRole('button', { name: 'More preview actions', exact: true }).click();
    const option = page.getByRole('menuitemcheckbox', { name: 'Show starter examples', exact: true });
    if (checked) await expect(option).not.toBeChecked();
    else await expect(option).toBeChecked();
    await option.click();
  };
  const openWorkspace = async () => {
    const workspace = page.getByRole('button', { name: 'Open workspace', exact: true });
    if (await workspace.isVisible()) await workspace.click();
  };
  const activePdf = page.locator('[data-pdf-layer="active"]');
  await openPreview();
  await expect(activePdf.getByRole('button', { name: 'Edit To', exact: true })).toBeVisible({ timeout: 90_000 });
  await expect.poll(readPreview, { timeout: previewUpdateTimeout }).toContain('MARINE FORCES RESERVE');
  await page.screenshot({ path: info.outputPath('starter-examples-fresh.png') });
  await closePreview();

  // A selector change counts even without entering any letterhead text.
  await page.locator('#letterhead-color').click();
  await page.getByRole('option', { name: 'Black', exact: true }).click();
  await openPreview();
  await expect.poll(readPreview, { timeout: previewUpdateTimeout }).not.toContain('MARINE FORCES RESERVE');
  expect(await readPreview()).toContain('MARINE INNOVATION UNIT');
  expect(await readPreview()).toContain('Ser S-3/0123');
  expect(await readPreview()).toContain('G-3/5');
  await closePreview();

  await page.getByRole('checkbox', { name: 'In reply refer to', exact: true }).check();
  await openPreview();
  await expect.poll(readPreview, { timeout: previewUpdateTimeout }).not.toContain('Ser S-3/0123');
  expect(await readPreview()).toContain('5216');
  expect(await readPreview()).toContain('G-3/5');
  await closePreview();

  await page.getByRole('button', { name: 'Add recipient', exact: true }).click();
  await page.getByRole('textbox', { name: 'Copy-to recipient 1', exact: true }).fill('Records Team');
  await openPreview();
  await expect.poll(readPreview, { timeout: previewUpdateTimeout }).toContain('Records Team');
  await closePreview();
  await page.getByRole('button', { name: 'Remove copy-to recipient 1', exact: true }).click();
  await openPreview();
  await expect.poll(readPreview, { timeout: previewUpdateTimeout }).not.toContain('Copy to:');
  await closePreview();

  const subject = page.getByRole('textbox', { name: 'Subject', exact: true });
  await subject.fill('CATEGORY CONTROL DRAFT');
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Save checkpoint/ }).click();
  await expect(page.getByText('Checkpoint saved in this browser', { exact: true })).toBeVisible();
  await openPreview();
  await setExamples(true);
  await expect.poll(readPreview, { timeout: previewUpdateTimeout }).toContain('MARINE FORCES RESERVE');
  expect(await readPreview()).toContain('Ser S-3/0123');
  expect(await readPreview()).toContain('G-3/5');
  await setExamples(false);
  await expect.poll(readPreview, { timeout: previewUpdateTimeout }).not.toContain('G-3/5');
  expect(await readPreview()).not.toContain('MARINE FORCES RESERVE');
  expect(await readPreview()).not.toContain('Ser S-3/0123');
  expect(await readPreview()).toContain('[RECIPIENT]');
  expect(await readPreview()).toContain('CATEGORY CONTROL DRAFT');
  await setExamples(true);
  await expect.poll(readPreview, { timeout: previewUpdateTimeout }).toContain('G-3/5');
  await closePreview();

  await openWorkspace();
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New correspondence', exact: true }).click();
  await expect(subject).toHaveValue('');
  await openPreview();
  await expect.poll(readPreview, { timeout: previewUpdateTimeout }).toContain('[SUBJECT]');
  expect(await readPreview()).toContain('MARINE FORCES RESERVE');
  expect(await readPreview()).toContain('Ser S-3/0123');
  expect(await readPreview()).toContain('G-3/5');
  await closePreview();

  await openWorkspace();
  await page.getByRole('button', { name: /^CATEGORY CONTROL DRAFT/ }).first().click();
  await expect(subject).toHaveValue('CATEGORY CONTROL DRAFT');
  await openPreview();
  await expect.poll(readPreview, { timeout: previewUpdateTimeout }).toContain('CATEGORY CONTROL DRAFT');
  expect(await readPreview()).not.toContain('MARINE FORCES RESERVE');
  expect(await readPreview()).not.toContain('Ser S-3/0123');
  expect(await readPreview()).not.toContain('Copy to:');
  await page.screenshot({ path: info.outputPath('starter-examples-reopened.png') });
  await closePreview();
  await page.reload();
  await openPreview();
  await expect(activePdf.getByRole('button', { name: 'Edit To', exact: true })).toBeVisible({ timeout: 90_000 });
  expect(await readPreview()).not.toContain('MARINE FORCES RESERVE');
  expect(await readPreview()).not.toContain('Ser S-3/0123');
  expect(await readPreview()).not.toContain('Copy to:');
});

test('starter examples in a custom business letter clear by category and link to editable fields', async ({ page, isMobile }) => {
  test.setTimeout(90_000);
  await openPreviewDraft(page, 'business_letter', 'custom');
  const toggle = page.getByRole('button', { name: 'Preview', exact: true });
  const open = async () => { if (isMobile || await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click(); };
  const close = async () => { if (isMobile) await page.getByRole('button', { name: 'Close preview', exact: true }).click(); };
  const poll = () => expect.poll(() => readPreviewText(page), { timeout: previewUpdateTimeout });
  const active = page.locator('[data-pdf-layer="active"]');
  await open();
  const subjectHint = active.getByRole('button', { name: 'Edit Subject', exact: true });
  await expect(subjectHint).toBeVisible({ timeout: 60_000 });
  await subjectHint.click();
  await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toBeFocused();
  const salutation = page.getByRole('textbox', { name: 'Salutation', exact: true });
  await salutation.fill('Dear Training Team:');
  await open();
  await poll().toContain('Dear Training Team:');
  expect(await readPreviewText(page)).not.toContain('[SUBJECT]');
  expect(await readPreviewText(page)).toContain('[RECIPIENT]');
  expect(await readPreviewText(page)).toContain('Sincerely,');
  expect(await readPreviewText(page)).toContain('G-3/5');

  const closingHint = active.getByRole('button', { name: 'Edit Complimentary close', exact: true });
  await closingHint.click();
  const closing = page.getByRole('textbox', { name: 'Complimentary Close', exact: true });
  await expect(closing).toBeFocused();
  await page.getByRole('textbox', { name: 'First Name', exact: true }).fill('Sam');
  await open();
  await poll().not.toContain('Sincerely,');
  expect(await readPreviewText(page)).toContain('DOE');
  expect(await readPreviewText(page)).toContain('Dear Training Team:');
  expect(await readPreviewText(page)).toContain('G-3/5');
  await close();
});

test('starter examples recognize Distribution as the recipient in a Multiple Address Letter', async ({ page, isMobile }) => {
  test.setTimeout(90_000);
  await openPreviewDraft(page, 'multiple_address_letter', 'compliant');
  const toggle = page.getByRole('button', { name: 'Preview', exact: true });
  const open = async () => { if (isMobile || await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click(); };
  const close = async () => { if (isMobile) await page.getByRole('button', { name: 'Close preview', exact: true }).click(); };
  const poll = () => expect.poll(() => readPreviewText(page), { timeout: previewUpdateTimeout });
  await open();
  const toHint = page.locator('[data-pdf-layer="active"]').getByRole('button', { name: 'Edit To', exact: true });
  await expect(toHint).toBeVisible({ timeout: 60_000 });
  await close();
  await page.getByRole('button', { name: 'Add action addressee', exact: true }).click();
  const addressee = page.getByRole('textbox', { name: 'Action addressee 1', exact: true });
  await addressee.fill('Training Command');
  await open();
  await poll().toContain('Distribution: Training Command');
  expect(await readPreviewText(page)).not.toContain('[RECIPIENT]');
  expect(await readPreviewText(page)).toContain('[SUBJECT]');
  expect(await readPreviewText(page)).toContain('G-3/5');
  await close();
  await addressee.clear();
  await open();
  await poll().toContain('[RECIPIENT]');
  expect(await readPreviewText(page)).not.toContain('Distribution:');
  await expect(toHint).toBeVisible();
});

test('starter examples remember cleared edits after another tab saves UI settings', async ({ page, context, isMobile }) => {
  test.skip(!!isMobile, 'The desktop preview toggle writes preferences.');
  test.setTimeout(90_000);
  await openPreviewDraft(page, 'naval_letter', 'compliant');
  const other = await context.newPage();
  try {
    await other.goto('/');
    const otherPreview = other.getByRole('button', { name: 'Preview', exact: true });
    await expect(otherPreview).toBeEnabled();

    const serial = page.locator('#serial');
    await serial.fill('044');
    await serial.clear();
    await page.getByRole('button', { name: 'Document actions', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Save checkpoint/ }).click();
    await expect(page.getByText('Checkpoint saved in this browser', { exact: true })).toBeVisible();
    await otherPreview.click();

    await page.reload();
    const preview = page.getByRole('button', { name: 'Preview', exact: true });
    if (await preview.getAttribute('aria-pressed') !== 'true') await preview.click();
    await expect(page.locator('[data-pdf-layer="active"]').getByRole('button', { name: 'Edit To', exact: true })).toBeVisible({ timeout: 60_000 });
    const text = await readPreviewText(page);
    expect(text).not.toContain('Ser S-3/0123');
    expect(text).toContain('5216');
    expect(text).toContain('G-3/5');
  } finally {
    await other.close();
  }
});
