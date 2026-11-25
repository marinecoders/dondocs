import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { downloadBrowserPdf } from '../_helpers/downloadBrowserPdf';

const SUBJECT = 'REBUTTAL TO ADVERSE PAGE 11 ENTRY';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    const key = 'dondocs_ui';
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, JSON.stringify({ state: { editorLayout: 'scroll', previewVisible: true }, version: 1 }));
    }
  });
  await page.goto('/');
});

test('opens the personnel template with unfinished sections marked for review', async ({ page, isMobile }) => {
  if (isMobile) await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  const picker = page.getByRole('dialog', { name: /Load template/ });
  await picker.getByLabel('Template category').selectOption('Personnel');
  await picker.getByRole('button', { name: /^Page 11 Rebuttal/ }).click();
  await picker.getByRole('button', { name: 'Load template', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue(SUBJECT);
  await expect(page.locator('#to')).toHaveValue('[Commanding Officer, unit]');
  await page.getByRole('button', { name: /^Proofread:/ }).click();
  const proofread = page.getByRole('dialog', { name: 'Proofread', exact: true });
  await expect(proofread.getByText('Addressing needs attention', { exact: true })).toBeVisible();
  await expect(proofread.getByText('Paragraphs needs attention', { exact: true })).toBeVisible();
  await expect(proofread.getByText('Signature needs attention', { exact: true })).toBeVisible();
});

test('saves the Page 11 and opens a separate rebuttal with printable output', async ({ page, isMobile }, info) => {
  test.setTimeout(120_000);
  const originalRemarks = 'SYNTHETIC SOURCE PAGE 11 REMARKS';
  const savedRemarks = 'EDITED SOURCE PAGE 11 REMARKS';
  const form = {
    kind: 'dondocs-draft', version: 2, documentKind: 'builtin-form',
    documentMode: 'compliant', documentCategory: 'forms', docType: 'naval_letter', formType: 'navmc_118_11',
    formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [],
    forms: { includeCoverPage: false, navmc11811: { lastName: 'EXAMPLE', firstName: 'MARINE', remarksText: originalRemarks } },
  };
  await page.getByLabel('Import draft file').setInputFiles({
    name: 'synthetic-page11.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(form)),
  });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  const remarks = page.getByRole('textbox', { name: 'Administrative Remarks (Left)', exact: true });
  await expect(remarks).toHaveText(originalRemarks);
  await remarks.fill(savedRemarks);
  await expect(remarks).toHaveText(savedRemarks);
  // Moving focus away from the editor can relayout its toolbar and hints.
  // Activate the focused button after that transition, particularly on iPad.
  const startRebuttal = page.getByRole('button', { name: 'Save and start rebuttal', exact: true });
  await startRebuttal.focus();
  await expect(startRebuttal).toBeFocused();
  await startRebuttal.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue(SUBJECT, { timeout: 30_000 });
  const body = page.getByRole('textbox', { name: 'Paragraph 1', exact: true });
  await expect(body).toHaveText(/Identify the dated entry/);
  await expect(page.locator('#sigLast')).toHaveValue('');
  await page.locator('#from').fill('LCpl Training Example, USMC');
  await page.locator('#to').fill('Commanding Officer, Training Company');
  await page.locator('#sigFirst').fill('Training');
  await page.locator('#sigLast').fill('Example');
  await page.locator('#date').fill('23 Nov 26');
  await page.locator('#date').press('Tab');
  await body.fill('I submit this statement about the entry dated 20 Nov 26.');

  if (isMobile) {
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.getByRole('dialog').locator('canvas').first()).toBeVisible({ timeout: 90_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } else {
    await expect(page.locator('.workspace-preview')).toHaveAttribute('data-preview-state', 'ready', { timeout: 90_000 });
  }
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const bytes = await downloadBrowserPdf(page, info.project.name, () =>
    page.getByRole('menuitem', { name: /^Download PDF(?:\s|$)/ }).click());
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  try {
    expect(pdf.numPages).toBe(1);
    const pdfPage = await pdf.getPage(1);
    const output = (await pdfPage.getTextContent()).items
      .map(item => 'str' in item ? item.str : '').join(' ').replace(/\s+/g, ' ');
    expect(pdfPage.view).toEqual([0, 0, 612, 792]);
    expect(output).toContain(SUBJECT);
    expect(output).toContain('Commanding Officer, Training Company');
    expect(output).toContain('I submit this statement about the entry dated 20 Nov 26.');
    expect(output).toContain('T. EXAMPLE');
    expect(output).not.toContain(savedRemarks);
    expect(output).not.toContain('DEPARTMENT OF THE NAVY');
  } finally {
    await pdf.destroy();
  }

  if (info.project.name === 'chromium') {
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true }).click();
    const download = await downloading;
    expect(await download.failure()).toBeNull();
    const docx = await JSZip.loadAsync(await readFile((await download.path())!));
    const text = await docx.file('word/document.xml')!.async('string');
    expect(text).toContain(SUBJECT);
    expect(text).toContain('I submit this statement about the entry dated 20 Nov 26.');
    expect(text).not.toContain(savedRemarks);
  }

  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue(SUBJECT);
  if (isMobile) await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await page.getByRole('button', { name: /^EXAMPLE, MARINE/ }).click();
  await expect(remarks).toHaveText(savedRemarks);
});
