import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);

test('reviews reference order, preserves targets through Undo, reload and PDF export', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: 'light', editorLayout: 'scroll' }, version: 1 }));
  });
  await page.goto('/');
  const draft = {
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter', formType: 'navmc_10274',
    formData: { subject: 'REFERENCE TARGET CHECK', from: 'Commanding Officer', to: 'Training Officer', date: '13 Nov 26', sigLast: 'DOE', via: 'Office w/ref (b)' },
    paragraphs: [{ text: 'Follow reference (b), then reference (a).', level: 0 }],
    references: [{ letter: 'a', title: 'Alpha directive', url: 'https://example.com/alpha' }, { letter: 'b', title: 'Bravo directive', url: 'https://example.com/bravo' }],
    enclosures: [], copyTos: [{ text: 'Office w/ref (b)' }], distributions: [],
  };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'reference-check.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  const review = page.getByRole('button', { name: 'Review first-citation order' });
  await review.click();
  const preview = page.getByRole('dialog', { name: 'Review reference changes' });
  await expect(preview.getByText('Follow reference (a), then reference (b).')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Paragraph 1', exact: true, includeHidden: true })).toHaveText('Follow reference (b), then reference (a).');
  await page.screenshot({ path: testInfo.outputPath('reference-preview.png'), fullPage: false });
  await preview.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Paragraph 1', exact: true })).toHaveText('Follow reference (a), then reference (b).');
  await expect(page.getByLabel('Reference (a) title', { exact: true })).toHaveValue('Bravo directive');
  await expect(page.getByLabel('Reference (a) URL', { exact: true })).toHaveValue('https://example.com/bravo');
  await page.getByRole('button', { name: 'Document tools', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Undo/ }).click();
  await expect(page.getByRole('textbox', { name: 'Paragraph 1', exact: true })).toHaveText('Follow reference (b), then reference (a).');
  await expect(page.getByLabel('Reference (a) title', { exact: true })).toHaveValue('Alpha directive');
  const drag = page.getByRole('button', { name: 'Drag to reorder reference 2', exact: true });
  await drag.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Space');
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: 'Apply changes', exact: true }).click();
  // A real edit after the correction must survive the normal save/reload path.
  await page.getByRole('textbox', { name: 'Paragraph 1', exact: true }).fill('Follow reference (a), then reference (b). Keep this later edit.');
  await page.waitForTimeout(1100);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Paragraph 1', exact: true })).toHaveText('Follow reference (a), then reference (b). Keep this later edit.');
  await page.getByRole('button', { name: 'Remove reference 1', exact: true }).click();
  await expect(preview.getByRole('alert')).toContainText('is still cited');
  await expect(preview.getByRole('button', { name: 'Apply changes', exact: true })).toHaveCount(0);
  await preview.getByRole('button', { name: 'Close', exact: true }).first().click();
  // Compile the preview from the saved revision, then inspect the downloaded PDF.
  const showPreview = page.getByRole('button', { name: 'Preview', exact: true });
  let exportPdf: () => Promise<void>;
  if (await showPreview.getAttribute('aria-haspopup') === 'dialog') {
    await showPreview.click();
    const modal = page.getByRole('dialog', { name: 'PDF preview', exact: true });
    const download = modal.getByRole('button', { name: 'Download', exact: true });
    await expect(download).toBeVisible({ timeout: 60_000 });
    exportPdf = () => download.click();
  } else {
    if (await showPreview.getAttribute('aria-pressed') !== 'true') await showPreview.click();
    await expect(page.locator('.workspace-preview [title="Document preview"]').first()).toBeAttached({ timeout: 60_000 });
    exportPdf = async () => {
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      await page.getByRole('menuitem', { name: /^Download PDF(?:\s|$)/ }).click();
    };
  }
  const downloading = page.waitForEvent('download');
  await exportPdf();
  const download = await downloading;
  const pdf = await getDocument({ data: new Uint8Array(await readFile((await download.path())!)), useSystemFonts: false }).promise;
  try {
    const pages: string[] = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const content = await (await pdf.getPage(index)).getTextContent();
      pages.push(content.items.map(item => 'str' in item ? item.str : '').join(' '));
    }
    const text = pages.join(' ').replace(/\s+/g, ' ');
    expect(text).toContain('Follow reference (a), then reference (b). Keep this later edit.');
    expect(text.indexOf('Bravo directive')).toBeLessThan(text.indexOf('Alpha directive'));
    expect(text).toContain('Office w/ref (a)');
  } finally { await pdf.destroy(); }
});
