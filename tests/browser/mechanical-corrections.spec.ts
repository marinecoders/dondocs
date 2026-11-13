import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);

test('reviews selected body dates and NOTAL markers with Undo, reload and real PDF export', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: 'light', editorLayout: 'scroll' }, version: 1 }));
  });
  await page.goto('/');
  const original = 'Report 05 Nov 2026; return 06 Dec 2026. Keep "07 Nov 2026" and 05/06/2026 unchanged.';
  const corrected = 'Report 5 November 2026; return 6 December 2026. Keep "07 Nov 2026" and 05/06/2026 unchanged.';
  const draft = {
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter', formType: 'navmc_10274',
    formData: { subject: 'MECHANICAL REVIEW', from: 'Commanding Officer', to: 'Training Officer', date: '13 Nov 26', sigLast: 'DOE' },
    paragraphs: [{ text: original, level: 0 }, { text: 'Review 6 Dec 26 manually. Established 10 Nov 1775.', level: 0 }],
    references: [{ letter: 'a', title: 'Alpha instruction ( notal )', url: 'https://example.com/alpha' }], enclosures: [], copyTos: [], distributions: [],
  };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'mechanical.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  const body = page.locator('#sec-body');
  const audience = body.getByRole('combobox', { name: 'Body date audience' });
  const reviewBody = body.getByRole('button', { name: 'Review body date formatting' });
  await expect(reviewBody).toBeDisabled();
  await audience.click();
  await page.getByRole('option', { name: 'Military — 5 November 2026', exact: true }).click();
  await reviewBody.click();
  const preview = page.getByRole('dialog', { name: 'Review formatting corrections' });
  await expect(preview.getByText('Paragraph 2, date 1: manual review')).toBeVisible();
  await preview.getByRole('checkbox', { name: 'Paragraph 1, date 2', exact: true }).uncheck();
  await preview.getByRole('checkbox', { name: 'Paragraph 2, date 2', exact: true }).uncheck();
  await page.screenshot({ path: testInfo.outputPath('body-correction-preview.png') });
  await preview.getByRole('button', { name: 'Apply 1 correction', exact: true }).click();
  const paragraph = page.getByRole('textbox', { name: 'Paragraph 1', exact: true });
  await expect(paragraph).toHaveText(original.replace('05 Nov 2026', '5 November 2026'));
  const history = async (direction: 'Undo' | 'Redo') => {
    await page.getByRole('button', { name: 'Document tools', exact: true }).click();
    await page.getByRole('menuitem', { name: new RegExp(`^${direction}`) }).click();
  };
  await history('Undo');
  await expect(paragraph).toHaveText(original);
  await reviewBody.click();
  await preview.getByRole('button', { name: 'Apply 3 corrections', exact: true }).click();
  await expect(paragraph).toHaveText(corrected);
  await expect(page.getByRole('textbox', { name: 'Paragraph 2', exact: true })).toHaveText('Review 6 Dec 26 manually. Established 10 November 1775.');
  await page.getByRole('button', { name: 'Review NOTAL formatting', exact: true }).click();
  await expect(preview.getByText('“(NOTAL)”')).toBeVisible();
  await preview.getByRole('button', { name: 'Apply 1 correction', exact: true }).click();
  await expect(page.getByLabel('Reference (a) title', { exact: true })).toHaveValue('Alpha instruction (NOTAL)');
  await expect(page.getByLabel('Reference (a) URL', { exact: true })).toHaveValue('https://example.com/alpha');
  await history('Undo');
  await expect(page.getByLabel('Reference (a) title', { exact: true })).toHaveValue('Alpha instruction ( notal )');
  await expect(paragraph).toHaveText(corrected);
  await history('Redo');
  await page.waitForTimeout(1100);
  await page.reload();
  await expect(paragraph).toHaveText(corrected);
  await expect(audience).toHaveText('Choose the audience');
  await expect(page.getByLabel('Reference (a) title', { exact: true })).toHaveValue('Alpha instruction (NOTAL)');
  await expect(page.getByLabel('Reference (a) URL', { exact: true })).toHaveValue('https://example.com/alpha');
  const showPreview = page.getByRole('button', { name: 'Preview', exact: true });
  let exportPdf: () => Promise<void>;
  if (await showPreview.getAttribute('aria-haspopup') === 'dialog') {
    await showPreview.click();
    const download = page.getByRole('dialog', { name: 'PDF preview', exact: true }).getByRole('button', { name: 'Download', exact: true });
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
  await exportPdf();
  // The unchanged synthetic numeric date is flagged as a possible DOB. Keep
  // the normal content-review gate in this end-to-end correction workflow.
  const warning = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Potential PII/PHI Detected', exact: true }) });
  await expect(warning.getByRole('heading', { name: 'Date of Birth (1)', exact: true })).toBeVisible();
  const confirmExport = warning.getByRole('button', { name: 'Download Anyway', exact: true });
  if (testInfo.project.name === 'mobile-chrome-ios') {
    // Review releases the first reserved tab. Confirmation owns a fresh tab.
    const opening = page.waitForEvent('popup');
    await confirmExport.click();
    const popup = await opening;
    try {
      const frame = popup.locator('iframe');
      await expect(frame).toHaveAttribute('src', /^data:application\/pdf;base64,/, { timeout: 30_000 });
      await expectMechanicalPdf(Buffer.from((await frame.getAttribute('src'))!.split(',')[1], 'base64'));
      const saving = popup.waitForEvent('download');
      await popup.getByRole('link', { name: 'Download PDF', exact: true }).click();
      const download = await saving;
      expect(await download.failure()).toBeNull();
      await expectMechanicalPdf(await readFile((await download.path())!));
    } finally { await popup.close(); }
  } else {
    const saving = page.waitForEvent('download');
    await confirmExport.click();
    const download = await saving;
    expect(await download.failure()).toBeNull();
    await expectMechanicalPdf(await readFile((await download.path())!));
  }
});

async function expectMechanicalPdf(bytes: Uint8Array) {
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  try {
    const pages: string[] = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const content = await (await pdf.getPage(index)).getTextContent();
      pages.push(content.items.map(item => 'str' in item ? item.str : '').join(' '));
    }
    const text = pages.join(' ').replace(/\s+/g, ' ');
    for (const expected of ['Report 5 November 2026; return 6 December 2026.', 'Alpha instruction (NOTAL)', 'Review 6 Dec 26 manually.', 'Established 10 November 1775.']) expect(text).toContain(expected);
  } finally { await pdf.destroy(); }
}
