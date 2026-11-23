import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { downloadBrowserPdf } from '../_helpers/downloadBrowserPdf';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { editorLayout: 'scroll', previewVisible: false } }));
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
});

test('edits directive formats through correspondence', async ({ page }) => {
  const picker = page.getByRole('button', { name: /^Correspondence type:/ });
  await picker.click();
  await expect(page.getByRole('group', { name: 'Directives' }).getByRole('option')).toHaveCount(5);
  await page.getByRole('option', { name: 'Marine Corps Bulletin', exact: true }).click();
  await page.getByLabel('Directive number', { exact: true }).fill('5215.1K');
  await page.getByLabel('Cancellation line', { exact: true }).fill('Canc: Sep 2027');
  await picker.click();
  await page.getByRole('option', { name: 'Naval Letter (on letterhead)', exact: true }).click();
  await picker.click();
  await page.getByRole('option', { name: 'Marine Corps Bulletin', exact: true }).click();
  await expect(page.getByLabel('Cancellation line', { exact: true })).toHaveValue('Canc: Sep 2027');
  await picker.click();
  await page.getByRole('option', { name: 'Change Transmittal', exact: true }).click();
  await expect(page.getByText('Attach the approved, already numbered replacement pages', { exact: false })).toBeVisible();
  await expect(page.getByText('SECNAV requires 12-point Courier New', { exact: false })).toBeVisible();
});

test('restores the naval letter font in PDF and Word after editing a Courier directive', async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.getByLabel('Import draft file', { exact: true }).setInputFiles({
    name: 'font-switch-training.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      documentCategory: 'correspondence', documentMode: 'compliant', docType: 'naval_letter',
      formData: {
        subject: 'TRAINING FONT CHECK', from: 'Training Marine', to: 'Training Office',
        unitLine1: 'TRAINING COMMAND', date: '23 Nov 26', ssic: '5216',
        officeCode: 'ADMIN', sigLast: 'EXAMPLE', signatureType: 'none', fontFamily: 'times', fontSize: '12pt',
      },
      paragraphs: [{ level: 0, header: 'Purpose', text: 'Verify the body font after a change of correspondence type.' }],
      references: [], enclosures: [], copyTos: [], distributions: [],
    })),
  });
  const review = page.getByRole('dialog', { name: 'Review draft', exact: true });
  await review.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await expect(review).toBeHidden();

  const picker = page.getByRole('button', { name: /^Correspondence type:/ });
  const download = page.getByRole('button', { name: 'Download', exact: true });
  const pdfFonts = async () => {
    await download.click();
    const pdfItem = page.getByRole('menuitem', { name: /^Download PDF(?:\s|$)/ });
    await expect(pdfItem).toBeEnabled({ timeout: 60_000 });
    const bytes = await downloadBrowserPdf(page, info.project.name, () => pdfItem.click());
    const pdf = await PDFDocument.load(bytes);
    return pdf.context.enumerateIndirectObjects().flatMap(([, object]) => {
      const name = object instanceof PDFDict ? object.get(PDFName.of('BaseFont')) : undefined;
      return name instanceof PDFName ? [name.decodeText()] : [];
    });
  };

  await picker.click();
  await page.getByRole('option', { name: 'Marine Corps Order', exact: true }).click();
  await page.getByLabel('Directive number', { exact: true }).fill('5216.20B');

  const preview = page.getByRole('button', { name: 'Preview', exact: true });
  const mobile = await preview.getAttribute('aria-haspopup') === 'dialog';
  await preview.click();
  await expect(page.locator('[data-pdf-layer="active"] canvas').first()).toBeVisible({ timeout: 60_000 });
  const closePreview = mobile ? page.getByRole('button', { name: 'Close preview', exact: true }) : preview;
  await closePreview.click();

  const courierFonts = /Courier|NimbusMon|UMono/i;
  expect((await pdfFonts()).join(' ')).toMatch(courierFonts);

  await picker.click();
  await page.getByRole('option', { name: 'Naval Letter (on letterhead)', exact: true }).click();
  const returnedFonts = (await pdfFonts()).join(' ');
  expect(returnedFonts).toMatch(/Times|NimbusRom/i);
  expect(returnedFonts).not.toMatch(courierFonts);

  await download.click();
  const saving = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true }).click();
  const file = await saving;
  const word = await JSZip.loadAsync(await readFile((await file.path())!));
  const styles = await word.file('word/styles.xml')!.async('string');
  expect(styles).toContain('w:ascii="Times New Roman"');
  expect(styles).not.toContain('w:ascii="Courier New"');
});
