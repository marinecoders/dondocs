import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

test.use({ serviceWorkers: 'block' });
for (const theme of ['light', 'dark', 'classic']) {
  test(`letterhead choices preserve unit details and export the selected style in ${theme}`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.addInitScript(value => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: value, editorLayout: 'scroll' }, version: 1 }));
    }, theme);
    await page.goto('/');
    const draft = { documentCategory: 'correspondence', documentMode: 'custom', docType: 'naval_letter',
      formData: { subject: 'LETTERHEAD OUTPUT TEST', from: 'Training Sender', to: 'Training Recipient', date: '21 Nov 2026',
        unitLine1: 'COMMAND TITLE', unitLine2: 'RETAINED SECOND LINE', unitAddress: '123 RETAINED ADDRESS', sigLast: 'EXAMPLE', signatureType: 'none' },
      paragraphs: [{ text: 'This body remains visible when the letterhead style changes.', level: 0 }],
      references: [], enclosures: [], copyTos: [], distributions: [] };
    await page.getByLabel('Import draft file').setInputFiles({ name: 'letterhead.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    const style = page.getByLabel('Letterhead style', { exact: true });
    await style.click();
    await page.getByRole('option', { name: 'Title only', exact: true }).click();
    await expect(page.locator('#unitLine1')).toHaveValue('COMMAND TITLE');
    await expect(page.locator('#unitLine2')).toHaveCount(0);
    await style.click();
    await page.getByRole('option', { name: 'Preprinted stationery', exact: true }).click();
    await expect(page.getByText(/Print on your authorized preprinted stock/)).toBeVisible();
    await expect(page.locator('#unitLine1')).toHaveCount(0);
    if (info.project.name === 'chromium' && theme === 'light') {
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const downloading = page.waitForEvent('download');
      await page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true }).click();
      const download = await downloading;
      expect(await download.failure()).toBeNull();
      await download.saveAs(info.outputPath('preprinted.docx'));
      const zip = await JSZip.loadAsync(await readFile(info.outputPath('preprinted.docx')));
      const xml = await zip.file('word/document.xml')!.async('string');
      expect(xml).not.toContain('COMMAND TITLE');
      expect(xml).not.toContain('RETAINED');
      expect(xml).not.toContain('<w:drawing>');
      expect(xml).toContain('This body remains visible');
    }
    await style.click();
    await page.getByRole('option', { name: 'Full letterhead', exact: true }).click();
    await expect(page.locator('#unitLine2')).toHaveValue('RETAINED SECOND LINE');
    await expect(page.locator('#unitLine1')).toHaveValue('COMMAND TITLE');
    await page.screenshot({ path: info.outputPath(`${theme}-letterhead.png`), fullPage: true });
  });
}

for (const mode of ['preprinted', 'title-only']) {
  test(`${mode} Word export works when seal images cannot load`, async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ state: { editorLayout: 'scroll', previewVisible: false }, version: 1 }));
    });
    await page.route(/\/attachments\/[^/]*-seal[^/]*\.png$/, route => route.abort());
    await page.goto('/');
    await page.getByLabel('Import draft file').setInputFiles({ name: 'artless.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      documentCategory: 'correspondence', documentMode: 'custom', docType: 'naval_letter',
      formData: { letterheadMode: mode, unitLine1: 'ARTLESS-TITLE', from: 'Training Sender', to: 'Training Recipient', date: '21 Nov 2026', subject: 'ARTLESS WORD EXPORT', sigLast: 'EXAMPLE' },
      paragraphs: [{ text: 'BODY-PROBE Export succeeds even if seal images are unavailable.', level: 0 }],
      references: [], enclosures: [], copyTos: [], distributions: [],
    })) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true }).click();
    const file = await downloading;
    expect(await file.failure()).toBeNull();
    const path = info.outputPath(`${mode}-no-seal.docx`);
    await file.saveAs(path);
    const zip = await JSZip.loadAsync(await readFile(path));
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('BODY-PROBE');
    expect(xml.includes('ARTLESS-TITLE')).toBe(mode === 'title-only');
    expect(xml).not.toContain('<w:drawing>');
  });
}
