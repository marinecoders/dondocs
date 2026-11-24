import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { downloadBrowserPdf } from '../_helpers/downloadBrowserPdf';

test.use({ serviceWorkers: 'block' });

for (const docType of ['naval_letter', 'business_letter'] as const) {
  test(`${docType} opens a dedicated window layout and downloads reviewed outputs`, async ({ page, isMobile }, info) => {
    test.setTimeout(120_000);
    await page.addInitScript(mobile => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ state: { editorLayout: 'scroll', previewVisible: !mobile }, version: 1 }));
    }, isMobile);
    await page.goto('/');
    const standard = docType === 'naval_letter';
    const formData = { unitLine1: 'SYNTHETIC COMMAND', from: 'HIDDEN ORIGINATOR',
      to: 'DIRECTOR\nTRAINING CENTER\nQUANTICO VA 22134', date: standard ? '23 Nov 26' : 'November 23, 2026',
      signatureType: 'none', sigLast: 'SYNTHETIC', subject: 'WINDOW LAYOUT SAMPLE', salutation: 'Dear Director:',
      ssic: '5216', serial: 'N7/001', classLevel: 'unclassified' };
    await page.getByLabel('Import draft file').setInputFiles({ name: 'window-draft.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      documentMode: 'compliant', documentCategory: 'correspondence', docType, formData,
      paragraphs: [{ id: 'synthetic-window-body', text: 'The synthetic window letter keeps the complete body.', level: 0 }],
      references: [], enclosures: [], copyTos: [],
    })) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Window-envelope layout' }).check();
    const address = page.getByLabel('Mailing address', { exact: true });
    await expect(address).toHaveValue(formData.to);
    await expect(page.getByText('3 of 5 mailing address lines')).toBeVisible();
    if (standard) await expect(page.getByRole('textbox', { name: 'From', exact: true })).toHaveCount(0);
    else {
      await page.getByRole('checkbox', { name: 'Use the subject in place of the salutation' }).check();
      await expect(page.locator('#salutation')).toHaveCount(0);
    }

    if (!isMobile) {
      await address.fill('');
      const hint = page.locator('[data-pdf-layer="active"]').getByRole('button', { name: 'Edit Mailing address', exact: true });
      await hint.click({ timeout: 90_000 });
      await expect(address).toBeFocused();
      await address.fill(formData.to);
      await expect(hint).toHaveCount(0, { timeout: 30_000 });
    }
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const pdfBytes = await downloadBrowserPdf(page, info.project.name, async () => {
      await page.getByRole('menuitem', { name: /^Download PDF(?:\s|$)/ }).click();
      const review = page.getByRole('dialog', { name: 'Review export notices' });
      await expect(review.getByText(/Print at actual size/)).toBeVisible();
      await review.getByRole('button', { name: 'Continue export' }).click();
    });
    const pdf = await getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: false }).promise;
    try {
      const firstPage = await pdf.getPage(1);
      const content = await firstPage.getTextContent();
      const text = content.items.map(item => 'str' in item ? item.str : '').join(' ').replace(/\s+/g, ' ');
      expect(text).toContain('DIRECTOR TRAINING CENTER QUANTICO VA 22134');
      expect(text).toContain('WINDOW LAYOUT SAMPLE');
      expect(text).toContain('The synthetic window letter');
      expect(text).not.toContain('HIDDEN ORIGINATOR');
      expect(text).not.toContain('Dear Director');
      expect(await firstPage.getAnnotations()).not.toContainEqual(expect.objectContaining({
        url: expect.stringContaining('dondocs.invalid/preview-hint/'),
      }));
    } finally {
      await pdf.destroy();
    }
    if (info.project.name === 'chromium') {
      const saving = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true }).click();
      await page.getByRole('dialog', { name: 'Review export notices' }).getByRole('button', { name: 'Continue export' }).click();
      const zip = await JSZip.loadAsync(await readFile((await (await saving).path())!));
      const xml = await zip.file('word/document.xml')!.async('string');
      expect(xml).toContain('TRAINING CENTER');
      expect(xml).toContain('WINDOW LAYOUT SAMPLE');
      expect(xml).not.toContain('HIDDEN ORIGINATOR');
      expect(xml).not.toContain('DonDocsWindowRow');
      expect(xml).toContain('w:line="240" w:lineRule="exact"');
    }
  });
}
